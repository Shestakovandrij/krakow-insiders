/* ==========================================================================
   Krakow Insiders — storage layer

   The panel keeps content in JSON, not in a database. Where that JSON lives
   depends on the environment:

     - Deployed, with a GitHub token: on the repository's `panel-data`
       branch. Every save is a commit, so the history of the site's content
       is the history of that branch and a bad edit is one revert away.

     - Locally, with no token: in .local-store/ on disk. Same shape, same
       calls, so the whole panel can be exercised before deploying.

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

  try {
    return await fs.readFile(path.join(process.cwd(), "images", "uploads", name));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function mediaExists(name) {
  if (USE_GITHUB) return (await github.getFile(MEDIA_PREFIX + name)) !== null;
  try {
    await fs.access(path.join(process.cwd(), "images", "uploads", name));
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  storageKind: USE_GITHUB ? "git" : "local",
  isPersistent: USE_GITHUB,
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
