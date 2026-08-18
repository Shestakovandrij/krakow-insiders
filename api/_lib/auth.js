/* ==========================================================================
   Krakow Insiders — panel authentication

   No user table, no database: a single password, hashed with scrypt, stored
   next to the content JSON. Until it is set, /admin/ shows the "create a
   password" form — which is why the first visit after a deploy should be
   yours.

   Sessions are a signed cookie rather than server-side state, because
   serverless functions keep nothing between invocations.
   ========================================================================== */

const crypto = require("crypto");
const { readConfig, writeConfig } = require("./store");

const COOKIE_NAME = "ki_admin";
const SESSION_HOURS = 12;
const MIN_PASSWORD_LENGTH = 10;

/* Brute force protection. The panel is on a public URL, so a wrong password
   has to cost something — after MAX_FAILURES the door stays shut for a while,
   regardless of how many requests arrive in the meantime. */
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password, salt) {
  return new Promise(function (resolve, reject) {
    crypto.scrypt(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS, function (err, key) {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt);
  return { salt: salt, hash: key.toString("hex") };
}

/* Constant-time compare — a length mismatch alone must not be observable
   through timing, so both sides are hashed to a fixed width first. */
function safeEqual(a, b) {
  const bufA = crypto.createHash("sha256").update(String(a)).digest();
  const bufB = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/* --------------------------------------------------------------------------
   Session cookie: base64url(payload).base64url(hmac)
   -------------------------------------------------------------------------- */

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value) {
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payloadText, secret) {
  return b64url(crypto.createHmac("sha256", secret).update(payloadText).digest());
}

function createSessionToken(secret) {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  const encoded = b64url(payload);
  return encoded + "." + sign(encoded, secret);
}

function verifySessionToken(token, secret) {
  if (typeof token !== "string" || token.indexOf(".") === -1) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  if (!safeEqual(parts[1], sign(parts[0], secret))) return false;

  let payload;
  try {
    payload = JSON.parse(fromB64url(parts[0]).toString("utf8"));
  } catch (e) {
    return false;
  }
  return typeof payload.exp === "number" && payload.exp > Date.now();
}

function parseCookies(req) {
  const header = req.headers ? req.headers.cookie : "";
  const out = {};
  if (!header) return out;
  String(header).split(";").forEach(function (pair) {
    const index = pair.indexOf("=");
    if (index === -1) return;
    out[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  });
  return out;
}

/* Secure is skipped on localhost only — a Secure cookie is dropped over
   plain HTTP, which would make the panel impossible to log into locally. */
function isSecureRequest(req) {
  const host = (req.headers && req.headers.host) || "";
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

function setSessionCookie(req, res, token) {
  const parts = [
    COOKIE_NAME + "=" + encodeURIComponent(token),
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + SESSION_HOURS * 3600
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(req, res) {
  const parts = [COOKIE_NAME + "=", "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isSecureRequest(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

/* --------------------------------------------------------------------------
   Operations
   -------------------------------------------------------------------------- */

async function isPasswordSet() {
  const config = await readConfig();
  return !!(config && config.hash && config.salt);
}

async function createPassword(password) {
  if (await isPasswordSet()) {
    return { ok: false, error: "already-set" };
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "too-short", minLength: MIN_PASSWORD_LENGTH };
  }

  const { salt, hash } = await hashPassword(password);
  await writeConfig({
    salt: salt,
    hash: hash,
    secret: crypto.randomBytes(32).toString("hex"),
    failures: 0,
    lockedUntil: 0,
    createdAt: new Date().toISOString()
  });
  return { ok: true };
}

async function login(password) {
  const config = await readConfig();
  if (!config || !config.hash) return { ok: false, error: "not-set" };

  const now = Date.now();
  if (config.lockedUntil && config.lockedUntil > now) {
    return { ok: false, error: "locked", retryAfter: Math.ceil((config.lockedUntil - now) / 1000) };
  }

  const attempt = await hashPassword(String(password == null ? "" : password), config.salt);
  if (!safeEqual(attempt.hash, config.hash)) {
    const failures = (config.failures || 0) + 1;
    config.failures = failures;
    if (failures >= MAX_FAILURES) {
      config.failures = 0;
      config.lockedUntil = now + LOCK_MINUTES * 60 * 1000;
    }
    await writeConfig(config);
    return config.lockedUntil > now
      ? { ok: false, error: "locked", retryAfter: LOCK_MINUTES * 60 }
      : { ok: false, error: "wrong", attemptsLeft: MAX_FAILURES - failures };
  }

  if (config.failures || config.lockedUntil) {
    config.failures = 0;
    config.lockedUntil = 0;
    await writeConfig(config);
  }

  return { ok: true, token: createSessionToken(config.secret) };
}

async function changePassword(currentPassword, newPassword) {
  const config = await readConfig();
  if (!config || !config.hash) return { ok: false, error: "not-set" };

  const attempt = await hashPassword(String(currentPassword == null ? "" : currentPassword), config.salt);
  if (!safeEqual(attempt.hash, config.hash)) return { ok: false, error: "wrong" };

  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "too-short", minLength: MIN_PASSWORD_LENGTH };
  }

  const next = await hashPassword(newPassword);
  config.salt = next.salt;
  config.hash = next.hash;
  /* A new secret invalidates every session signed with the old one, so a
     password change also signs out anyone else who was still logged in. */
  config.secret = crypto.randomBytes(32).toString("hex");
  config.failures = 0;
  config.lockedUntil = 0;
  config.updatedAt = new Date().toISOString();
  await writeConfig(config);

  return { ok: true, token: createSessionToken(config.secret) };
}

async function hasValidSession(req) {
  const config = await readConfig();
  if (!config || !config.secret) return false;
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[COOKIE_NAME], config.secret);
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  isPasswordSet,
  createPassword,
  login,
  changePassword,
  hasValidSession,
  setSessionCookie,
  clearSessionCookie
};
