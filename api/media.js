/* ==========================================================================
   Krakow Insiders — /m/<file>  (rewritten to /api/media)

   Files uploaded through the panel live on the panel-data branch, which is
   not deployed and — once the repository is private — is not readable by
   anyone without a token. So they are served from here.

   Every uploaded name carries a random tail and is never rewritten, which is
   what makes the immutable cache header below honest: the CDN keeps the file
   at the edge and GitHub is asked for it roughly once per file.
   ========================================================================== */

const store = require("./_lib/store");
const { sendJson } = require("./_lib/http");

const TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime"
};

/* One path segment, no slashes, no dots that could climb out of media/. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const name = url.searchParams.get("p") || "";

  if (!SAFE_NAME.test(name) || name.indexOf("..") !== -1) {
    sendJson(res, 400, { ok: false, error: "bad-name" });
    return;
  }

  let buffer;
  try {
    buffer = await store.readMedia(name);
  } catch (err) {
    sendJson(res, 502, { ok: false, error: "storage-unavailable" });
    return;
  }

  if (!buffer) {
    sendJson(res, 404, { ok: false, error: "not-found" });
    return;
  }

  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();

  res.setHeader("Content-Type", TYPES[extension] || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  /* Without ranges a browser cannot seek in a video — it refetches from the
     start on every scrub. The whole file is already in memory here, so
     answering a range is a slice. */
  res.setHeader("Accept-Ranges", "bytes");

  const range = parseRange(req.headers.range, buffer.length);

  if (range === "unsatisfiable") {
    res.statusCode = 416;
    res.setHeader("Content-Range", "bytes */" + buffer.length);
    res.end();
    return;
  }

  if (range) {
    const slice = buffer.subarray(range.start, range.end + 1);
    res.statusCode = 206;
    res.setHeader("Content-Range", "bytes " + range.start + "-" + range.end + "/" + buffer.length);
    res.setHeader("Content-Length", String(slice.length));
    res.end(req.method === "HEAD" ? undefined : slice);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", String(buffer.length));
  res.end(req.method === "HEAD" ? undefined : buffer);
};

/* Only the single-range form browsers actually send. Anything else is
   ignored and the whole file goes back, which is always a valid answer. */
function parseRange(header, size) {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return null;

  const hasStart = match[1] !== "";
  const hasEnd = match[2] !== "";
  if (!hasStart && !hasEnd) return null;

  let start;
  let end;

  if (hasStart) {
    start = parseInt(match[1], 10);
    end = hasEnd ? parseInt(match[2], 10) : size - 1;
  } else {
    /* "bytes=-500" — the last 500 bytes. */
    const tail = parseInt(match[2], 10);
    if (tail === 0) return "unsatisfiable";
    start = Math.max(0, size - tail);
    end = size - 1;
  }

  if (isNaN(start) || isNaN(end) || start > end || start >= size) return "unsatisfiable";
  return { start: start, end: Math.min(end, size - 1) };
}
