/* ==========================================================================
   Krakow Insiders — /api/review-submit

   The "Leave a review" form on the site posts here. Nothing it sends reaches
   the page directly: the submission lands in a moderation queue and only
   appears once the owner approves it in the panel.
   ========================================================================== */

const crypto = require("crypto");

const { readPending, writePending } = require("./_lib/store");
const { normalizeSubmission, validateSubmission, normalizePendingList } = require("./_lib/content-schema");
const { readJsonBody, sendJson } = require("./_lib/http");
const telegram = require("./_lib/telegram");

/* The queue is a lever a bot could pull all day, so it has a ceiling. Past
   it, submissions are refused rather than silently dropped — the owner sees
   a full queue and clears it. */
const QUEUE_LIMIT = 200;

/* The notification carries a link straight to the panel, built from the host
   the request arrived on — so it stays correct on the preview domain, the
   production domain and localhost alike. */
function panelUrl(req) {
  const host = (req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "";
  if (!host) return "";
  const scheme = /^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https";
  return scheme + "://" + host + "/admin/";
}

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
    sendJson(res, 400, { ok: false, error: "invalid-json" });
    return;
  }

  /* A field no human sees and no human fills in. Bots fill in everything. */
  if (body && typeof body.website === "string" && body.website.trim()) {
    /* Answer as if it worked: a bot told it failed simply tries again. */
    sendJson(res, 200, { ok: true });
    return;
  }

  const submission = normalizeSubmission(body);
  const errors = validateSubmission(submission);
  if (errors.length) {
    sendJson(res, 422, { ok: false, error: "validation-failed", fields: errors });
    return;
  }

  try {
    const pending = normalizePendingList(await readPending());
    if (pending.length >= QUEUE_LIMIT) {
      sendJson(res, 429, { ok: false, error: "queue-full" });
      return;
    }

    const entry = {
      id: "p-" + crypto.randomBytes(6).toString("hex"),
      submittedAt: new Date().toISOString(),
      name: submission.name,
      country: submission.country,
      text: submission.text,
      stars: submission.stars,
      photo: submission.photo,
      video: submission.video
    };

    pending.unshift(entry);
    await writePending(pending);

    /* A queue nobody looks at is the same as no queue, so the bot says a
       review arrived. Awaited, but never allowed to fail the request — the
       review is already stored, and the visitor should not see an error
       because a chat was unreachable. */
    await telegram.sendReview(entry, panelUrl(req));

    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: "server-error" });
  }
};
