#!/usr/bin/env node
/**
 * Step 1 of the dedup pipeline — extract the corpus.
 *
 * Pulls EVERY issue and pull request (all states) from a GitHub repo via the
 * authenticated `gh` CLI and writes one JSON object per line to
 * `data/corpus.jsonl`.
 *
 * Why `gh` and not lib/github.ts: the dashboard's Octokit client needs
 * GITHUB_TOKEN wired through Next's env loading, and the backlog's step 0 says
 * that token is mid-rotation. `gh` is already authenticated on this machine and
 * these scripts are offline data-prep, not app code.
 *
 * Two REST endpoints are used because neither alone is enough:
 *   /issues?state=all  → issues AND pull requests, with labels + body.
 *                        (GitHub models PRs as issues here, but omits merged_at.)
 *   /pulls?state=all   → the PRs again, this time carrying merged_at.
 * They are joined on `number`.
 *
 * Idempotent: output is sorted by number and serialized deterministically, so a
 * re-run on unchanged data produces a byte-identical file. Existing content is
 * only replaced once the new fetch has fully succeeded.
 *
 * Usage:
 *   node scripts/ml/extract-corpus.mjs
 *   node scripts/ml/extract-corpus.mjs --repo=owner/name --out=data/corpus.jsonl
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_REPO = "ApagPlayz/content-generation-platform";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

/**
 * Run `gh api --paginate --slurp <path>` and return the flattened array.
 * `--slurp` makes gh emit ONE array-of-pages instead of concatenated pages, so
 * the output is always valid JSON no matter how many pages came back.
 */
async function ghApiPaginated(apiPath) {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--paginate", "--slurp", apiPath],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  const pages = JSON.parse(stdout);
  return Array.isArray(pages) ? pages.flat() : [];
}

/** null-safe string. GitHub returns `body: null` for empty bodies constantly. */
function str(v) {
  return typeof v === "string" ? v : "";
}

/** null-safe optional string — keeps null rather than inventing "". */
function nullableStr(v) {
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function main() {
  const repo = arg("repo", DEFAULT_REPO);
  const outRel = arg("out", path.join("data", "corpus.jsonl"));
  const outPath = path.isAbsolute(outRel) ? outRel : path.join(ROOT, outRel);
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    console.error(`Bad --repo=${repo}; expected owner/name`);
    process.exit(1);
  }

  console.log(`Fetching issues + PRs from ${repo} …`);

  const [issues, pulls] = await Promise.all([
    ghApiPaginated(`repos/${owner}/${name}/issues?state=all&per_page=100`),
    ghApiPaginated(`repos/${owner}/${name}/pulls?state=all&per_page=100`),
  ]);

  // merged_at only exists on the pulls endpoint.
  const mergedByNumber = new Map();
  for (const p of pulls) {
    if (typeof p?.number === "number") mergedByNumber.set(p.number, p.merged_at ?? null);
  }

  const byNumber = new Map();

  for (const it of issues) {
    if (typeof it?.number !== "number") continue;
    const isPr = Boolean(it.pull_request);
    byNumber.set(it.number, {
      number: it.number,
      type: isPr ? "pr" : "issue",
      title: str(it.title),
      body: str(it.body),
      labels: Array.isArray(it.labels)
        ? it.labels.map((l) => (typeof l === "string" ? l : str(l?.name))).filter(Boolean)
        : [],
      state: str(it.state) || "unknown",
      author: nullableStr(it.user?.login),
      created_at: nullableStr(it.created_at),
      closed_at: nullableStr(it.closed_at),
      merged_at: isPr ? (mergedByNumber.get(it.number) ?? null) : null,
    });
  }

  // Safety net: a PR that the /issues endpoint somehow missed (it has never
  // happened on this repo, but a silent gap in the corpus would be invisible).
  for (const p of pulls) {
    if (typeof p?.number !== "number" || byNumber.has(p.number)) continue;
    byNumber.set(p.number, {
      number: p.number,
      type: "pr",
      title: str(p.title),
      body: str(p.body),
      labels: Array.isArray(p.labels) ? p.labels.map((l) => str(l?.name)).filter(Boolean) : [],
      state: str(p.state) || "unknown",
      author: nullableStr(p.user?.login),
      created_at: nullableStr(p.created_at),
      closed_at: nullableStr(p.closed_at),
      merged_at: p.merged_at ?? null,
    });
  }

  const docs = [...byNumber.values()].sort((a, b) => a.number - b.number);

  // Deterministic key order → byte-identical output for identical input.
  const KEYS = [
    "number", "type", "title", "body", "labels",
    "state", "author", "created_at", "closed_at", "merged_at",
  ];
  const lines = docs.map((d) => {
    const ordered = {};
    for (const k of KEYS) ordered[k] = d[k];
    return JSON.stringify(ordered);
  });
  const next = lines.join("\n") + (lines.length ? "\n" : "");

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  let prev = null;
  try {
    prev = await fs.readFile(outPath, "utf-8");
  } catch {
    /* first run */
  }
  if (prev === next) {
    console.log(`No change — ${outPath} already up to date.`);
  } else {
    await fs.writeFile(outPath, next, "utf-8");
    console.log(`Wrote ${outPath}`);
  }

  const nIssues = docs.filter((d) => d.type === "issue").length;
  const nPrs = docs.filter((d) => d.type === "pr").length;
  const empty = docs.filter((d) => !d.body.trim()).length;
  console.log(
    `${docs.length} documents (${nIssues} issues, ${nPrs} PRs). ` +
      `${empty} have an empty body. ` +
      `open=${docs.filter((d) => d.state === "open").length} ` +
      `closed=${docs.filter((d) => d.state === "closed").length} ` +
      `merged=${docs.filter((d) => d.merged_at).length}`,
  );
}

main().catch((err) => {
  console.error("extract-corpus failed:", err?.message ?? err);
  process.exit(1);
});
