#!/usr/bin/env node
/**
 * Backlog-triage agent — human-in-the-loop PROOF harness.
 *
 * `triage-cli.mjs` is the ergonomic driver. This one is the receipt: it drives
 * the compiled graph directly so it can print the things a claim of "the
 * interrupt really works" has to be backed by —
 *
 *   1. invoke() returns with a top-level `__interrupt__` key and NO actions
 *   2. getState() reports next: ["apply_decisions"] while paused
 *   3. resume happens via `new Command({ resume })` on the SAME thread_id
 *   4. getState() reports next: [] once it has run to completion
 *   5. DIFFERENT human decisions on the same proposals produce DIFFERENT
 *      actions — the human, not the model, is deciding
 *
 * DRY RUN ONLY. This harness never sets `apply`, so nothing can reach GitHub.
 *
 * Usage:
 *   node scripts/triage-interrupt-proof.mjs
 *   node scripts/triage-interrupt-proof.mjs --repo=owner/name --limit=8
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tsLoader } from "./lib/load-ts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

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
    /* no .env.local */
  }
  return false;
}

const rule = (label) => console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
const j = (v) => JSON.stringify(v, null, 2);

/** Flip every recommendation to a different action, so nothing matches run A. */
const FLIP = { approve: "decline", decline: "needs-info", "needs-info": "skip" };

/** Set once the Vite loader is up, so the `finally` below can shut it down. */
let closeLoader = async () => {};

async function main() {
  const slug = flag("repo", "ApagPlayz/content-generation-platform");
  const [owner, repo] = slug.split("/");
  const limit = Number(flag("limit", "8"));

  if (!(await loadToken())) {
    throw new Error("GITHUB_TOKEN not found in the environment or in .env.local.");
  }

  const load = await tsLoader();
  closeLoader = load.close;
  const agent = await load("lib/agent/index.ts");
  const ai = await load("lib/map-ai.ts");
  const { Command } = await import("@langchain/langgraph");

  const graph = agent.buildTriageGraph(agent.realDeps());
  const input = { repo: { owner, repo }, limit, apply: false };

  console.log(`repo        : ${slug}`);
  console.log(`limit       : ${limit}`);
  console.log(`apply       : false  (DRY RUN — nothing can be written to GitHub)`);
  console.log(`ai backend  : ${ai.aiBackend()}`);
  console.log(`ai model    : ${ai.aiModel()}`);
  console.log(`node        : ${process.version}`);
  console.log(`started     : ${new Date().toISOString()}`);

  /* ---------------------------------------------------------------- */
  /* RUN A — accept every recommendation the model made                */
  /* ---------------------------------------------------------------- */

  const threadA = `proof-A-${Date.now()}`;
  const configA = { configurable: { thread_id: threadA } };

  rule(`RUN A — first invoke(), thread_id = ${threadA}`);
  const t0 = Date.now();
  const firstA = await graph.invoke(input, configA);
  const haltMs = Date.now() - t0;
  console.log(`invoke() returned after ${(haltMs / 1000).toFixed(1)}s`);

  rule("PROOF 1 — invoke() HALTED: top-level __interrupt__ present, no actions");
  console.log(`Object.keys(result)        : ${j(Object.keys(firstA))}`);
  console.log(`"__interrupt__" in result  : ${"__interrupt__" in firstA}`);
  console.log(`result.actions             : ${j(firstA.actions)}   <- no actions taken`);
  console.log(`result.decisions           : ${j(firstA.decisions)}   <- no decisions yet`);
  console.log(`result.proposals.length    : ${firstA.proposals.length}`);
  console.log(`\n--- full __interrupt__ payload ---`);
  console.log(j(firstA.__interrupt__));

  rule("PROOF 2 — getState() while PAUSED");
  const pausedA = await graph.getState(configA);
  console.log(`next                       : ${j(pausedA.next)}`);
  console.log(`tasks[0].name              : ${j(pausedA.tasks[0]?.name)}`);
  console.log(`tasks[0].interrupts        : ${j(pausedA.tasks[0]?.interrupts?.map((i) => ({
    id: i.id,
    resumable: i.resumable,
    ns: i.ns,
    valueKind: i.value?.kind,
    proposalCount: i.value?.proposals?.length,
  })))}`);
  console.log(`checkpoint id              : ${j(pausedA.config?.configurable?.checkpoint_id)}`);
  console.log(`values.actions             : ${j(pausedA.values.actions)}`);

  const proposals = firstA.proposals;
  rule("MODEL PROPOSALS (what the human is being asked to rule on)");
  for (const p of proposals) {
    console.log(
      `#${p.number}  ${p.recommendation.padEnd(10)} conf=${p.confidence.toFixed(2)}  ${p.title}`,
    );
  }

  const decisionsA = proposals.map((p) => ({ number: p.number, action: p.recommendation }));
  rule("PROOF 3 — resume RUN A via new Command({ resume }) on the SAME thread_id");
  console.log(`thread_id                  : ${threadA}  (identical to the halted run)`);
  console.log(`decisions handed back      :`);
  console.log(j(decisionsA));
  const tResumeA = Date.now();
  const doneA = await graph.invoke(new Command({ resume: decisionsA }), configA);
  console.log(`\nresume completed in ${((Date.now() - tResumeA) / 1000).toFixed(1)}s`);
  console.log(`"__interrupt__" in result  : ${"__interrupt__" in doneA}   <- gone: it ran through`);
  console.log(`\nRUN A actions (${doneA.actions.length}):`);
  for (const a of doneA.actions) {
    console.log(`  ${String(a.kind).padEnd(10)} applied=${a.applied}  ${a.summary}`);
  }

  rule("PROOF 4 — getState() AFTER resume");
  const finalA = await graph.getState(configA);
  console.log(`next                       : ${j(finalA.next)}   <- empty: graph is done`);
  console.log(`tasks                      : ${j(finalA.tasks)}`);
  console.log(`values.actions.length      : ${finalA.values.actions.length}`);
  console.log(`values.decisions.length    : ${finalA.values.decisions.length}`);

  /* ---------------------------------------------------------------- */
  /* RUN B — same graph, same repo, DIFFERENT human decisions          */
  /* ---------------------------------------------------------------- */

  const threadB = `proof-B-${Date.now()}`;
  const configB = { configurable: { thread_id: threadB } };

  rule(`RUN B — fresh thread_id = ${threadB}, human OVERRIDES every recommendation`);
  const tB = Date.now();
  const firstB = await graph.invoke(input, configB);
  console.log(`invoke() halted again after ${((Date.now() - tB) / 1000).toFixed(1)}s`);
  console.log(`"__interrupt__" in result  : ${"__interrupt__" in firstB}`);
  const pausedB = await graph.getState(configB);
  console.log(`getState().next            : ${j(pausedB.next)}`);

  const decisionsB = firstB.proposals.map((p) => ({
    number: p.number,
    action: FLIP[p.recommendation] ?? "skip",
    ...(FLIP[p.recommendation] === "needs-info"
      ? { note: "Human override: explain the acceptance criteria before this moves." }
      : {}),
  }));
  console.log(`\ndecisions handed back (every one flipped away from the model's pick):`);
  console.log(j(decisionsB));

  const doneB = await graph.invoke(new Command({ resume: decisionsB }), configB);
  const finalB = await graph.getState(configB);
  console.log(`\ngetState().next after resume: ${j(finalB.next)}`);
  console.log(`\nRUN B actions (${doneB.actions.length}):`);
  for (const a of doneB.actions) {
    console.log(`  ${String(a.kind).padEnd(10)} applied=${a.applied}  ${a.summary}`);
  }

  /* ---------------------------------------------------------------- */
  /* PROOF 5 — side-by-side                                            */
  /* ---------------------------------------------------------------- */

  rule("PROOF 5 — SAME proposals, DIFFERENT human decisions → DIFFERENT actions");
  const bByNumber = new Map(doneB.actions.map((a) => [a.number, a]));
  const aByNumber = new Map(doneA.actions.map((a) => [a.number, a]));
  const decB = new Map(decisionsB.map((d) => [d.number, d.action]));
  const decA = new Map(decisionsA.map((d) => [d.number, d.action]));
  let differing = 0;
  console.log(
    ["ISSUE", "HUMAN A", "ACTION A", "HUMAN B", "ACTION B", "DIFFERS"]
      .map((h, i) => h.padEnd([7, 12, 24, 12, 24, 7][i]))
      .join(""),
  );
  for (const p of proposals) {
    const a = aByNumber.get(p.number);
    const b = bByNumber.get(p.number);
    const differs = `${a?.kind}:${a?.detail}` !== `${b?.kind}:${b?.detail}`;
    if (differs) differing += 1;
    console.log(
      [
        `#${p.number}`,
        String(decA.get(p.number)),
        `${a?.kind}${a?.kind === "add-label" ? `(${a.detail})` : ""}`,
        String(decB.get(p.number)),
        `${b?.kind}${b?.kind === "add-label" ? `(${b.detail})` : ""}`,
        differs ? "YES" : "no",
      ]
        .map((c, i) => c.padEnd([7, 12, 24, 12, 24, 7][i]))
        .join(""),
    );
  }
  console.log(
    `\n${differing}/${proposals.length} actions changed purely because the human decided differently.`,
  );

  rule("SUMMARY");
  console.log(`total wall clock           : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`issues processed           : ${proposals.map((p) => `#${p.number}`).join(", ")}`);
  console.log(`writes to GitHub           : 0 (apply=false on every run)`);
  console.log(`finished                   : ${new Date().toISOString()}`);
}

main()
  .catch((err) => {
    console.error(`\ntriage-interrupt-proof failed: ${err?.stack ?? err}`);
    process.exitCode = 1;
  })
  .finally(() => closeLoader());
