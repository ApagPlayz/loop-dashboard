#!/usr/bin/env node
/**
 * Step 3 of the dedup pipeline — build the set of pairs for the owner to label.
 *
 * Writes `data/gold-pairs-unlabeled.jsonl`: ~150 document pairs with every
 * method's score already attached and an empty `label` field.
 *
 * WHY IT IS STRATIFIED
 * --------------------
 * There are C(132,2) = 8,646 pairs and only a handful are duplicates. A uniform
 * random sample of 150 would be ~150 trivially-easy negatives, would contain
 * approximately zero positives, and every method would score ~100% on it. The
 * sample is therefore stratified by lexical overlap so the hard, informative
 * region of the space is over-represented.
 *
 * Strata (assigned in this order; a pair lands in exactly one):
 *
 *   A  lex_top     the 40 highest-overlap pairs in the whole corpus. Census.
 *   E  dense_only  the 30 highest dense-cosine pairs from OUTSIDE the lexical
 *                  top 400. Census. These exist so the gold set can contain
 *                  duplicates the lexical baseline never surfaces — without
 *                  them, "dense finds things BM25 misses" would be unfalsifiable
 *                  because no such pair would ever have been labelled.
 *   B  lex_high    random sample of 35 from lexical ranks 41–400.
 *   C  lex_mid     random sample of 25 from lexical ranks 401–2000.
 *   D  lex_low     random sample of 20 from lexical rank 2001 down.
 *
 * WHAT THAT COSTS — read before quoting any recall number
 * -------------------------------------------------------
 * This is a biased sample by construction, in favour of BOTH families of
 * method. Precision measured on it is a precision on this sample, not on the
 * corpus. Corpus-level recall is NOT directly estimable from it. Every pair
 * therefore carries `stratum_size`, `stratum_sampled` and `inclusion_prob`, so
 * an inverse-probability-weighted (Horvitz–Thompson) estimate is possible
 * later; the eval harness reports both the raw and the weighted figure and
 * labels which is which.
 *
 * Pairs are emitted in a seeded-shuffled order on purpose: labelling 40
 * duplicates in a row and then 100 non-duplicates drags the labeller's
 * threshold with it.
 *
 * Usage:
 *   node scripts/ml/generate-pairs.mjs
 *   node scripts/ml/generate-pairs.mjs --seed=7 --total=150
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  ROOT,
  UNLABELED_PATH,
  LABELS,
  loadCorpus,
  loadEmbeddings,
  buildMethods,
  allPairs,
  rng,
  shuffled,
  r4,
} from "./_shared.mjs";

const REPO = "ApagPlayz/content-generation-platform";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

const HEADER = [
  "# data/gold-pairs-unlabeled.jsonl — candidate pairs for hand labelling.",
  "#",
  "# HOW TO LABEL: copy this file to data/gold-pairs.jsonl and fill in the",
  "# \"label\" field on every line. Allowed values, exactly:",
  "#",
  `#   "duplicate"  — the same request. Filing both was a mistake; one should`,
  "#                  have been closed as a duplicate of the other.",
  `#   "related"    — same area or overlapping work, but genuinely two different`,
  "#                  asks. A reviewer would want to see them together, but",
  "#                  would NOT close either one.",
  `#   "unrelated"  — no meaningful connection.`,
  "#",
  "# Leave \"notes\" empty or write anything; it is never scored.",
  "# Lines beginning with # are ignored by the tooling, so keep this header.",
  "#",
  "# The primary metric treats \"duplicate\" as the positive class. A secondary",
  "# metric treats duplicate+related as positive. Both are reported, so the",
  "# related/unrelated boundary matters less than the duplicate/related one —",
  "# spend your care there.",
].join("\n");

async function main() {
  const seed = Number(arg("seed", "20260901"));
  const total = Number(arg("total", "150"));

  const docs = await loadCorpus();
  const embeddings = await loadEmbeddings();
  if (!embeddings) {
    console.warn(
      "WARNING: data/embeddings.json not found — the dense_only stratum will be skipped.\n" +
        "         Run scripts/ml/build-index.mjs first for the full sample.",
    );
  }

  const methods = buildMethods(docs, embeddings);
  const byName = new Map(methods.map((m) => [m.name, m]));
  const lex = byName.get("overlap_norm");
  const dense = byName.get("dense");
  const byNumber = new Map(docs.map((d) => [d.number, d]));

  console.log(`${docs.length} documents → ${((docs.length * (docs.length - 1)) / 2).toLocaleString()} pairs`);

  // Score every pair once with the stratifying method.
  const pairs = allPairs(docs).map(([a, b]) => ({ a, b, lex: lex.scorePair(a, b) }));
  pairs.sort((x, y) => y.lex - x.lex || x.a - y.a || x.b - y.b);
  const key = (p) => `${p.a}:${p.b}`;

  const claimed = new Set();
  const selected = [];

  /** Take a whole band (census). */
  const takeAll = (band, stratum) => {
    const avail = band.filter((p) => !claimed.has(key(p)));
    for (const p of avail) {
      claimed.add(key(p));
      selected.push({ ...p, stratum, stratum_size: avail.length, stratum_sampled: avail.length });
    }
    console.log(`  ${stratum}: ${avail.length} (census)`);
  };

  /** Take a seeded random sample from a band. */
  const takeSample = (band, stratum, n, next) => {
    const avail = band.filter((p) => !claimed.has(key(p)));
    const picked = shuffled(avail, next).slice(0, n);
    for (const p of picked) {
      claimed.add(key(p));
      selected.push({ ...p, stratum, stratum_size: avail.length, stratum_sampled: picked.length });
    }
    console.log(`  ${stratum}: ${picked.length} of ${avail.length}`);
  };

  const next = rng(seed);

  // Band sizes scale with --total so a bigger/smaller budget stays balanced.
  const scale = total / 150;
  const nTop = Math.round(40 * scale);
  const nDense = Math.round(30 * scale);
  const nHigh = Math.round(35 * scale);
  const nMid = Math.round(25 * scale);
  const nLow = Math.round(20 * scale);

  // A — the lexical top. Census: these are where the duplicates actually are.
  takeAll(pairs.slice(0, nTop), "lex_top");

  // E — dense-only. Top by cosine among pairs outside the lexical top 400.
  if (dense) {
    const tail = pairs.slice(400);
    const ranked = tail
      .map((p) => ({ ...p, d: dense.scorePair(p.a, p.b) }))
      .sort((x, y) => y.d - x.d)
      .slice(0, nDense);
    takeAll(ranked, "dense_only");
  }

  // B/C/D — random samples across the rest of the lexical range.
  takeSample(pairs.slice(nTop, 400), "lex_high", nHigh, next);
  takeSample(pairs.slice(400, 2000), "lex_mid", nMid, next);
  takeSample(pairs.slice(2000), "lex_low", nLow, next);

  // Attach every method's score and the document metadata a labeller needs.
  const rows = selected.map((p) => {
    const da = byNumber.get(p.a);
    const db = byNumber.get(p.b);
    const scores = {};
    for (const m of methods) scores[m.name] = r4(m.scorePair(p.a, p.b));
    return {
      a: p.a,
      b: p.b,
      a_type: da.type,
      b_type: db.type,
      a_title: da.title,
      b_title: db.title,
      a_url: `https://github.com/${REPO}/${da.type === "pr" ? "pull" : "issues"}/${p.a}`,
      b_url: `https://github.com/${REPO}/${db.type === "pr" ? "pull" : "issues"}/${p.b}`,
      stratum: p.stratum,
      stratum_size: p.stratum_size,
      stratum_sampled: p.stratum_sampled,
      inclusion_prob: r4(p.stratum_sampled / p.stratum_size),
      scores,
      label: "",
      notes: "",
    };
  });

  const out = shuffled(rows, rng(seed + 1));

  await fs.mkdir(path.dirname(UNLABELED_PATH), { recursive: true });
  await fs.writeFile(
    UNLABELED_PATH,
    `${HEADER}\n${out.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf-8",
  );

  console.log(`\nWrote ${path.relative(ROOT, UNLABELED_PATH)} — ${out.length} pairs.`);
  console.log(`Allowed labels: ${LABELS.join(" | ")}`);
  const docsCovered = new Set(out.flatMap((r) => [r.a, r.b])).size;
  console.log(`${docsCovered} of ${docs.length} documents appear in at least one pair.`);
}

main().catch((err) => {
  console.error("generate-pairs failed:", err?.message ?? err);
  process.exit(1);
});
