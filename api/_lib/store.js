/* ==========================================================================
   Krakow Insiders — storage layer

   The panel keeps content in JSON, not in a database. Where that JSON lives
   depends on the environment:

     - On Vercel the filesystem is read-only, so the JSON goes to Vercel Blob
       (private blobs — only these functions can read them).
     - Locally there is no Blob token, so the same JSON goes to .local-store/
       on disk. That makes the whole panel testable before deploying.

   Both branches expose the same three calls, so nothing above this file has
   to know which one is active.
   ========================================================================== */

const fs = require("fs/promises");
const path = require("path");

/* The seed shipped with the repository. Required statically so Vercel's
   dependency tracing bundles it with the function; a runtime fs.readFile of
   the same path would not be traced and would 404 in production. */
const SEED_CONTENT = require("../../data/content.json");

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const USE_BLOB = BLOB_TOKEN.length > 0;
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
  if (USE_BLOB) {
    const { get } = require("@vercel/blob");
    /* useCache: false — the panel must read back exactly what it just wrote,
       and a CDN-cached copy would show the previous version for minutes. */
    const result = await get(key, {
      access: "private",
      useCache: false,
      token: BLOB_TOKEN
    });
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

async function writeJson(key, value) {
  const text = JSON.stringify(value, null, 2);

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

/* Nothing saved yet — a fresh deploy, or a store that was wiped — falls back
   to the seed, so the site always has tours and reviews to render. */
async function readContent() {
  const stored = await readJson(CONTENT_KEY);
  if (stored && Array.isArray(stored.tours)) return stored;
  return clone(SEED_CONTENT);
}

async function writeContent(content) {
  await writeJson(CONTENT_KEY, content);
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

async function writePending(reviews) {
  await writeJson(PENDING_KEY, { version: 1, reviews: reviews });
}

/* --------------------------------------------------------------------------
   Panel config (password hash, session secret, lockout state)
   -------------------------------------------------------------------------- */

async function readConfig() {
  return readJson(CONFIG_KEY);
}

async function writeConfig(config) {
  await writeJson(CONFIG_KEY, config);
}

module.exports = {
  isBlobConfigured: USE_BLOB,
  readContent,
  writeContent,
  seedContent,
  readPending,
  writePending,
  readConfig,
  writeConfig
};
