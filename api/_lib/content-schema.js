/* ==========================================================================
   Krakow Insiders — content validation

   Everything the panel sends is rebuilt field by field here. Nothing reaches
   the stored JSON that this file did not explicitly copy, so a malformed or
   hostile payload cannot smuggle extra keys onto the site.
   ========================================================================== */

const MAX = {
  tag: 60,
  title: 120,
  desc: 600,
  author: 120,
  text: 1200,
  name: 60,
  date: 20,
  amount: 30,
  url: 500,
  alt: 200,
  waType: 120
};

const PRICE_UNITS = ["person", "personDay", ""];
const IMAGE_FOCUS = ["", "left"];
const TOUR_KINDS = ["tour", "custom"];

function text(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLength);
}

/* Media values are one of three shapes: a file that ships with the repo
   (images/…, media/…), a file uploaded through the panel and served back by
   /api/media (/m/…), or an absolute https URL — a Blob upload, or a link the
   owner pasted. Anything else — javascript:, data:, protocol-relative — is
   dropped, because these values land in src attributes on the public site. */
function mediaUrl(value) {
  const raw = text(value, MAX.url);
  if (!raw) return "";
  if (raw.indexOf("..") !== -1) return "";
  if (/^https:\/\/[^\s"'<>]+$/i.test(raw)) return raw;
  if (/^\/m\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw)) return raw;
  if (/^(images|media)\/[A-Za-z0-9._\-\/]+$/.test(raw)) return raw;
  return "";
}

function oneOf(value, allowed, fallback) {
  const raw = text(value, 40);
  return allowed.indexOf(raw) === -1 ? fallback : raw;
}

function bool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function slugId(value, fallback) {
  const raw = text(value, 40)
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return raw || fallback;
}

function localized(source, fields, limits) {
  const input = source && typeof source === "object" ? source : {};
  const out = {};
  fields.forEach(function (field) {
    out[field] = text(input[field], limits[field]);
  });
  return out;
}

function normalizeTour(input, index) {
  const raw = input && typeof input === "object" ? input : {};
  const kind = oneOf(raw.kind, TOUR_KINDS, "tour");
  const price = raw.price && typeof raw.price === "object" ? raw.price : {};

  return {
    id: slugId(raw.id, "tour-" + (index + 1)),
    kind: kind,
    visible: raw.visible === undefined ? true : bool(raw.visible),
    image: kind === "custom" ? "" : mediaUrl(raw.image),
    imageAlt: kind === "custom" ? "" : text(raw.imageAlt, MAX.alt),
    imageFocus: kind === "custom" ? "" : oneOf(raw.imageFocus, IMAGE_FOCUS, ""),
    price: {
      amount: kind === "custom" ? "" : text(price.amount, MAX.amount),
      from: kind === "custom" ? false : bool(price.from),
      unit: kind === "custom" ? "" : oneOf(price.unit, PRICE_UNITS, "person")
    },
    whatsappType: kind === "custom" ? "" : text(raw.whatsappType, MAX.waType),
    en: localized(raw.en, ["tag", "title", "desc"], MAX),
    pl: localized(raw.pl, ["tag", "title", "desc"], MAX)
  };
}

function normalizeVideoReview(input, index) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    id: slugId(raw.id, "v" + (index + 1)),
    visible: raw.visible === undefined ? true : bool(raw.visible),
    name: text(raw.name, MAX.name),
    date: text(raw.date, MAX.date),
    photo: mediaUrl(raw.photo),
    video: mediaUrl(raw.video),
    videoWebm: mediaUrl(raw.videoWebm)
  };
}

function normalizeTextReview(input, index) {
  const raw = input && typeof input === "object" ? input : {};
  let stars = parseInt(raw.stars, 10);
  if (isNaN(stars) || stars < 1 || stars > 5) stars = 5;

  return {
    id: slugId(raw.id, "r" + (index + 1)),
    visible: raw.visible === undefined ? true : bool(raw.visible),
    avatar: mediaUrl(raw.avatar),
    date: text(raw.date, MAX.date),
    stars: stars,
    en: localized(raw.en, ["author", "text"], MAX),
    pl: localized(raw.pl, ["author", "text"], MAX)
  };
}

/* Hard ceilings on list length: the panel has no reason to send hundreds of
   entries, and an unbounded array would be an easy way to bloat the store. */
const LIMITS = { tours: 40, videoReviews: 60, textReviews: 60 };

function list(value, limit, normalize) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map(normalize);
}

function normalizeContent(input) {
  const raw = input && typeof input === "object" ? input : {};
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tours: list(raw.tours, LIMITS.tours, normalizeTour),
    videoReviews: list(raw.videoReviews, LIMITS.videoReviews, normalizeVideoReview),
    textReviews: list(raw.textReviews, LIMITS.textReviews, normalizeTextReview)
  };
}

/* Only entries the visitor should see, with the editing-only flags dropped. */
function publicContent(content) {
  const visible = function (item) { return item.visible !== false; };
  return {
    updatedAt: content.updatedAt || "",
    tours: (content.tours || []).filter(visible),
    videoReviews: (content.videoReviews || []).filter(visible),
    textReviews: (content.textReviews || []).filter(visible)
  };
}

/* --------------------------------------------------------------------------
   Reviews submitted through the form on the site

   Written by strangers, so the limits are tighter than for panel content and
   every field is rebuilt the same way. A submission carries no id and no
   visibility flag — it is not part of the site until the owner approves it,
   and approval is what turns it into a real review.
   -------------------------------------------------------------------------- */

const SUBMISSION_MAX = { name: 60, country: 60, text: 1200, url: 500, date: 20 };

function normalizeSubmission(input) {
  const raw = input && typeof input === "object" ? input : {};

  let stars = parseInt(raw.stars, 10);
  if (isNaN(stars) || stars < 1 || stars > 5) stars = 5;

  return {
    name: text(raw.name, SUBMISSION_MAX.name),
    country: text(raw.country, SUBMISSION_MAX.country),
    text: text(raw.text, SUBMISSION_MAX.text),
    stars: stars,
    photo: mediaUrl(raw.photo),
    video: mediaUrl(raw.video)
  };
}

function validateSubmission(submission) {
  const errors = [];
  if (submission.name.length < 2) errors.push("name");
  if (submission.text.length < 20) errors.push("text");
  return errors;
}

/* Stored entries also keep when they arrived and a local id, so the panel can
   list and act on them. */
function normalizePendingList(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map(function (raw, index) {
    const item = raw && typeof raw === "object" ? raw : {};
    const submission = normalizeSubmission(item);
    return {
      id: slugId(item.id, "p" + (index + 1)),
      submittedAt: text(item.submittedAt, 40),
      name: submission.name,
      country: submission.country,
      text: submission.text,
      stars: submission.stars,
      photo: submission.photo,
      video: submission.video
    };
  });
}

/* Approval maps a submission onto the shape the site already renders. The
   guest wrote in one language; it goes into the English slot because that is
   what the markup falls back to, and the owner can add Polish afterwards. */
function approveAsTextReview(pending, existing) {
  const author = pending.country
    ? pending.name + " — " + pending.country
    : pending.name;

  return normalizeTextReview({
    id: uniqueReviewId("r", existing),
    visible: true,
    avatar: pending.photo,
    date: pending.submittedAt ? formatDate(pending.submittedAt) : "",
    stars: pending.stars,
    en: { author: author, text: pending.text },
    pl: { author: author, text: "" }
  }, existing.length);
}

function approveAsVideoReview(pending, existing) {
  return normalizeVideoReview({
    id: uniqueReviewId("v", existing),
    visible: true,
    name: pending.name,
    date: pending.submittedAt ? formatDate(pending.submittedAt) : "",
    photo: pending.photo,
    video: pending.video,
    videoWebm: ""
  }, existing.length);
}

function uniqueReviewId(prefix, existing) {
  const taken = {};
  (existing || []).forEach(function (item) { taken[item.id] = true; });
  let index = (existing || []).length + 1;
  let candidate = prefix + index;
  while (taken[candidate]) {
    index += 1;
    candidate = prefix + index;
  }
  return candidate;
}

/* The site prints dates as written, and every existing one is dd.mm.yyyy. */
function formatDate(isoString) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "";
  const pad = function (n) { return (n < 10 ? "0" : "") + n; };
  return pad(date.getDate()) + "." + pad(date.getMonth() + 1) + "." + date.getFullYear();
}

module.exports = {
  normalizeContent,
  publicContent,
  normalizeSubmission,
  validateSubmission,
  normalizePendingList,
  approveAsTextReview,
  approveAsVideoReview
};
