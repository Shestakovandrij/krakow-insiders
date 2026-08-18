/* ==========================================================================
   Krakow Insiders — /api/upload

   Photos and review videos, in whichever way the environment allows:

     - On Vercel the browser uploads straight to Blob storage. This endpoint
       only hands out a short-lived, tightly scoped token; the file itself
       never passes through the function, so the 4.5 MB request-body limit
       does not apply and a 200 MB video works the same as a 200 KB photo.

     - Locally there is no Blob store, so the file is posted here and written
       into images/uploads/. Same panel code, same resulting URL shape.
   ========================================================================== */

const fs = require("fs/promises");
const path = require("path");

const auth = require("./_lib/auth");
const { isBlobConfigured } = require("./_lib/store");
const { sendJson } = require("./_lib/http");

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_TYPES = IMAGE_TYPES.concat(VIDEO_TYPES);

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

/* Visitors submitting a review upload without logging in, so their ceiling is
   far lower than the owner's and their files are confined to reviews/. The
   queue they feed is capped too, which bounds what an abuser can store. */
const PUBLIC_PREFIX = "reviews/";
const PUBLIC_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const PUBLIC_MAX_VIDEO_BYTES = 60 * 1024 * 1024;

const LOCAL_DIR = path.join(process.cwd(), "images", "uploads");

/* Cyrillic file names are common here and would otherwise become a URL full
   of percent-escapes, so they are transliterated rather than stripped. */
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
  з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ъ: ""
};

function safeFileName(name) {
  const raw = String(name || "file");
  const dot = raw.lastIndexOf(".");
  const stem = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase() : "";

  const slug = stem
    .toLowerCase()
    .split("")
    .map(function (ch) {
      return Object.prototype.hasOwnProperty.call(TRANSLIT, ch) ? TRANSLIT[ch] : ch;
    })
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const cleanExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "bin";
  return (slug || "file") + "." + cleanExt;
}

function maxBytesFor(contentType) {
  return VIDEO_TYPES.indexOf(contentType) !== -1 ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

function publicMaxBytesFor(contentType) {
  return VIDEO_TYPES.indexOf(contentType) !== -1 ? PUBLIC_MAX_VIDEO_BYTES : PUBLIC_MAX_IMAGE_BYTES;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  try {
    if (isBlobConfigured) {
      return await handleBlobUpload(req, res);
    }
    return await handleLocalUpload(req, res);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: "upload-failed", detail: String(err && err.message ? err.message : err) });
  }
};

/* --------------------------------------------------------------------------
   Production: hand the browser a scoped upload token
   -------------------------------------------------------------------------- */

async function handleBlobUpload(req, res) {
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

  /* Three different callers reach this endpoint:
       - the panel, which carries a session and may upload anything;
       - a visitor submitting a review, who has no session and is held to the
         reviews/ prefix and much smaller files;
       - Blob's own servers reporting a finished upload, which carry no
         session either — handleUpload verifies that one by signature. */
  let isOwner = true;
  if (body && body.type === "blob.generate-client-token") {
    isOwner = await auth.hasValidSession(req);
  }

  const result = await handleUpload({
    body: body,
    request: req,
    token: BLOB_TOKEN,
    onBeforeGenerateToken: async function (pathname, clientPayload, multipart) {
      if (!isOwner && String(pathname).indexOf(PUBLIC_PREFIX) !== 0) {
        throw new Error("unauthorized");
      }
      return {
        allowedContentTypes: ALLOWED_TYPES,
        maximumSizeInBytes: isOwner ? MAX_VIDEO_BYTES : PUBLIC_MAX_VIDEO_BYTES,
        /* Two photos named photo.jpg must not overwrite one another, and a
           stale CDN copy under a reused name would be worse still. */
        addRandomSuffix: true,
        cacheControlMaxAge: 31536000
      };
    }
  });

  sendJson(res, 200, result);
}

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

/* --------------------------------------------------------------------------
   Local development: write the file into images/uploads/
   -------------------------------------------------------------------------- */

async function handleLocalUpload(req, res) {
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

  const limit = isOwner ? maxBytesFor(contentType) : publicMaxBytesFor(contentType);
  let buffer;
  try {
    buffer = await readRawBody(req, limit);
  } catch (err) {
    sendJson(res, 413, { ok: false, error: "file-too-large", maxBytes: limit });
    return;
  }

  await fs.mkdir(LOCAL_DIR, { recursive: true });

  const base = safeFileName(url.searchParams.get("name"));
  const name = await uniqueName(base);
  await fs.writeFile(path.join(LOCAL_DIR, name), buffer);

  sendJson(res, 200, { ok: true, url: "images/uploads/" + name });
}

/* Mirrors Blob's addRandomSuffix: a second keuken.jpg becomes keuken-2.jpg
   rather than replacing the first one. */
async function uniqueName(base) {
  const dot = base.lastIndexOf(".");
  const stem = base.slice(0, dot);
  const ext = base.slice(dot);

  let candidate = base;
  let counter = 2;
  for (;;) {
    try {
      await fs.access(path.join(LOCAL_DIR, candidate));
      candidate = stem + "-" + counter + ext;
      counter += 1;
    } catch (e) {
      return candidate;
    }
  }
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
