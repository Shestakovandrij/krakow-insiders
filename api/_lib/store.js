/* ==========================================================================
   Krakow Insiders — storage layer

   The panel keeps content in JSON, not in a database. Where that JSON lives
   depends on what the environment offers, checked in this order:

     - GITHUB_TOKEN — on the repository's `panel-data` branch. Every save is
       a commit, so the history of the site's content is a branch history
       and a bad edit is one revert away.

     - BLOB_READ_WRITE_TOKEN — in Vercel Blob. No version history, but the
       store is created by clicking "Connect Project" and needs no token
       issued by hand, which is the whole reason to prefer it.

     - Neither — in .local-store/ on disk. That is the local-development
       case; on Vercel the filesystem is read-only, so a deployment with no
       token cannot save at all, and the panel says so rather than failing
       silently.

   Nothing above this file knows which one is active.
   ========================================================================== */

const fs = require("fs/promises");
const path = require("path");

const github = require("./github");

/* The seed shipped with the repository. Required statically so Vercel's
   dependency tracing bundles it with the function; a runtime fs.readFile of
   the same path would not be traced and would 404 in production. */
const SEED_CONTENT = require("../../data/content.json");

const USE_GITHUB = github.isConfigured();
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const USE_BLOB = !USE_GITHUB && BLOB_TOKEN.length > 0;

const LOCAL_DIR = path.join(process.cwd(), ".local-store");

const CONTENT_KEY = "content.json";
const CONFIG_KEY = "config.json";
const PENDING_KEY = "pending.json";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* --------------------------------------------------------------------------
   Raw JSON read / write
   -------------------------------------------------------------------------- */

async function readJson(key) {
  if (USE_GITHUB) {
    const text = await github.readText(key);
    return text ? JSON.parse(text) : null;
  }

  if (USE_BLOB) {
    const { get } = require("@vercel/blob");
    /* useCache: false — the panel must read back exactly what it just
       wrote, and a CDN-cached copy would show the previous version. */
    const result = await get(key, { access: "private", useCache: false, token: BLOB_TOKEN });
    if (!result || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return text ? JSON.parse(text) : null;
  }

  try {
    const text = await fs.readFile(path.join(LOCAL_DIR, key), "utf8");
    return text ? JSON.parse(text) : null;
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(key, value, message) {
  const text = JSON.stringify(value, null, 2) + "\n";

  if (USE_GITHUB) {
    await github.writeText(key, text, message || ("Update " + key));
    return;
  }

  if (USE_BLOB) {
    const { put } = require("@vercel/blob");
    await put(key, text, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
      token: BLOB_TOKEN
    });
    return;
  }

  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, key), text, "utf8");
}

/* --------------------------------------------------------------------------
   Content
   -------------------------------------------------------------------------- */

/* Nothing saved yet — a fresh deploy, or a branch that was wiped — falls back
   to the seed, so the site always has tours and reviews to render. */
async function readContent() {
  const stored = await readJson(CONTENT_KEY);
  if (stored && Array.isArray(stored.tours)) return stored;
  return clone(SEED_CONTENT);
}

async function writeContent(content, message) {
  await writeJson(CONTENT_KEY, content, message || "Panel: update tours and reviews");
}

function seedContent() {
  return clone(SEED_CONTENT);
}

/* --------------------------------------------------------------------------
   Reviews submitted by visitors, waiting for the owner to look at them

   Kept apart from content.json on purpose: nothing a stranger sends can end
   up on the page by being written to the same file the site reads.
   -------------------------------------------------------------------------- */

async function readPending() {
  const stored = await readJson(PENDING_KEY);
  return stored && Array.isArray(stored.reviews) ? stored.reviews : [];
}

async function writePending(reviews, message) {
  await writeJson(PENDING_KEY, { version: 1, reviews: reviews }, message || "Panel: update the review queue");
}

/* --------------------------------------------------------------------------
   Panel config (password hash, session secret, lockout state)
   -------------------------------------------------------------------------- */

async function readConfig() {
  return readJson(CONFIG_KEY);
}

async function writeConfig(config, message) {
  await writeJson(CONFIG_KEY, config, message || "Panel: update credentials");
}

/* --------------------------------------------------------------------------
   Media
   -------------------------------------------------------------------------- */

const MEDIA_PREFIX = "media/";

async function writeMedia(name, buffer, message) {
  const key = MEDIA_PREFIX + name;

  if (USE_GITHUB) {
    await github.putFile(key, buffer, message || ("Panel: add " + key));
    /* Served through /api/media rather than a static path: the branch is not
       deployed, and once the repository is private nothing else can read it. */
    return "/m/" + name;
  }

  if (USE_BLOB) {
    const { put } = require("@vercel/blob");
    const result = await put(key, buffer, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
      token: BLOB_TOKEN
    });
    return result.url;
  }

  const dir = path.join(process.cwd(), "images", "uploads");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buffer);
  return "images/uploads/" + name;
}

async function readMedia(name) {
  if (USE_GITHUB) {
    const file = await github.getFile(MEDIA_PREFIX + name);
    return file ? file.buffer : null;
  }

  /* Blob serves its own files straight from its CDN, so /api/media is only
     ever asked for one when the store is git or local. */
  if (USE_BLOB) return null;

  try {
    return await fs.readFile(path.join(process.cwd(), "images", "uploads", name));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function mediaExists(name) {
  if (USE_GITHUB) return (await github.getFile(MEDIA_PREFIX + name)) !== null;
  if (USE_BLOB) return false;
  try {
    await fs.access(path.join(process.cwd(), "images", "uploads", name));
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  storageKind: USE_GITHUB ? "git" : (USE_BLOB ? "blob" : "local"),
  isPersistent: USE_GITHUB || USE_BLOB,
  gitInfo: github.describe(),
  readContent,
  writeContent,
  seedContent,
  readPending,
  writePending,
  readConfig,
  writeConfig,
  writeMedia,
  readMedia,
  mediaExists
};
