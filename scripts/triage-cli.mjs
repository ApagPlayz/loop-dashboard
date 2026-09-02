#!/usr/bin/env node
/**
 * Backlog-triage agent — CLI driver.
 *
 * Runs the LangGraph.js graph in lib/agent/ against a real repo, prints the
 * model's proposals as a table, halts for your decisions, then resumes the
 * graph and prints what it would apply.
 *
 * DRY-RUN BY DEFAULT. Nothing is written to GitHub unless you pass --apply.
 *
 * Usage:
 *   node scripts/triage-cli.mjs
 *   node scripts/triage-cli.mjs --repo=owner/name --limit=10
 *   echo "" | node scripts/triage-cli.mjs            (non-interactive: accept all)
 *   node scripts/triage-cli.mjs --apply              (actually writes to GitHub)
 *
 * At the prompt:
 *   <enter>          accept every recommendation as-is
 *   12=d 15=n 18=s   override those issues (a=approve d=decline n=needs-info s=skip)
 *   q                quit without resuming
 *
 * Why `runnerImport`: lib/map-ai.ts uses TypeScript syntax that Node's
 * strip-only loader can't handle (parameter properties), so we borrow Vite —
 * already present via vitest — to transpile the lib/ tree on the fly.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ */
/* Args + env                                                          */
/* ------------------------------------------------------------------ */

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const DEFAULT_REPO_SLUG = "ApagPlayz/content-generation-platform";

/** Read GITHUB_TOKEN from the environment, falling back to .env.local. */
async function loadToken() {
  if (process.env.GITHUB_TOKEN) return true;
  try {
    const env = await fs.readFile(path.join(ROOT, ".env.local"), "utf-8");
    const m = env.match(/^GITHUB_TOKEN=(.+)$/m);
    if (m && m[1].trim()) {
      process.env.GITHUB_TOKEN = m[1].trim();
      return true;
    }
  } catch {
    /* no .env.local — fall through */
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Pretty printing                                                     */
/* ------------------------------------------------------------------ */

const MARK = { approve: "✔ approve", decline: "✘ decline", "needs-info": "? needs-info" };

function truncate(s, n) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function table(rows, columns) {
  const widths = columns.map((c) =>
    Math.max(c.header.length, ...rows.map((r) => String(c.get(r)).length)),
  );
  const line = (cells) =>
    cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ").trimEnd();
  const out = [line(columns.map((c) => c.header)), line(widths.map((w) => "─".repeat(w)))];
  for (const r of rows) out.push(line(columns.map((c) => c.get(r))));
  return out.join("\n");
}

function printProposals(proposals) {
  console.log(
    table(proposals, [
      { header: "#", get: (p) => `#${p.number}` },
      { header: "TITLE", get: (p) => truncate(p.title, 46) },
      { header: "RECOMMENDATION", get: (p) => MARK[p.recommendation] ?? p.recommendation },
      { header: "CONF", get: (p) => p.confidence.toFixed(2) },
      { header: "REASON", get: (p) => truncate(p.reason, 72) },
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Reading the human's decisions                                       */
/* ------------------------------------------------------------------ */

const ALIASES = {
  a: "approve", approve: "approve",
  d: "decline", decline: "decline",
  n: "needs-info", "needs-info": "needs-info", needsinfo: "needs-info",
  s: "skip", skip: "skip",
};

/**
 * Start from the model's recommendation for every proposal, then apply
 * `12=d 15=s` style overrides. Returns null if the user asked to quit.
 */
function buildDecisions(proposals, input) {
  const decisions = new Map(
    proposals.map((p) => [p.number, { number: p.number, action: p.recommendation }]),
  );
  const raw = input.trim();
  if (!raw) return [...decisions.values()];
  if (/^q(uit)?$/i.test(raw)) return null;

  for (const token of raw.split(/[\s,]+/).filter(Boolean)) {
    const m = token.match(/^#?(\d+)\s*[=:]\s*(.+)$/);
    if (!m) {
      console.warn(`  (ignored unparseable token: ${token})`);
      continue;
    }
    const number = Number(m[1]);
    const action = ALIASES[m[2].toLowerCase()];
    if (!action) {
      console.warn(`  (ignored unknown action in: ${token})`);
      continue;
    }
    if (!decisions.has(number)) {
      console.warn(`  (ignored #${number}: not in this batch)`);
      continue;
    }
    decisions.set(number, { number, action });
  }
  return [...decisions.values()];
}

/** One line from stdin — interactive prompt, or the whole piped buffer. */
async function readDecisionLine(prompt) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf-8");
    const first = text.split("\n")[0] ?? "";
    console.log(`${prompt}${first}   (from stdin)`);
    return first;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(prompt, resolve));
  } finally {
    rl.close();
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const slug = flag("repo", DEFAULT_REPO_SLUG);
  const [owner, name] = slug.split("/");
  if (!owner || !name) throw new Error(`--repo must look like owner/name (got "${slug}")`);
  const limit = Number(flag("limit", "15"));
  const apply = has("apply");

  if (!(await loadToken())) {
    throw new Error("GITHUB_TOKEN not found in the environment or in .env.local.");
  }

  // Vite transpiles the TS lib/ tree for us (see header note).
  const { runnerImport } = await import("vite");
  const { module: agent } = await runnerImport(path.join(ROOT, "lib", "agent", "index.ts"));
  const { module: ai } = await runnerImport(path.join(ROOT, "lib", "map-ai.ts"));

  console.log(`\nBacklog triage — ${slug}`);
  console.log(`  mode      : ${apply ? "APPLY (will write to GitHub)" : "DRY RUN (no writes)"}`);
  console.log(`  llm       : ${ai.aiBackend()} backend, model ${ai.aiModel()}`);
  console.log(`  max issues: ${limit}\n`);

  console.log("Running graph: load_backlog → assess → propose → [interrupt] …");
  const started = Date.now();
  const session = await agent.startTriage({ repo: { owner, repo: name }, limit, apply });
  console.log(
    `Graph HALTED at the human-in-the-loop interrupt after ${((Date.now() - started) / 1000).toFixed(1)}s ` +
      `(thread ${session.threadId}).\n`,
  );

  if (session.proposals.length === 0) {
    console.log("No open issues to triage. Nothing to decide.");
    return;
  }

  printProposals(session.proposals);

  console.log(
    "\nEnter overrides as `12=d 15=n` (a=approve d=decline n=needs-info s=skip),",
  );
  console.log("or press enter to accept every recommendation. `q` quits.");
  const decisions = buildDecisions(
    session.proposals,
    await readDecisionLine("decisions> "),
  );
  if (decisions === null) {
    console.log("\nQuit — graph left paused, nothing applied.");
    return;
  }

  console.log("\nResuming graph with your decisions via Command({ resume }) …");
  const result = await session.resume(decisions);

  console.log(`\n${apply ? "APPLIED" : "WOULD APPLY"} (${result.actions.length} action(s)):`);
  for (const a of result.actions) {
    const status = a.error ? `FAILED: ${a.error}` : a.applied ? "done" : "dry-run";
    console.log(`  • ${a.summary}   [${status}]`);
  }
  if (!apply) console.log("\nNothing was written. Re-run with --apply to actually do it.");
}

main().catch((err) => {
  console.error(`\ntriage-cli failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
