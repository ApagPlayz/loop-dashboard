#!/usr/bin/env node
/**
 * Step 5 (optional) of the dedup pipeline — read `metrics/dedup-eval.json` and
 * print a plain-text model-comparison table: lexical overlap vs BM25 vs the
 * dense encoder(s) actually present (MiniLM as `dense_local`, Titan v2 as
 * `dense_titan`).
 *
 * This does not recompute anything — it is a readout of whatever
 * `scripts/ml/evaluate.mjs` last wrote, so it is instant and safe to rerun.
 * Run `evaluate.mjs` first (after building whichever embedding index/indexes
 * you want compared) to refresh the numbers this reads.
 *
 * Usage:
 *   node scripts/ml/compare-encoders.mjs
 *   node scripts/ml/compare-encoders.mjs --metrics=metrics/dedup-eval.json
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { ROOT, METRICS_PATH } from "./_shared.mjs";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

const PRETTY_NAME = {
  overlap: "overlap (raw)",
  overlap_norm: "overlap (norm)",
  bm25: "bm25",
  dense_local: "dense (MiniLM/local)",
  dense_titan: "dense (Titan v2/bedrock)",
  dense: "dense",
};

function label(name) {
  return PRETTY_NAME[name] ?? name;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? `${s} ` : s + " ".repeat(n - s.length);
}

function fmtCi(ci) {
  return ci ? `[${ci.lo}, ${ci.hi}]` : "n/a";
}

/** Print one positive-definition's table across every method present. */
function printTable(defName, methodResults, methodNames) {
  console.log(`\npositive = ${defName}`);
  const header =
    pad("method", 26) +
    pad("AP", 8) +
    pad("AP 95% CI", 20) +
    pad("AUC", 8) +
    pad("bestF1", 8) +
    pad("P", 7) +
    pad("R", 7) +
    pad("P@1", 7) +
    pad("P@3", 7);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const name of methodNames) {
    const x = methodResults[name];
    if (!x || x.n_positive === 0) {
      console.log(`${pad(label(name), 26)}(no positives — cannot score)`);
      continue;
    }
    console.log(
      pad(label(name), 26) +
        pad(x.average_precision, 8) +
        pad(fmtCi(x.bootstrap_95ci?.average_precision), 20) +
        pad(x.roc_auc, 8) +
        pad(x.best_f1_operating_point.f1, 8) +
        pad(x.best_f1_operating_point.precision, 7) +
        pad(x.best_f1_operating_point.recall, 7) +
        pad(x.at_k["p@1"], 7) +
        pad(x.at_k["p@3"], 7),
    );
  }
}

/**
 * Whether two methods' AP 95% CIs overlap. When they do, this sample cannot
 * tell the methods apart — reported plainly rather than picking a "winner"
 * off the point estimate alone (see docs/ml-dedup.md's sample-size caveats).
 */
function ciOverlap(a, b) {
  const ca = a?.bootstrap_95ci?.average_precision;
  const cb = b?.bootstrap_95ci?.average_precision;
  if (!ca || !cb) return null;
  return ca.lo <= cb.hi && cb.lo <= ca.hi;
}

async function main() {
  const metricsPath = path.resolve(ROOT, arg("metrics", path.relative(ROOT, METRICS_PATH)));
  let raw;
  try {
    raw = await fs.readFile(metricsPath, "utf-8");
  } catch {
    console.error(
      `No metrics file at ${path.relative(ROOT, metricsPath)}. Run scripts/ml/evaluate.mjs first.`,
    );
    process.exit(1);
  }
  const data = JSON.parse(raw);

  console.log("=".repeat(78));
  console.log("MODEL COMPARISON — lexical baselines vs dense encoder(s)");
  console.log("=".repeat(78));
  console.log(`Metrics file: ${path.relative(ROOT, metricsPath)}`);
  console.log(`Generated:    ${data.generated_at}`);
  console.log(`Labels:       ${data.labels}${data.warning ? "  *** " + data.warning : ""}`);
  console.log(`Methods:      ${data.methods.join(", ")}`);

  const embeddingEntries = Object.entries(data.corpus?.embeddings ?? {});
  if (embeddingEntries.length === 0) {
    console.log(
      "\nNo embedding index found at all (neither data/embeddings-local.json nor " +
        "data/embeddings-titan.json). Only the lexical baselines are in this run.",
    );
  } else {
    console.log("\nEmbedding indexes in this run:");
    for (const [tag, info] of embeddingEntries) {
      console.log(
        `  ${tag.padEnd(6)} model=${info.model}  dims=${info.dims}  ` +
          `dtype=${info.dtype ?? "n/a"}  built=${info.built_at ?? "?"}  ` +
          `corpus_match=${info.index_matches_corpus}`,
      );
    }
  }
  const hasLocal = "local" in (data.corpus?.embeddings ?? {});
  const hasTitan = "titan" in (data.corpus?.embeddings ?? {});
  if (!hasTitan) {
    console.log(
      "\nNo data/embeddings-titan.json — Titan v2 has not been run (needs an AWS account and " +
        "Bedrock model access). Once it exists:\n" +
        "  EMBEDDING_BACKEND=bedrock node scripts/ml/build-index.mjs\n" +
        "  node scripts/ml/evaluate.mjs\n" +
        "  node scripts/ml/compare-encoders.mjs",
    );
  }

  for (const defName of Object.keys(data.positive_definitions ?? {})) {
    const methodResults = data.results?.[defName] ?? {};
    printTable(defName, methodResults, data.methods);
  }

  // Label-free diagnostic: how differently do the two dense encoders rank the
  // SAME pairs, with no labels involved at all. Real and reportable with zero
  // AWS spend beyond building the Titan index once.
  const agreement = data.method_agreement;
  if (agreement && hasLocal && hasTitan) {
    const pairKey = Object.keys(agreement.spearman_all_pairs).find(
      (k) => k.includes("dense_local") && k.includes("dense_titan"),
    );
    console.log("\n" + "=".repeat(78));
    console.log("LABEL-FREE MiniLM vs Titan v2 COMPARISON (no gold labels needed)");
    console.log("=".repeat(78));
    if (pairKey) {
      console.log(
        `Spearman rank correlation (all ${agreement.pairs_compared} pairs): ` +
          `${agreement.spearman_all_pairs[pairKey]}`,
      );
      console.log(
        `Jaccard overlap of each encoder's top-${agreement.top_k}: ${agreement.jaccard_top_k[pairKey]}`,
      );
      console.log(
        "Interpretation: 1.0 = identical rankings, 0.0 = no relationship. A low value means the " +
          "two encoders disagree enough that labelling could actually distinguish them; a value " +
          "near 1.0 would mean Titan is not adding information MiniLM didn't already have.",
      );
    } else {
      console.log("dense_local/dense_titan pair not found in method_agreement — unexpected, check evaluate.mjs.");
    }
  } else if (agreement && hasLocal && !hasTitan) {
    console.log(
      "\n(Label-free MiniLM vs Titan comparison skipped — build the Titan index first.)",
    );
  }

  // With gold labels, also call out whether AP differences are inside the
  // bootstrap CI — i.e. whether this sample can actually tell the two encoders
  // apart, not just which point estimate is higher.
  if (hasLocal && hasTitan && data.labels === "gold") {
    console.log("\n" + "-".repeat(78));
    for (const defName of Object.keys(data.positive_definitions ?? {})) {
      const r = data.results?.[defName] ?? {};
      const overlap = ciOverlap(r.dense_local, r.dense_titan);
      if (overlap === null) continue;
      console.log(
        `positive=${defName}: dense_local AP=${r.dense_local.average_precision} vs ` +
          `dense_titan AP=${r.dense_titan.average_precision} — 95% CIs ` +
          `${overlap ? "OVERLAP (this sample cannot separate them)" : "do NOT overlap (a real difference at this sample size)"}.`,
      );
    }
  }

  console.log("");
}

main().catch((err) => {
  console.error("compare-encoders failed:", err?.message ?? err);
  process.exit(1);
});
