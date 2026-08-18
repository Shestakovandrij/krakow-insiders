/* ==========================================================================
   Krakow Insiders — /api/admin

   Every panel action goes through this one endpoint, dispatched on
   body.action. Three of them run before a session exists (status, setup,
   login); the rest require one.
   ========================================================================== */

const auth = require("./_lib/auth");
const {
  readContent, writeContent, seedContent,
  readPending, writePending, isBlobConfigured
} = require("./_lib/store");
const {
  normalizeContent, normalizePendingList,
  approveAsTextReview, approveAsVideoReview
} = require("./_lib/content-schema");
const { readJsonBody, sendJson } = require("./_lib/http");

const PUBLIC_ACTIONS = ["status", "setup", "login"];

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
    return;
  }

  const action = body && typeof body.action === "string" ? body.action : "";

  try {
    if (PUBLIC_ACTIONS.indexOf(action) === -1) {
      if (!(await auth.hasValidSession(req))) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
    }

    switch (action) {
      case "status":
        return await handleStatus(req, res);
      case "setup":
        return await handleSetup(req, res, body);
      case "login":
        return await handleLogin(req, res, body);
      case "logout":
        return handleLogout(req, res);
      case "load":
        return await handleLoad(res);
      case "save":
        return await handleSave(res, body);
      case "reset":
        return await handleReset(res);
      case "approve":
        return await handleApprove(res, body);
      case "reject":
        return await handleReject(res, body);
      case "change-password":
        return await handleChangePassword(req, res, body);
      default:
        sendJson(res, 400, { ok: false, error: "unknown-action" });
    }
  } catch (err) {
    sendJson(res, 500, { ok: false, error: "server-error", detail: String(err && err.message ? err.message : err) });
  }
};

/* --------------------------------------------------------------------------
   Public actions
   -------------------------------------------------------------------------- */

async function handleStatus(req, res) {
  const passwordSet = await auth.isPasswordSet();
  sendJson(res, 200, {
    ok: true,
    passwordSet: passwordSet,
    authenticated: passwordSet ? await auth.hasValidSession(req) : false,
    minPasswordLength: auth.MIN_PASSWORD_LENGTH,
    /* The panel warns when this is false: locally that is expected, on a
       deploy it means edits would be lost on the next release. */
    persistentStorage: isBlobConfigured
  });
}

async function handleSetup(req, res, body) {
  const result = await auth.createPassword(body && body.password);
  if (!result.ok) {
    sendJson(res, result.error === "already-set" ? 409 : 422, result);
    return;
  }
  /* Setting the password logs the owner straight in — no reason to make
     them type it again on the very next screen. */
  const login = await auth.login(body.password);
  if (login.ok) auth.setSessionCookie(req, res, login.token);
  sendJson(res, 200, { ok: true });
}

async function handleLogin(req, res, body) {
  const result = await auth.login(body && body.password);
  if (!result.ok) {
    sendJson(res, result.error === "locked" ? 429 : 401, result);
    return;
  }
  auth.setSessionCookie(req, res, result.token);
  sendJson(res, 200, { ok: true });
}

/* --------------------------------------------------------------------------
   Authenticated actions
   -------------------------------------------------------------------------- */

function handleLogout(req, res) {
  auth.clearSessionCookie(req, res);
  sendJson(res, 200, { ok: true });
}

async function handleLoad(res) {
  const content = await readContent();
  const pending = normalizePendingList(await readPending());
  sendJson(res, 200, { ok: true, content: content, pending: pending });
}

/* Saving rewrites the published content only. The moderation queue is
   deliberately untouched here: an approval that happened in another tab must
   not be undone by a save that started before it. */
async function handleSave(res, body) {
  const content = normalizeContent(body && body.content);
  await writeContent(content);
  sendJson(res, 200, { ok: true, content: content });
}

/* --------------------------------------------------------------------------
   Moderation

   Approving writes straight through to the published content rather than
   waiting for a Save. The owner has just made an explicit yes/no decision on
   somebody else's words; leaving that sitting in an unsaved buffer is how it
   gets lost.
   -------------------------------------------------------------------------- */

async function handleApprove(res, body) {
  const id = body && typeof body.id === "string" ? body.id : "";
  const asVideo = body && body.as === "video";

  const pending = normalizePendingList(await readPending());
  const index = pending.findIndex(function (item) { return item.id === id; });
  if (index === -1) {
    sendJson(res, 404, { ok: false, error: "not-found" });
    return;
  }

  const submission = pending[index];
  if (asVideo && !submission.video) {
    sendJson(res, 422, { ok: false, error: "no-video" });
    return;
  }

  const content = normalizeContent(await readContent());
  if (asVideo) {
    content.videoReviews.push(approveAsVideoReview(submission, content.videoReviews));
  } else {
    content.textReviews.push(approveAsTextReview(submission, content.textReviews));
  }

  await writeContent(content);

  pending.splice(index, 1);
  await writePending(pending);

  sendJson(res, 200, { ok: true, content: content, pending: pending });
}

async function handleReject(res, body) {
  const id = body && typeof body.id === "string" ? body.id : "";

  const pending = normalizePendingList(await readPending());
  const next = pending.filter(function (item) { return item.id !== id; });
  if (next.length === pending.length) {
    sendJson(res, 404, { ok: false, error: "not-found" });
    return;
  }

  await writePending(next);
  sendJson(res, 200, { ok: true, pending: next });
}

/* Restores the tours and reviews the repository shipped with. Useful after a
   bad edit, and the only way back if the stored JSON is ever mangled. */
async function handleReset(res) {
  const content = normalizeContent(seedContent());
  await writeContent(content);
  sendJson(res, 200, { ok: true, content: content });
}

async function handleChangePassword(req, res, body) {
  const result = await auth.changePassword(
    body && body.currentPassword,
    body && body.newPassword
  );
  if (!result.ok) {
    sendJson(res, result.error === "too-short" ? 422 : 401, result);
    return;
  }
  auth.setSessionCookie(req, res, result.token);
  sendJson(res, 200, { ok: true });
}
