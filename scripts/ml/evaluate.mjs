#!/usr/bin/env node
/**
 * Step 4 of the dedup pipeline — score every method against the gold labels.
 *
 * Reads a labelled pair file and writes `metrics/dedup-eval.json` containing,
 * for every method and both definitions of "positive":
 *
 *   - a full threshold sweep (precision / recall / F1 / tp / fp / fn)
 *   - the precision-recall curve and its average precision (AP)
 *   - ROC AUC
 *   - precision@k and recall@k, macro-averaged over query documents
 *   - a precision-favouring operating point (highest recall at precision >= 0.9)
 *   - inverse-probability-weighted precision/recall, which corrects for the
 *     stratified sampling and is the only figure that speaks about the corpus
 *     rather than about the sample
 *   - 95% bootstrap confidence intervals on all of the above headline numbers
 *
 * ORDER OF OPERATIONS: the lexical baselines are scored from exactly the same
 * pair list, with exactly the same code path, as the dense model. Nothing is
 * tuned per method. `overlap` is the raw hit count that lib/tool-fit.ts already
 * ships; `overlap_norm` is its length-normalised form; both are reported so the
 * baseline is not made to look worse than it is by a scaling artefact.
 *
 * SMOKE MODE: with no labelled file, the harness fabricates labels from a
 * seeded RNG so that every code path runs end to end before the owner spends an
 * hour labelling. Those numbers are meaningless by construction — a method that
 * scored well on them would indicate a bug — and the output is stamped
 * `"labels": "synthetic-smoke-test"` throughout. Do not quote them.
 *
 * Usage:
 *   node scripts/ml/evaluate.mjs                       # gold if present, else smoke
 *   node scripts/ml/evaluate.mjs --gold=data/gold-pairs.jsonl
 *   node scripts/ml/evaluate.mjs --smoke                # force smoke mode
 *   node scripts/ml/evaluate.mjs --bootstrap=2000 --seed=1
 */

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import {
  ROOT,
  LABELED_PATH,
  UNLABELED_PATH,
  METRICS_PATH,
  LABELS,
  loadCorpus,
  loadAllEmbeddings,
  buildMethods,
  readJsonl,
  rng,
  r4,
} from "./_shared.mjs";

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
const flag = (name) => process.argv.includes(`--${name}`);

/* ------------------------------------------------------------------ */
/* Core metrics                                                        */
/* ------------------------------------------------------------------ */

/**
 * Precision/recall/F1 at every threshold that changes the prediction.
 * `items` = [{ score, positive }]. Predict positive when score >= threshold.
 */
function sweep(items) {
  const sorted = items.slice().sort((a, b) => b.score - a.score);
  const totalPos = sorted.filter((x) => x.positive).length;
  const out = [];
  let tp = 0;
  let fp = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].positive) tp += 1;
    else fp += 1;
    // Only emit a row at the end of a run of equal scores — a threshold can
    // never split tied scores, and pretending it can inflates the curve.
    if (i + 1 < sorted.length && sorted[i + 1].score === sorted[i].score) continue;
    const fn = totalPos - tp;
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = totalPos === 0 ? 0 : tp / totalPos;
    out.push({
      threshold: sorted[i].score,
      tp,
      fp,
      fn,
      precision,
      recall,
      f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    });
  }
  return { points: out, totalPos, totalNeg: sorted.length - totalPos };
}

/** Average precision — area under the PR curve, the standard step-wise sum. */
function averagePrecision(items) {
  const sorted = items.slice().sort((a, b) => b.score - a.score);
  const totalPos = sorted.filter((x) => x.positive).length;
  if (totalPos === 0) return null;
  let tp = 0;
  let ap = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].positive) {
      tp += 1;
      ap += tp / (i + 1); // precision at this positive's rank
    }
  }
  return ap / totalPos;
}

/** ROC AUC via the rank-sum identity, with ties averaged. */
function rocAuc(items) {
  const sorted = items.slice().sort((a, b) => a.score - b.score);
  const n = sorted.length;
  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].score === sorted[i].score) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[k] = avg;
    i = j + 1;
  }
  let sumPosRanks = 0;
  let nPos = 0;
  for (let k = 0; k < n; k += 1) {
    if (sorted[k].positive) {
      sumPosRanks += ranks[k];
      nPos += 1;
    }
  }
  const nNeg = n - nPos;
  if (nPos === 0 || nNeg === 0) return null;
  return (sumPosRanks - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

/**
 * precision@k / recall@k, macro-averaged over query documents.
 *
 * A "query" is any document that appears in at least one labelled pair AND has
 * at least one positive partner. Its candidate list is only the partners that
 * were actually labelled — which on this gold set is a handful, not the whole
 * corpus. That makes these numbers optimistic relative to real retrieval over
 * 131 candidates; `mean_candidates` is reported so the reader can see it.
 */
function precisionAtK(items, ks) {
  const byQuery = new Map();
  const push = (q, partner, score, positive) => {
    if (!byQuery.has(q)) byQuery.set(q, []);
    byQuery.get(q).push({ partner, score, positive });
  };
  for (const it of items) {
    push(it.a, it.b, it.score, it.positive);
    push(it.b, it.a, it.score, it.positive);
  }

  const queries = [...byQuery.entries()].filter(([, cands]) => cands.some((c) => c.positive));
  const result = {};
  for (const k of ks) {
    let pSum = 0;
    let rSum = 0;
    for (const [, cands] of queries) {
      const ranked = cands.slice().sort((a, b) => b.score - a.score || a.partner - b.partner);
      const top = ranked.slice(0, k);
      const hits = top.filter((c) => c.positive).length;
      const totalPos = cands.filter((c) => c.positive).length;
      pSum += hits / Math.max(1, Math.min(k, ranked.length));
      rSum += hits / totalPos;
    }
    result[`p@${k}`] = queries.length ? pSum / queries.length : null;
    result[`r@${k}`] = queries.length ? rSum / queries.length : null;
  }
  result.n_queries = queries.length;
  result.mean_candidates = queries.length
    ? queries.reduce((s, [, c]) => s + c.length, 0) / queries.length
    : null;
  return result;
}

/**
 * Horvitz–Thompson estimates. Each labelled pair stands for 1/inclusion_prob
 * pairs in the full 8,646-pair space, so weighting by that inverse turns a
 * sample statistic into a corpus estimate. This is the ONLY precision/recall
 * pair in the output that is about the corpus; everything else is about the
 * sample and will look far better than reality because the sample is
 * deliberately dense in hard, high-overlap pairs.
 */
function weightedAt(items, threshold) {
  let tpW = 0;
  let fpW = 0;
  let fnW = 0;
  for (const it of items) {
    const w = it.weight;
    const pred = it.score >= threshold;
    if (pred && it.positive) tpW += w;
    else if (pred && !it.positive) fpW += w;
    else if (!pred && it.positive) fnW += w;
  }
  return {
    est_true_positives: tpW,
    est_false_positives: fpW,
    est_false_negatives: fnW,
    precision: tpW + fpW === 0 ? null : tpW / (tpW + fpW),
    recall: tpW + fnW === 0 ? null : tpW / (tpW + fnW),
  };
}

/** 95% percentile interval from a list of bootstrap replicates. */
function ci(values) {
  const v = values.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 20) return null;
  const at = (q) => v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))];
  return { lo: r4(at(0.025)), hi: r4(at(0.975)), n_replicates: v.length };
}

/* ------------------------------------------------------------------ */
/* Per-method evaluation                                               */
/* ------------------------------------------------------------------ */

function evaluateMethod(items, bootstrapN, seed) {
  const { points, totalPos, totalNeg } = sweep(items);

  if (totalPos === 0) {
    return {
      note: "No positive labels for this definition — precision/recall are undefined.",
      n_pairs: items.length,
      n_positive: 0,
      n_negative: totalNeg,
    };
  }

  const ap = averagePrecision(items);
  const auc = rocAuc(items);

  // Best-F1 operating point. Selected ON the same data it is scored on, so it
  // is optimistically biased — with n≈150 that bias is not small. Flagged.
  const best = points.reduce((a, b) => (b.f1 > a.f1 ? b : a), points[0]);

  // The point the backlog actually asks for: favour precision, because a false
  // "duplicate" suppresses a good proposal. Highest recall among thresholds
  // whose precision clears 0.90.
  const precise = points.filter((p) => p.precision >= 0.9);
  const precisionFirst = precise.length
    ? precise.reduce((a, b) => (b.recall > a.recall ? b : a), precise[0])
    : null;

  // Bootstrap: resample pairs with replacement, recompute. The threshold is
  // held fixed at the full-sample best-F1 point rather than re-selected per
  // replicate, so the interval describes THAT operating point's stability.
  const next = rng(seed);
  const apReps = [];
  const precReps = [];
  const recReps = [];
  const f1Reps = [];
  const aucReps = [];
  for (let b = 0; b < bootstrapN; b += 1) {
    const sample = new Array(items.length);
    for (let i = 0; i < items.length; i += 1) {
      sample[i] = items[Math.floor(next() * items.length)];
    }
    const nPos = sample.filter((x) => x.positive).length;
    if (nPos === 0 || nPos === sample.length) continue; // degenerate resample
    apReps.push(averagePrecision(sample));
    aucReps.push(rocAuc(sample));
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const it of sample) {
      const pred = it.score >= best.threshold;
      if (pred && it.positive) tp += 1;
      else if (pred && !it.positive) fp += 1;
      else if (!pred && it.positive) fn += 1;
    }
    const p = tp + fp === 0 ? 1 : tp / (tp + fp);
    const r = tp + fn === 0 ? 0 : tp / (tp + fn);
    precReps.push(p);
    recReps.push(r);
    f1Reps.push(p + r === 0 ? 0 : (2 * p * r) / (p + r));
  }

  return {
    n_pairs: items.length,
    n_positive: totalPos,
    n_negative: totalNeg,
    average_precision: r4(ap),
    roc_auc: r4(auc),
    best_f1_operating_point: {
      threshold: r4(best.threshold),
      precision: r4(best.precision),
      recall: r4(best.recall),
      f1: r4(best.f1),
      tp: best.tp,
      fp: best.fp,
      fn: best.fn,
      caveat:
        "Threshold chosen on the same data it is scored on; optimistically biased at this sample size.",
    },
    precision_first_operating_point: precisionFirst
      ? {
          target_precision: 0.9,
          threshold: r4(precisionFirst.threshold),
          precision: r4(precisionFirst.precision),
          recall: r4(precisionFirst.recall),
          f1: r4(precisionFirst.f1),
          tp: precisionFirst.tp,
          fp: precisionFirst.fp,
          fn: precisionFirst.fn,
        }
      : { target_precision: 0.9, reachable: false, note: "No threshold reaches precision 0.90." },
    weighted_estimate_at_best_f1: (() => {
      const w = weightedAt(items, best.threshold);
      return {
        ...w,
        precision: r4(w.precision),
        recall: r4(w.recall),
        est_true_positives: r4(w.est_true_positives),
        est_false_positives: r4(w.est_false_positives),
        est_false_negatives: r4(w.est_false_negatives),
        note:
          "Inverse-inclusion-probability (Horvitz-Thompson) estimate for the full pair space. " +
          "This is the corpus-level number; the unweighted ones above describe the biased sample only.",
      };
    })(),
    at_k: (() => {
      const k = precisionAtK(items, [1, 3, 5]);
      return {
        ...Object.fromEntries(
          Object.entries(k).map(([key, v]) => [key, typeof v === "number" ? r4(v) : v]),
        ),
        caveat:
          "Candidate lists are the labelled partners only, not all 131 other documents. " +
          "Treat as a relative comparison between methods, not an absolute retrieval score.",
      };
    })(),
    bootstrap_95ci: {
      average_precision: ci(apReps),
      roc_auc: ci(aucReps),
      precision_at_best_f1: ci(precReps),
      recall_at_best_f1: ci(recReps),
      f1_at_best_f1: ci(f1Reps),
    },
    pr_curve: points.map((p) => ({
      threshold: r4(p.threshold),
      precision: r4(p.precision),
      recall: r4(p.recall),
      f1: r4(p.f1),
      tp: p.tp,
      fp: p.fp,
      fn: p.fn,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Label-free diagnostic: do the methods actually disagree?            */
/* ------------------------------------------------------------------ */

/** Spearman rank correlation. Ties get average ranks. */
function spearman(xs, ys) {
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) out[idx[k][1]] = avg;
      i = j + 1;
    }
    return out;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = rx.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

/**
 * How much the methods differ, over ALL pairs and with no labels involved.
 *
 * This is not a quality measurement and cannot be — without labels there is no
 * notion of correct. It answers a cheaper question that is worth answering
 * before anyone spends an hour labelling: is the dense model producing a
 * meaningfully different ranking from BM25 at all? If the top-100 sets were
 * near-identical, the whole exercise would be moot.
 */
function methodAgreement(docs, methods, topK = 100) {
  const pairs = [];
  for (let i = 0; i < docs.length; i += 1) {
    for (let j = i + 1; j < docs.length; j += 1) pairs.push([docs[i].number, docs[j].number]);
  }
  const scores = new Map(methods.map((m) => [m.name, pairs.map(([a, b]) => m.scorePair(a, b))]));
  const tops = new Map(
    methods.map((m) => {
      const s = scores.get(m.name);
      const order = s.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]).slice(0, topK);
      return [m.name, new Set(order.map(([, i]) => i))];
    }),
  );

  const spearmanAll = {};
  const jaccardTopK = {};
  for (let i = 0; i < methods.length; i += 1) {
    for (let j = i + 1; j < methods.length; j += 1) {
      const a = methods[i].name;
      const b = methods[j].name;
      const key = `${a}|${b}`;
      spearmanAll[key] = r4(spearman(scores.get(a), scores.get(b)));
      const sa = tops.get(a);
      const sb = tops.get(b);
      let inter = 0;
      for (const x of sa) if (sb.has(x)) inter += 1;
      jaccardTopK[key] = r4(inter / (sa.size + sb.size - inter));
    }
  }
  return {
    note:
      "Label-free. Measures how differently the methods rank the same pairs, NOT how well " +
      "they do it. Low agreement means the gold labels will actually be able to separate them.",
    pairs_compared: pairs.length,
    top_k: topK,
    spearman_all_pairs: spearmanAll,
    jaccard_top_k: jaccardTopK,
  };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const POSITIVE_DEFS = {
  duplicate: (label) => label === "duplicate",
  duplicate_or_related: (label) => label === "duplicate" || label === "related",
};

async function main() {
  const bootstrapN = Number(arg("bootstrap", "1000"));
  const seed = Number(arg("seed", "20260901"));
  const goldArg = arg("gold", null);

  let goldPath = goldArg ? path.resolve(ROOT, goldArg) : LABELED_PATH;
  let smoke = flag("smoke");
  if (!smoke && !existsSync(goldPath)) {
    goldPath = UNLABELED_PATH;
    smoke = true;
  }

  const rows = await readJsonl(goldPath);

  if (!smoke) {
    const bad = rows.filter((r) => !LABELS.includes(r.label));
    if (bad.length) {
      console.error(
        `${bad.length} of ${rows.length} rows have a missing or invalid label ` +
          `(allowed: ${LABELS.join(" | ")}). First offender: pair ${bad[0].a}/${bad[0].b} ` +
          `label=${JSON.stringify(bad[0].label)}`,
      );
      process.exit(1);
    }
  } else {
    // Seeded coin flips. Deliberately independent of every score, so a method
    // that appears to "work" here is a bug, not a result.
    const next = rng(seed ^ 0x5eed);
    for (const r of rows) {
      const u = next();
      r.label = u < 0.15 ? "duplicate" : u < 0.35 ? "related" : "unrelated";
    }
    console.log(
      "\n" +
        "=".repeat(72) +
        "\nSMOKE TEST — labels are RANDOM, not real. Every number below is\n" +
        "meaningless and exists only to prove the harness runs end to end.\n" +
        `Label a copy of ${path.relative(ROOT, UNLABELED_PATH)} as\n` +
        `${path.relative(ROOT, LABELED_PATH)} to get real results.\n` +
        "=".repeat(72) +
        "\n",
    );
  }

  // Rescore from the live corpus + index rather than trusting the scores baked
  // into the pair file: that way a re-embedded index or a changed tokenizer is
  // reflected immediately, and the gold file only ever needs to carry labels.
  const docs = await loadCorpus();
  const embeddingSets = await loadAllEmbeddings(); // { local?, titan? }
  const methods = buildMethods(docs, embeddingSets);
  const embeddingLabels = Object.keys(embeddingSets);
  if (embeddingLabels.length === 0) {
    console.warn(
      "WARNING: no data/embeddings-local.json or data/embeddings-titan.json — no dense " +
        "method is present in this run. Run scripts/ml/build-index.mjs first.\n",
    );
  } else {
    console.log(`Dense encoders in this run: ${embeddingLabels.map((l) => `dense_${l}`).join(", ")}\n`);
  }

  const results = {};
  for (const [defName, isPositive] of Object.entries(POSITIVE_DEFS)) {
    results[defName] = {};
    for (const m of methods) {
      const items = rows.map((r) => ({
        a: r.a,
        b: r.b,
        score: m.scorePair(r.a, r.b),
        positive: isPositive(r.label),
        // A pair with no recorded inclusion probability is treated as a census
        // member (weight 1) rather than silently dropped.
        weight: r.inclusion_prob && r.inclusion_prob > 0 ? 1 / r.inclusion_prob : 1,
      }));
      results[defName][m.name] = evaluateMethod(items, bootstrapN, seed + m.name.length);
    }
  }

  const labelCounts = {};
  for (const r of rows) labelCounts[r.label] = (labelCounts[r.label] ?? 0) + 1;
  const strata = {};
  for (const r of rows) strata[r.stratum ?? "unknown"] = (strata[r.stratum ?? "unknown"] ?? 0) + 1;

  const output = {
    generated_at: new Date().toISOString(),
    labels: smoke ? "synthetic-smoke-test" : "gold",
    warning: smoke
      ? "SYNTHETIC RANDOM LABELS. Every metric in this file is meaningless. Do not quote it."
      : null,
    gold_file: path.relative(ROOT, goldPath),
    corpus: {
      documents: docs.length,
      total_pairs: (docs.length * (docs.length - 1)) / 2,
      // One entry per dense encoder actually present in this run (see
      // `dense_<label>` under `results`). Empty when neither index exists.
      embeddings: Object.fromEntries(
        Object.entries(embeddingSets).map(([label, idx]) => [
          label,
          {
            model: idx.model,
            backend: idx.backend,
            dtype: idx.dtype ?? null,
            dims: idx.dims,
            built_at: idx.builtAt ?? null,
            index_matches_corpus: idx.numbers.length === docs.length,
          },
        ]),
      ),
    },
    gold_set: {
      pairs: rows.length,
      label_counts: labelCounts,
      strata,
      sampling:
        "Stratified by lexical overlap plus a dense-only stratum; see scripts/ml/generate-pairs.mjs. " +
        "Unweighted metrics describe this sample, not the corpus.",
    },
    methods: methods.map((m) => m.name),
    bootstrap: { replicates: bootstrapN, seed, interval: "95% percentile" },
    positive_definitions: {
      duplicate: 'label === "duplicate"',
      duplicate_or_related: 'label === "duplicate" || label === "related"',
    },
    method_agreement: methodAgreement(docs, methods),
    results,
  };

  await fs.mkdir(path.dirname(METRICS_PATH), { recursive: true });
  await fs.writeFile(METRICS_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf-8");

  // Console summary — the file is the artefact, this is just the read-out.
  for (const defName of Object.keys(POSITIVE_DEFS)) {
    const r = results[defName];
    const nPos = Object.values(r)[0]?.n_positive ?? 0;
    console.log(`positive = ${defName}   (${nPos} positive / ${rows.length} pairs)`);
    console.log(
      `  ${"method".padEnd(14)}${"AP".padEnd(8)}${"AP 95% CI".padEnd(20)}` +
        `${"AUC".padEnd(8)}${"bestF1".padEnd(8)}${"P".padEnd(7)}${"R".padEnd(7)}${"P@1".padEnd(7)}`,
    );
    for (const m of methods) {
      const x = r[m.name];
      if (!x || x.n_positive === 0) {
        console.log(`  ${m.name.padEnd(14)}(no positives)`);
        continue;
      }
      const c = x.bootstrap_95ci.average_precision;
      console.log(
        `  ${m.name.padEnd(14)}` +
          `${String(x.average_precision).padEnd(8)}` +
          `${(c ? `[${c.lo}, ${c.hi}]` : "n/a").padEnd(20)}` +
          `${String(x.roc_auc).padEnd(8)}` +
          `${String(x.best_f1_operating_point.f1).padEnd(8)}` +
          `${String(x.best_f1_operating_point.precision).padEnd(7)}` +
          `${String(x.best_f1_operating_point.recall).padEnd(7)}` +
          `${String(x.at_k["p@1"]).padEnd(7)}`,
      );
    }
    console.log("");
  }
  console.log(`Wrote ${path.relative(ROOT, METRICS_PATH)}`);
  if (smoke) {
    console.log('Reminder: labels were RANDOM. "labels": "synthetic-smoke-test" in the JSON.');
  }
}

main().catch((err) => {
  console.error("evaluate failed:", err?.message ?? err);
  process.exit(1);
});
