/* ==========================================================================
   Krakow Insiders — Telegram notifications

   Two things arrive through the bot: booking requests and reviews left on
   the site. Both are read on a phone, usually while doing something else,
   so the formatting is built around one question — what has to be tappable
   to act on this without typing anything?

   The answer is the phone number (call, or open WhatsApp) and the email.
   Everything else is there to be skimmed.
   ========================================================================== */

const API_ROOT = "https://api.telegram.org/bot";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

function isConfigured() {
  return TOKEN.length > 0 && CHAT_ID.length > 0;
}

/* Telegram's HTML mode allows only <b>, <i>, <u>, <s>, <code>, <pre>, <a>.
   Every dynamic value goes through here before it is placed in one. */
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const RULE = "━━━━━━━━━━━━━━━";

function digitsOnly(value) {
  return String(value == null ? "" : value).replace(/\D/g, "");
}

/* A phone number is worth three taps' worth of links: call it, open the
   chat, or copy it. Only render what the value can actually support. */
function phoneLine(phone) {
  const clean = digitsOnly(phone);
  if (!clean) return null;

  const shown = escapeHtml(phone);
  return "📱 <b>Phone:</b> <a href=\"tel:+" + clean + "\">" + shown + "</a>" +
    "   ·   <a href=\"https://wa.me/" + clean + "\">WhatsApp</a>";
}

function emailLine(email) {
  if (!email) return null;
  return "✉️ <b>Email:</b> <a href=\"mailto:" + escapeHtml(email) + "\">" + escapeHtml(email) + "</a>";
}

/* Times are shown in Kraków, because that is where the person reading this
   is deciding whether a 9:00 pickup is realistic. */
function warsawTime(isoString) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return String(isoString || "");
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Warsaw",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date) + " (Kraków)";
  } catch (e) {
    return date.toISOString();
  }
}

function compact(lines) {
  return lines.filter(function (line) { return line !== null && line !== undefined; }).join("\n");
}

/* --------------------------------------------------------------------------
   Booking request
   -------------------------------------------------------------------------- */

function formatLead(lead) {
  const isTransfer = /transfer/i.test(lead.type || "");

  return compact([
    "<b>" + (isTransfer ? "🚗 New transfer request" : "🧭 New tour request") + "</b>",
    RULE,
    "",
    "👤 <b>Name:</b> " + escapeHtml(lead.name),
    phoneLine(lead.phone),
    emailLine(lead.email),
    "",
    "📍 <b>Experience:</b> " + escapeHtml(lead.type),
    "📅 <b>Date:</b> " + escapeHtml(lead.date),
    "👥 <b>People:</b> " + escapeHtml(lead.people),
    lead.message ? "" : null,
    lead.message ? "💬 <b>Message</b>" : null,
    lead.message ? escapeHtml(lead.message) : null,
    "",
    RULE,
    "🔖 " + escapeHtml(lead.section || "—") +
      "   ·   🌐 " + escapeHtml((lead.lang || "—").toUpperCase()) +
      "   ·   🕒 " + escapeHtml(warsawTime(lead.submittedAt)),
    lead.page ? "🔗 <a href=\"" + escapeHtml(lead.page) + "\">Page it came from</a>" : null
  ]);
}

/* --------------------------------------------------------------------------
   Review left on the site
   -------------------------------------------------------------------------- */

function formatReview(review, panelUrl) {
  const stars = "⭐".repeat(Math.max(1, Math.min(5, parseInt(review.stars, 10) || 5)));
  const who = review.country
    ? escapeHtml(review.name) + " — " + escapeHtml(review.country)
    : escapeHtml(review.name);

  const media = [];
  if (review.photo) media.push("<a href=\"" + escapeHtml(review.photo) + "\">photo</a>");
  if (review.video) media.push("<a href=\"" + escapeHtml(review.video) + "\">video</a>");

  return compact([
    "<b>💬 New review — waiting for you</b>",
    RULE,
    "",
    "👤 " + who,
    stars,
    "",
    escapeHtml(review.text),
    "",
    media.length ? "📎 " + media.join("   ·   ") : null,
    RULE,
    "🕒 " + escapeHtml(warsawTime(review.submittedAt)),
    /* Nothing is on the site until it is approved, so the message ends with
       the one link that lets that happen. */
    panelUrl ? "🔓 <a href=\"" + escapeHtml(panelUrl) + "\">Open the panel to publish it</a>" : null
  ]);
}

/* --------------------------------------------------------------------------
   Sending
   -------------------------------------------------------------------------- */

async function send(text) {
  if (!isConfigured()) {
    return { channel: "telegram", ok: false, skipped: true, reason: "not configured" };
  }

  const response = await fetch(API_ROOT + TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(function () { return ""; });
    throw new Error("Telegram API error " + response.status + ": " + detail.slice(0, 300));
  }

  return { channel: "telegram", ok: true };
}

function sendLead(lead) {
  return send(formatLead(lead));
}

/* Reviews must never block the visitor's "thank you" — a bot outage is not
   their problem, and the review is already safely in the queue. */
function sendReview(review, panelUrl) {
  return send(formatReview(review, panelUrl)).catch(function () {
    return { channel: "telegram", ok: false };
  });
}

module.exports = { isConfigured, sendLead, sendReview, formatLead, formatReview, escapeHtml };
