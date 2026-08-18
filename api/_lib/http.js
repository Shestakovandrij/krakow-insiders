/* ==========================================================================
   Krakow Insiders — small HTTP helpers shared by the API functions.
   ========================================================================== */

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — content JSON, never file data

/* Vercel parses JSON bodies for us; the local dev server does not. Reading
   the stream covers both, and the size cap stops an oversized body from
   being buffered into memory. */
function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }
    if (typeof req.body === "string") {
      try {
        resolve(req.body ? JSON.parse(req.body) : null);
      } catch (e) {
        reject(new Error("invalid-json"));
      }
      return;
    }

    let raw = "";
    let size = 0;
    let aborted = false;

    req.on("data", function (chunk) {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(new Error("body-too-large"));
        return;
      }
      raw += chunk;
    });
    req.on("end", function () {
      if (aborted) return;
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch (e) {
        reject(new Error("invalid-json"));
      }
    });
    req.on("error", function () {
      if (!aborted) reject(new Error("read-failed"));
    });
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  /* Nothing this API returns may be cached: the panel must see its own
     writes, and the site must see the panel's. */
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(payload));
}

module.exports = { readJsonBody, sendJson };
