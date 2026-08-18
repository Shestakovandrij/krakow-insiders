/* ==========================================================================
   Krakow Insiders — /api/upload

   Photos and review videos. Where the file ends up depends on what the
   deployment has:

     - Normally it is committed to the panel-data branch, next to the JSON
       that references it, and served back through /api/media.

     - If a Vercel Blob store happens to be configured, the browser uploads
       to it directly instead and this endpoint only hands out a scoped
       token. That path exists for one reason: a function on Vercel may only
       receive 4.5 MB per request, which caps a git-bound upload at about
       4 MB. Photos are shrunk in the browser and never come close, but a
       real video does — so a Blob store, if there is one, is what makes a
       large video possible.

   Visitors submitting a review upload through the same endpoint without a
   session, held to smaller files and confined to their own prefix.
   ========================================================================== */

const crypto = require("crypto");

const auth = require("./_lib/auth");
const store = require("./_lib/store");
const { sendJson } = require("./_lib/http");

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const USE_BLOB = BLOB_TOKEN.length > 0;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_TYPES = IMAGE_TYPES.concat(VIDEO_TYPES);

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov"
};

/* Vercel refuses a request body over 4.5 MB before the function sees it, so
   this is the real ceiling for anything routed through here. */
const MAX_DIRECT_BYTES = 4 * 1024 * 1024;

/* Straight to Blob, when there is one — no request body passes through us. */
const MAX_BLOB_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BLOB_VIDEO_BYTES = 300 * 1024 * 1024;

/* Visitors are strangers: smaller files, and their uploads carry a prefix so
   nothing they send can be confused with the owner's own media. */
const PUBLIC_PREFIX = "reviews/";
const PUBLIC_MAX_BLOB_IMAGE_BYTES = 6 * 1024 * 1024;
const PUBLIC_MAX_BLOB_VIDEO_BYTES = 60 * 1024 * 1024;

/* Cyrillic file names are common here and would otherwise become a URL full
   of percent-escapes, so they are transliterated rather than stripped. */
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
  з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ъ: ""
};

function slugStem(name) {
  const raw = String(name || "file");
  const dot = raw.lastIndexOf(".");
  const stem = dot > 0 ? raw.slice(0, dot) : raw;

  return stem
    .toLowerCase()
    .split("")
    .map(function (ch) {
      return Object.prototype.hasOwnProperty.call(TRANSLIT, ch) ? TRANSLIT[ch] : ch;
    })
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "file";
}

/* A short random tail rather than a collision counter: it makes every file
   name unique on the first try, which lets the served file be cached forever
   and avoids a read-before-write just to discover the name is taken. */
function uniqueName(originalName, contentType, prefix) {
  return (prefix || "") + slugStem(originalName) + "-" +
    crypto.randomBytes(4).toString("hex") + "." + (EXTENSIONS[contentType] || "bin");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  try {
    if (USE_BLOB && isTokenRequest(req)) {
      return await handleBlobToken(req, res);
    }
    return await handleDirectUpload(req, res);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: "upload-failed", detail: String(err && err.message ? err.message : err) });
  }
};

/* The Blob client posts JSON; a direct upload posts the file itself. */
function isTokenRequest(req) {
  const type = String(req.headers["content-type"] || "");
  return type.indexOf("application/json") === 0;
}

/* --------------------------------------------------------------------------
   Blob path — hand the browser a scoped token
   -------------------------------------------------------------------------- */

async function handleBlobToken(req, res) {
  const { handleUpload } = require("@vercel/blob/client");

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }
  if (!body) body = await readRawJson(req);

  /* The token request comes from a browser and may carry a session; the
     completion event comes from Blob's servers and carries none, which
     handleUpload verifies by signature instead. */
  let isOwner = true;
  if (body && body.type === "blob.generate-client-token") {
    isOwner = await auth.hasValidSession(req);
  }

  const result = await handleUpload({
    body: body,
    request: req,
    token: BLOB_TOKEN,
    onBeforeGenerateToken: async function (pathname) {
      if (!isOwner && String(pathname).indexOf(PUBLIC_PREFIX) !== 0) {
        throw new Error("unauthorized");
      }
      return {
        allowedContentTypes: ALLOWED_TYPES,
        maximumSizeInBytes: isOwner ? MAX_BLOB_VIDEO_BYTES : PUBLIC_MAX_BLOB_VIDEO_BYTES,
        addRandomSuffix: true,
        cacheControlMaxAge: 31536000
      };
    }
  });

  sendJson(res, 200, result);
}

/* --------------------------------------------------------------------------
   Direct path — the file arrives here and is committed
   -------------------------------------------------------------------------- */

async function handleDirectUpload(req, res) {
  const url = new URL(req.url, "http://localhost");
  const isReviewUpload = url.searchParams.get("scope") === "review";

  const isOwner = await auth.hasValidSession(req);
  if (!isOwner && !isReviewUpload) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim();
  if (ALLOWED_TYPES.indexOf(contentType) === -1) {
    sendJson(res, 415, { ok: false, error: "type-not-allowed", contentType: contentType });
    return;
  }

  let buffer;
  try {
    buffer = await readRawBody(req, MAX_DIRECT_BYTES);
  } catch (err) {
    sendJson(res, 413, { ok: false, error: "file-too-large", maxBytes: MAX_DIRECT_BYTES });
    return;
  }

  const name = uniqueName(url.searchParams.get("name"), contentType, isReviewUpload ? "reviews-" : "");
  const message = (isReviewUpload ? "Review upload: " : "Panel: add ") + name;
  const publicUrl = await store.writeMedia(name, buffer, message);

  sendJson(res, 200, { ok: true, url: publicUrl });
}

/* --------------------------------------------------------------------------
   Body reading
   -------------------------------------------------------------------------- */

function readRawJson(req) {
  return new Promise(function (resolve) {
    let raw = "";
    req.on("data", function (chunk) { raw += chunk; });
    req.on("end", function () {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch (e) {
        resolve(null);
      }
    });
  });
}

function readRawBody(req, limit) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    let aborted = false;

    req.on("data", function (chunk) {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        reject(new Error("too-large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on("error", function () {
      if (!aborted) reject(new Error("read-failed"));
    });
  });
}

module.exports.limits = {
  direct: MAX_DIRECT_BYTES,
  blobImage: MAX_BLOB_IMAGE_BYTES,
  blobVideo: MAX_BLOB_VIDEO_BYTES,
  publicBlobImage: PUBLIC_MAX_BLOB_IMAGE_BYTES,
  publicBlobVideo: PUBLIC_MAX_BLOB_VIDEO_BYTES
};
