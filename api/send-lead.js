/* ==========================================================================
   Krakow Insiders — /api/send-lead
   Serverless lead handler (Vercel / Netlify-functions compatible signature).
   Receives the booking/contact form payload as JSON and forwards it to:
     1. A Telegram chat via a Telegram bot
     2. An email inbox via SMTP (nodemailer)

   Setup:
     - Deploy this file as /api/send-lead (on Vercel it works as-is from /api).
     - Install the email dependency once in the project root:
         npm install nodemailer
     - Provide real credentials via environment variables (preferred)
       or by replacing the placeholder constants below:
         TELEGRAM_BOT_TOKEN  — from @BotFather
         TELEGRAM_CHAT_ID    — the chat/channel that receives leads
         SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS — mailbox that sends
           the notification (for Gmail use an App Password, not the account
           password: smtp.gmail.com, port 465)
   ========================================================================== */

/* nodemailer is optional: the email channel is a bonus, Telegram is the
   critical one. Requiring it at the top would crash the whole function on
   load when the package is not installed, taking Telegram down with it. */
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch (e) {
  nodemailer = null;
}

/* Credentials live in the hosting environment variables, never in this file:
   the repository is public. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in
   Vercel > Settings > Environment Variables. */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || "Krakowinsider.tour@gmail.com";

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "PASTE_SMTP_USER_HERE";
const SMTP_PASS = process.env.SMTP_PASS || "PASTE_SMTP_APP_PASSWORD_HERE";

function isConfigured(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("PASTE_");
}

function sanitize(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function validateLead(body) {
  const lead = {
    source: sanitize(body.source, 100) || "Krakow Insiders Website",
    name: sanitize(body.name, 120),
    phone: sanitize(body.phone, 40),
    email: sanitize(body.email, 160),
    type: sanitize(body.type, 120),
    date: sanitize(body.date, 20),
    people: sanitize(body.people, 10),
    message: sanitize(body.message, 2000),
    section: sanitize(body.section, 120),
    page: sanitize(body.page, 300),
    lang: sanitize(body.lang, 5),
    submittedAt: sanitize(body.submittedAt, 40) || new Date().toISOString()
  };

  const errors = [];
  if (lead.name.length < 2) errors.push("name");
  if (!/^[+\d][\d\s\-()]{5,19}$/.test(lead.phone)) errors.push("phone");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) errors.push("email");
  if (!lead.type) errors.push("type");
  if (!lead.date) errors.push("date");
  const people = parseInt(lead.people, 10);
  if (isNaN(people) || people < 1 || people > 60) errors.push("people");

  return { lead, errors };
}

function formatLeadText(lead) {
  return [
    "New lead — " + lead.source,
    "",
    "Name: " + lead.name,
    "Phone/WhatsApp: " + lead.phone,
    "Email: " + lead.email,
    "Tour/Transfer type: " + lead.type,
    "Date: " + lead.date,
    "Number of people: " + lead.people,
    "Message: " + (lead.message || "—"),
    "",
    "Section: " + (lead.section || "—"),
    "Page: " + (lead.page || "—"),
    "Site language: " + (lead.lang || "—"),
    "Submitted at: " + lead.submittedAt
  ].join("\n");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* Telegram uses parse_mode: HTML. Only <b>, <i>, <code>, <a> are allowed there,
   so every dynamic value goes through escapeHtml() first. */
function formatTelegramHtml(lead) {
  const isTransfer = /transfer/i.test(lead.type);
  const headline = isTransfer ? "🚗 New transfer request" : "🧭 New tour request";

  const lines = [
    "<b>" + headline + "</b>",
    "━━━━━━━━━━━━━━━",
    "",
    "👤 <b>Name:</b> " + escapeHtml(lead.name),
    "📱 <b>Phone / WhatsApp:</b> " + escapeHtml(lead.phone),
    "✉️ <b>Email:</b> " + escapeHtml(lead.email),
    "",
    "📍 <b>Type:</b> " + escapeHtml(lead.type),
    "📅 <b>Date:</b> " + escapeHtml(lead.date),
    "👥 <b>People:</b> " + escapeHtml(lead.people)
  ];

  if (lead.message) {
    lines.push("", "💬 <b>Message:</b>", escapeHtml(lead.message));
  }

  lines.push(
    "",
    "━━━━━━━━━━━━━━━",
    "🔖 <b>Section:</b> " + escapeHtml(lead.section || "—"),
    "🌐 <b>Language:</b> " + escapeHtml((lead.lang || "—").toUpperCase()),
    "🕒 <b>Received:</b> " + escapeHtml(formatWarsawTime(lead.submittedAt))
  );

  if (lead.page) {
    lines.push('🔗 <a href="' + escapeHtml(lead.page) + '">Page the lead came from</a>');
  }

  return lines.join("\n");
}

function formatWarsawTime(isoString) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Warsaw",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date) + " (Krakow time)";
  } catch (e) {
    return date.toISOString();
  }
}

async function sendToTelegram(lead) {
  if (!isConfigured(TELEGRAM_BOT_TOKEN) || !isConfigured(TELEGRAM_CHAT_ID)) {
    return { channel: "telegram", ok: false, skipped: true, reason: "not configured" };
  }

  const url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: formatTelegramHtml(lead),
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(function () {
      return "";
    });
    throw new Error("Telegram API error " + response.status + ": " + detail.slice(0, 300));
  }

  return { channel: "telegram", ok: true };
}

async function sendEmail(lead, text) {
  if (!nodemailer) {
    return { channel: "email", ok: false, skipped: true, reason: "nodemailer not installed" };
  }
  if (!isConfigured(SMTP_USER) || !isConfigured(SMTP_PASS)) {
    return { channel: "email", ok: false, skipped: true, reason: "not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  await transporter.sendMail({
    from: '"Krakow Insiders Website" <' + SMTP_USER + ">",
    to: RECIPIENT_EMAIL,
    replyTo: lead.email,
    subject: "New lead: " + lead.type + " — " + lead.name,
    text: text
  });

  return { channel: "email", ok: true };
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }
  if (!body || typeof body !== "object") {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
    return;
  }

  const { lead, errors } = validateLead(body);
  if (errors.length > 0) {
    res.statusCode = 422;
    res.end(JSON.stringify({ ok: false, error: "Validation failed", fields: errors }));
    return;
  }

  const text = formatLeadText(lead);

  const results = await Promise.allSettled([sendToTelegram(lead), sendEmail(lead, text)]);

  const outcomes = results.map(function (result) {
    if (result.status === "fulfilled") return result.value;
    return { ok: false, error: String(result.reason && result.reason.message ? result.reason.message : result.reason) };
  });

  const delivered = outcomes.some(function (outcome) {
    return outcome.ok === true;
  });

  if (delivered) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, channels: outcomes }));
  } else {
    res.statusCode = 502;
    res.end(JSON.stringify({ ok: false, error: "No delivery channel succeeded", channels: outcomes }));
  }
};
