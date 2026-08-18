/* ==========================================================================
   Krakow Insiders — /api/content

   What the public site reads. Returns only entries marked visible, and never
   the panel's own state. Open to everyone; there is nothing private here.
   ========================================================================== */

const { readContent } = require("./_lib/store");
const { publicContent } = require("./_lib/content-schema");
const { sendJson } = require("./_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const content = await readContent();
    sendJson(res, 200, { ok: true, content: publicContent(content) });
  } catch (err) {
    /* The site falls back to its bundled seed when this fails, so a storage
       outage degrades the page rather than emptying it. */
    sendJson(res, 500, { ok: false, error: "content-unavailable" });
  }
};
