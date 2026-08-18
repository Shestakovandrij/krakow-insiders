/* ==========================================================================
   Krakow Insiders — GitHub as the store

   Everything the panel edits lives on the `panel-data` branch of this same
   repository, and these functions read and write it through the GitHub
   Contents API.

   Two decisions worth knowing:

   - It is a separate branch, not main. Writing to main would rebuild the
     site on every save, so a change would take a minute to appear — and,
     worse, every review a stranger submits would spend a deploy and land in
     the site's history. On its own branch nothing builds and writes are
     immediate.

   - The branch has no shared history with main, so browsing it shows four
     data files rather than a second copy of the site.
   ========================================================================== */

const API = "https://api.github.com";

const TOKEN = process.env.GITHUB_TOKEN || "";

/* Vercel injects the repository it deploys from, so a git-connected project
   needs no configuration beyond the token. The explicit vars are there for
   running outside Vercel. */
const OWNER = process.env.GITHUB_OWNER || process.env.VERCEL_GIT_REPO_OWNER || "";
const REPO = process.env.GITHUB_REPO || process.env.VERCEL_GIT_REPO_SLUG || "";
const BRANCH = process.env.GITHUB_DATA_BRANCH || "panel-data";

function isConfigured() {
  return TOKEN.length > 0 && OWNER.length > 0 && REPO.length > 0;
}

function describe() {
  return { owner: OWNER, repo: REPO, branch: BRANCH, tokenPresent: TOKEN.length > 0 };
}

function contentsUrl(filePath) {
  return API + "/repos/" + OWNER + "/" + REPO + "/contents/" +
    filePath.split("/").map(encodeURIComponent).join("/");
}

function headers(extra) {
  return Object.assign({
    Authorization: "Bearer " + TOKEN,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "krakow-insiders-panel"
  }, extra || {});
}

async function fail(response, what) {
  const detail = await response.text().catch(function () { return ""; });
  const error = new Error("GitHub " + what + " failed: " + response.status + " " + detail.slice(0, 200));
  error.status = response.status;
  throw error;
}

/* --------------------------------------------------------------------------
   Read
   -------------------------------------------------------------------------- */

/* Returns { buffer, sha } or null when the file does not exist yet — which is
   the normal state of config.json and pending.json on a fresh deploy.

   The cache-buster matters: GitHub serves this endpoint through a cache, and
   without it the panel can read back the version it just overwrote. */
async function getFile(filePath) {
  const url = contentsUrl(filePath) + "?ref=" + encodeURIComponent(BRANCH) + "&t=" + Date.now();
  const response = await fetch(url, { headers: headers({ "Cache-Control": "no-cache" }) });

  if (response.status === 404) return null;
  if (!response.ok) await fail(response, "read of " + filePath);

  const data = await response.json();
  if (Array.isArray(data)) return null; /* a directory, not a file */

  return {
    sha: data.sha,
    buffer: Buffer.from(data.content || "", data.encoding === "base64" ? "base64" : "utf8")
  };
}

async function readText(filePath) {
  const file = await getFile(filePath);
  return file ? file.buffer.toString("utf8") : null;
}

/* --------------------------------------------------------------------------
   Write
   -------------------------------------------------------------------------- */

/* The Contents API needs the sha of the version being replaced, so a write is
   read-then-write. If something else wrote in between GitHub answers 409; one
   retry with the fresh sha settles it. With a single owner editing that is
   already rare, but an approval and a save can overlap. */
async function putFile(filePath, buffer, message, attempt) {
  const existing = await getFile(filePath);

  const body = {
    message: message,
    content: Buffer.from(buffer).toString("base64"),
    branch: BRANCH
  };
  if (existing) body.sha = existing.sha;

  const response = await fetch(contentsUrl(filePath), {
    method: "PUT",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });

  if (response.status === 409 && !attempt) {
    return putFile(filePath, buffer, message, 1);
  }
  if (!response.ok) await fail(response, "write of " + filePath);

  const data = await response.json();
  return { sha: data.content ? data.content.sha : null, commit: data.commit ? data.commit.sha : null };
}

function writeText(filePath, text, message) {
  return putFile(filePath, Buffer.from(text, "utf8"), message);
}

module.exports = { isConfigured, describe, getFile, readText, putFile, writeText, BRANCH };
