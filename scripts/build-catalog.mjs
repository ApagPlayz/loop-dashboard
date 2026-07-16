#!/usr/bin/env node
/**
 * Build the committed tool catalog.
 *
 * Runs the SAME ingestion pipeline the live "Scan for new tools" button uses
 * (lib/catalog-pipeline.mjs), then writes the result into config/tool-catalog.json
 * so the repo ships with several hundred quality entries out of the box.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/build-catalog.mjs
 *   node scripts/build-catalog.mjs            (reads GITHUB_TOKEN from .env.local)
 *
 * Flags (optional): --cap=450 --pulse-pages=10 --github-max=250
 *
 * The hand-reviewed seed entries already in config/tool-catalog.json are kept
 * and never clobbered (status "reviewed"); everything else is regenerated.
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runPipeline, assembleCatalog, enrichSeed } from "../lib/catalog-pipeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "config", "tool-catalog.json");

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
}

/** Read GITHUB_TOKEN from env, falling back to .env.local. */
async function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const env = await fs.readFile(path.join(ROOT, ".env.local"), "utf-8");
    const m = env.match(/^GITHUB_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    /* ignore */
  }
  return undefined;
}

async function main() {
  const cap = Number(arg("cap", "450"));
  const pulsePages = Number(arg("pulse-pages", "10"));
  const githubMax = Number(arg("github-max", "250"));
  const token = await resolveToken();

  const log = (m) => console.log(m);
  console.log("Building catalog…");
  console.log(`  cap=${cap} pulse-pages=${pulsePages} github-max=${githubMax} token=${token ? "yes" : "no"}`);

  // 1. keep the hand-reviewed seed (never clobbered)
  const seedRaw = JSON.parse(await fs.readFile(CATALOG_PATH, "utf-8"));
  const seedReviewed = (seedRaw.entries || []).filter((e) => e.status === "reviewed");
  const now = Date.now();
  const seedEnriched = enrichSeed(seedReviewed, now);
  console.log(`  seed (reviewed) kept: ${seedEnriched.length}`);

  // 2. run the pipeline
  const { candidates, stats } = await runPipeline({
    token, pulsePages, githubMax, registryPages: 5, log, now,
  });
  console.log("  source counts:", JSON.stringify(stats.sources));
  console.log(`  total normalized+deduped candidates: ${stats.totalCandidates}`);

  // 3. assemble + cap
  const { entries, stats: aStats } = assembleCatalog(seedEnriched, candidates, { cap });

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note:
      "Auto-built by scripts/build-catalog.mjs from live sources (PulseMCP, davila7 aggregate, " +
      "Anthropic official plugins & skills, the official MCP registry), joined to GitHub for " +
      "popularity/staleness. Entries with status 'reviewed' were hand-verified and are never " +
      "clobbered; everything else was auto-scanned into trust tiers (official/verified/community). " +
      "The 'url' is the install payload sent to the tool-install workflow.",
    entries,
  };

  await fs.writeFile(CATALOG_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");

  console.log("\nDONE — wrote", path.relative(ROOT, CATALOG_PATH));
  console.log("  total:", aStats.total);
  console.log("  by type:", JSON.stringify(aStats.byType));
  console.log("  by tier:", JSON.stringify(aStats.byTier));
  const stales = entries.filter((e) => e.stale).length;
  const flagged = entries.filter((e) => (e.safetyFlags || []).length > 0).length;
  const recommended = entries.filter((e) => e.recommended).length;
  console.log(`  stale(hidden): ${stales} · with safety flags: ${flagged} · recommended: ${recommended}`);
}

main().catch((err) => {
  console.error("build-catalog failed:", err);
  process.exit(1);
});
