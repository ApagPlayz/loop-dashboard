# Semantic near-duplicate detection over CGP proposals

Backlog §3, "Build first". Everything here is built. Two steps are still
blocked on something only a human (or AWS) can provide: **labelling the gold
set**, and **an AWS account** to actually run the Titan v2 backend (2026-09-02
update below — the code is written, typechecked, and unit-tested with a mocked
AWS SDK, but has never made a real InvokeModel call).

The goal is to tell, for two GitHub issues/PRs in
`ApagPlayz/content-generation-platform`, whether they are the same request. The
loop keeps filing near-duplicate proposals; 19 near-duplicate pairs were counted
by hand during the 2026-09-01 brainstorm. This is the machinery to detect them,
and — more importantly — to *measure* whether a dense model actually beats the
keyword baseline that is already in the repo.

---

## What exists

| Path | What it is |
| --- | --- |
| `scripts/ml/extract-corpus.mjs` | Pulls every issue + PR through `gh api` → `data/corpus.jsonl` |
| `lib/dedup/baseline.ts` | The two lexical baselines: `overlap` (the in-repo one) and `bm25` (written here) |
| `lib/dedup/embed.ts` | Dense embeddings, `local` (MiniLM) and `bedrock` (Titan v2) backends, both implemented |
| `scripts/ml/build-index.mjs` | Embeds the corpus → `data/embeddings-local.json` or `data/embeddings-titan.json` (backend-specific; also mirrors to `data/embeddings.json`) |
| `scripts/ml/generate-pairs.mjs` | Stratified sample of pairs to label → `data/gold-pairs-unlabeled.jsonl` |
| `scripts/ml/evaluate.mjs` | Scores every method (both dense encoders, when both indexes exist) → `metrics/dedup-eval.json` |
| `scripts/ml/compare-encoders.mjs` | Reads `metrics/dedup-eval.json` and prints a readable comparison table, plus a label-free MiniLM-vs-Titan section |
| `scripts/ml/_shared.mjs` | Loading (single- or dual-backend) + the method list behind one interface + a seeded RNG |

The `.mjs` scripts import the `.ts` libraries directly by path. Node 26 strips
TypeScript types natively, so there is no build step and no loader flag. (Node
prints a `MODULE_TYPELESS_PACKAGE_JSON` performance warning doing this; it is
cosmetic. `node --no-warnings …` silences it.)

---

## Run it, in order

```bash
# 1. Corpus. Needs the gh CLI authenticated. Idempotent — safe to re-run daily.
node scripts/ml/extract-corpus.mjs

# 2. Embeddings, local backend (MiniLM, no AWS needed). First run downloads
#    the model; later runs are offline. Writes data/embeddings-local.json
#    (and mirrors to data/embeddings.json for backward compatibility).
node scripts/ml/build-index.mjs

# 2b. Embeddings, Bedrock backend (Titan v2) — ONLY once an AWS account with
#     Bedrock model access to amazon.titan-embed-text-v2:0 exists. Writes
#     data/embeddings-titan.json. Credentials from the default AWS provider
#     chain (env vars / ~/.aws / SSO / ECS task role) — never put keys here.
EMBEDDING_BACKEND=bedrock node scripts/ml/build-index.mjs

# 3. The pairs to label.
node scripts/ml/generate-pairs.mjs

# 4. Evaluation. Scores every lexical baseline PLUS every dense index that
#    exists (dense_local, dense_titan — either, both, or neither). With no
#    labelled file this runs as a smoke test (see below).
node scripts/ml/evaluate.mjs

# 5. Optional readable comparison table + label-free MiniLM-vs-Titan section.
#    Reads metrics/dedup-eval.json — rerun step 4 first if it's stale.
node scripts/ml/compare-encoders.mjs
```

Useful flags: `--repo=owner/name`, `--seed=N`, `--total=150` (pair budget),
`--gold=path`, `--bootstrap=2000`, `--smoke` (evaluate.mjs); `--metrics=path`
(compare-encoders.mjs).

Environment: `EMBEDDING_BACKEND=local|bedrock` (default `local`),
`EMBEDDING_DTYPE=fp32|q8` (default `fp32`, local backend only),
`EMBEDDING_BEDROCK_DIMENSIONS=1024|512|256` (default `1024`, bedrock only),
`EMBEDDING_BEDROCK_MODEL` (override the Titan model id, bedrock only),
`DASHBOARD_AI_BEDROCK_REGION` / `AWS_REGION` (region, default `us-east-1`,
bedrock only).

---

## What each step measured on this machine, 2026-09-01

**Corpus** — **132 documents**: 62 issues, 70 PRs. 55 open, 77 closed, 44
merged. Zero empty bodies. Median document is ~2,500 characters. Only two
authors exist (`ApagPlayz`, `claude[bot]`) and only two labels are ever used
(`proposal`, `approved`). The backlog said "~124 documents"; the real number is
132. Output is sorted and deterministically serialised, so a re-run on unchanged
data produces a byte-identical file — verified by sha.

**Embeddings** — worked, first try, no fallback needed.
`Xenova/all-MiniLM-L6-v2`, 384 dims, mean-pooled, L2-normalised (‖v‖−1 <
1.6e-7 on spot check). Cold run 18.6 s including the model download; warm runs
**3.5 s for 132 documents (~27 ms/doc)**. `data/embeddings.json` is 463 KB.

> **The model is 90.4 MB, not the ~23 MB the backlog assumed.**
> `@huggingface/transformers` v4 defaults to fp32 weights in Node. The 23 MB
> figure is the int8-quantised variant — `EMBEDDING_DTYPE=q8` gets it, at some
> cost in fidelity. All numbers in `metrics/dedup-eval.json` are fp32.
> The cache lives in `node_modules/@huggingface/transformers/.cache`, so
> `npm ci` wipes it and the next run re-downloads.

**Truncation, and it matters**: MiniLM's context is 256 word-pieces. 87 of 132
documents are longer than the 2,000-character budget, so for two thirds of the
corpus only roughly the opening is encoded. That is a real limitation of the
method on this data, not a wiring bug.

**Pairs** — 132 documents give 8,646 pairs; 150 were selected. 112 of 132
documents appear in at least one pair.

**Evaluation** — runs end to end. See "the smoke test" below for why its current
numbers are meaningless on purpose.

---

## The methods

Three lexical baselines plus one dense method PER embedding index that
actually exists (`dense_local` for MiniLM, `dense_titan` for Titan v2 — either,
both, or neither, never a method that silently scores 0 for a backend that
was never built). All are wired identically and scored from the same pair
list, so no method is handicapped by being wired up differently.

- **`overlap`** — the approach already shipping in `lib/tool-fit.ts`: tokenize,
  drop tokens ≤ 2 chars and a 30-word stopword list, count distinct shared
  tokens. Reimplemented in `lib/dedup/baseline.ts` rather than imported, because
  the original is not exported and is typed against `CatalogEntry` plus a
  `Set<string>` repo profile, not against two documents. The tokenizer and
  stopword list are copied verbatim. The only thing dropped is the
  `quality * 0.02` tie-breaker, which reads `CatalogEntry.rankScore` — a field
  issues do not have, and which only ever broke ties.
- **`overlap_norm`** — the same count divided by the smaller document's
  vocabulary size. Included because a raw count grows with document length and
  so is not comparable across pairs, which makes a single threshold meaningless.
  Reporting both is the fair treatment; picking whichever looks worse would not
  be.
- **`bm25`** — Okapi BM25, ~70 lines, no dependency. k1 = 1.5, b = 0.75,
  IDF = ln(1 + (N − df + 0.5)/(df + 0.5)). Asymmetric by construction, so the
  pair score is the mean of both directions.
- **`dense_local`** — cosine similarity of the MiniLM (`local` backend)
  embeddings.
- **`dense_titan`** — cosine similarity of the Titan v2 (`bedrock` backend)
  embeddings. Present only once `data/embeddings-titan.json` exists (backlog
  §2 — needs an AWS account). **Not yet run** — see "Bedrock status" below.

Titles are weighted ×2 and code fences are stripped for every method equally.

---

## Do the methods even disagree? (measurable without labels)

`metrics/dedup-eval.json → method_agreement`, computed over all 8,646 pairs:

| pair | Spearman (all pairs) | Jaccard of top-100 |
| --- | --- | --- |
| overlap vs bm25 | 0.963 | 0.34 |
| overlap vs dense | 0.450 | 0.22 |
| bm25 vs dense | 0.508 | 0.49 |
| overlap_norm vs dense | 0.410 | 0.37 |

(This table predates the local/titan split — `dense` here is what
`metrics/dedup-eval.json` now calls `dense_local`. The equivalent
`dense_local` vs `dense_titan` row is added automatically once both indexes
exist; see "Bedrock status" below.)

This is **not** a quality measurement — without labels there is no notion of
correct. It answers a cheaper question worth answering before spending an hour
labelling: the dense model ranks pairs substantially differently from BM25
(ρ ≈ 0.51), so the gold labels will actually be able to separate them. If these
had come back at 0.95 the exercise would have been moot. Note also that the raw
`overlap` count and BM25 rank almost identically (ρ = 0.96) — worth knowing
before claiming BM25 is a meaningfully stronger baseline.

---

## What the owner has to do — the only blocking step

```bash
cp data/gold-pairs-unlabeled.jsonl data/gold-pairs.jsonl
# fill in the "label" field on all 150 lines
node scripts/ml/evaluate.mjs      # picks up data/gold-pairs.jsonl automatically
```

Each line already carries both titles, both GitHub URLs, and every method's
score. Allowed values, exactly:

- **`duplicate`** — the same request. Filing both was a mistake; one should have
  been closed as a duplicate of the other.
- **`related`** — same area or overlapping work, but genuinely two different
  asks. A reviewer would want to see them together but would close neither.
- **`unrelated`** — no meaningful connection.

Both a `duplicate`-only and a `duplicate + related` positive class are reported,
so the related/unrelated boundary matters less than the duplicate/related one.
Spend the care there.

Rows are in shuffled order on purpose: labelling forty duplicates in a row and
then a hundred non-duplicates drags a labeller's threshold with it.

An hour is a realistic budget. `evaluate.mjs` refuses to run on a gold file with
any missing or invalid label, and names the first offending pair.

---

## How the sample was drawn, and what it costs

A uniform random 150 of 8,646 pairs would contain approximately zero positives
and every method would score ~100%. So the sample is stratified:

| stratum | how | n |
| --- | --- | --- |
| `lex_top` | the 40 highest-overlap pairs in the corpus (census) | 40 |
| `dense_only` | top 30 by cosine among pairs *outside* the lexical top 400 (census) | 30 |
| `lex_high` | random sample of lexical ranks 41–400 | 35 |
| `lex_mid` | random sample of lexical ranks 401–2000 | 25 |
| `lex_low` | random sample of rank 2001 down | 20 |

`dense_only` exists so the gold set can contain duplicates the lexical baseline
never surfaces. Without it, "dense finds things BM25 misses" would be
*unfalsifiable* — no such pair would ever have been labelled.

**The cost, stated plainly.** This sample is biased in favour of both families
of method. Precision measured on it is precision *on this sample*, not on the
corpus, and it will look far better than reality. Corpus-level recall is not
directly estimable from it. Every row therefore carries `stratum_size`,
`stratum_sampled` and `inclusion_prob`, and the harness reports a
Horvitz–Thompson (inverse-inclusion-probability) weighted precision/recall as
`weighted_estimate_at_best_f1`. **That weighted figure is the only one in the
file that speaks about the corpus.** Everything else describes the sample.

---

## The smoke test, and why the current numbers are meaningless

With no `data/gold-pairs.jsonl`, `evaluate.mjs` fabricates labels from a seeded
RNG, prints a banner, and stamps `"labels": "synthetic-smoke-test"` plus a
`warning` field into the JSON. The point is to prove every code path runs before
the owner spends an hour labelling.

The labels are drawn independently of every score, so the correct outcome is
**chance**: average precision ≈ the base rate, ROC AUC ≈ 0.5. That is what
happens — across five label seeds, AUC landed at 0.41 / 0.48 / 0.53 / 0.56 /
0.63, and AP tracked the base rate. A method scoring *well* here would indicate
a bug, not a result.

**The current `metrics/dedup-eval.json` contains no real result. Do not quote
any number from it.** No comparison between the baseline and the dense model has
been made, because there are no labels to make it against.

---

## Reading the output once it is real

`metrics/dedup-eval.json → results.<positive_definition>.<method>`:

- **`average_precision`** — the headline. Area under the PR curve; the right
  summary for an imbalanced ranking problem. Compare methods on this.
- **`bootstrap_95ci`** — 1,000 resamples of the labelled pairs with replacement,
  95% percentile intervals. **Read these before believing any ranking.** With
  ~150 pairs and perhaps 20–40 duplicates, intervals will be wide, and if two
  methods' AP intervals overlap heavily then this dataset cannot tell them
  apart — which is a legitimate finding, and the honest thing to report.
- **`roc_auc`** — reported for completeness. With heavy class imbalance AP is
  the more informative number; prefer it.
- **`best_f1_operating_point`** — carries a `caveat` field because the threshold
  is chosen on the same data it is scored on. At n = 150 that optimism is not
  small.
- **`precision_first_operating_point`** — what backlog §3 step 5 actually asks
  for: the highest recall available at precision ≥ 0.90, because a false
  "duplicate" that suppresses a good proposal costs more than a miss. **This is
  the number to ship a threshold from.** It reports `reachable: false` when no
  threshold gets there.
- **`weighted_estimate_at_best_f1`** — the corpus-level estimate. See above.
- **`at_k`** — precision@k / recall@k, macro-averaged over query documents. Its
  `caveat` field matters: candidate lists are only the *labelled* partners (mean
  size is reported), not all 131 other documents, so these are optimistic in
  absolute terms and should be read as a relative comparison.
- **`pr_curve`** — full curve, one row per distinct score. Ties are never split,
  so the curve is not inflated by pretending a threshold can separate equal
  scores.

### Sample sizes to keep in mind

132 documents, 150 labelled pairs, and probably 20–40 duplicates among them.
That is small. It is enough to reject a method that is clearly worse and enough
to set a precision-first threshold with a stated interval. It is **not** enough
to defend a claim like "dense beats BM25 by 4 points of AP" if the bootstrap
intervals overlap. Report the interval, not the point estimate.

---

## Bedrock status (2026-09-02)

`EMBEDDING_BACKEND=bedrock` is now **implemented**, not a stub — it calls
Amazon Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`) via
`InvokeModelCommand` from `@aws-sdk/client-bedrock-runtime`. That package is
present in `node_modules` only as a **transitive** dependency of
`@anthropic-ai/bedrock-sdk` (which lib/map-ai.ts depends on directly) — it is
not in `package.json` itself, so a future lockfile change to
`@anthropic-ai/bedrock-sdk` could remove it without warning. If Bedrock
embeddings ever stop resolving, that dependency chain is where to look first.

**It has never made a real InvokeModel call — there is still no AWS account
(backlog §2).** What *has* been verified:

- `npx tsc --noEmit` is clean with the real (not mocked) type definitions from
  `@aws-sdk/client-bedrock-runtime`.
- `tests/lib/dedup/embed.test.ts` unit-tests the whole path against a mocked
  `BedrockRuntimeClient`/`InvokeModelCommand`: the request body matches AWS's
  documented Titan v2 contract exactly (`inputText`, `dimensions`, `normalize`
  — verified against the AWS docs, not guessed), the response is parsed
  correctly, region resolution (`DASHBOARD_AI_BEDROCK_REGION` >
  `AWS_REGION` > `us-east-1` default) is correct, `EMBEDDING_BEDROCK_MODEL`
  and `EMBEDDING_BEDROCK_DIMENSIONS` overrides actually change the request
  (not just the recorded label), a dimension mismatch in the response throws,
  `ThrottlingException` retries with backoff, and anything else throws
  immediately with a message that says "Refusing to fall back to the local
  model" — never a silent fallback.
- The **local** path was re-verified end to end on 2026-09-02 after this
  change (`node scripts/ml/build-index.mjs`, `evaluate.mjs`,
  `compare-encoders.mjs` all ran clean) — the file-layout change (backend-
  specific index paths) did not break anything already working.
- The multi-encoder comparison mechanism itself (`dense_local` + `dense_titan`
  scored side by side, `method_agreement`'s label-free Spearman/Jaccard
  between them) was verified by temporarily pointing a **copy** of the local
  index at `data/embeddings-titan.json`, running the full pipeline, confirming
  Spearman = 1.0 / Jaccard = 1.0 (correct, since it was a literal copy — a
  sanity check, not a result), then **deleting that file** before finishing.
  `data/embeddings-titan.json` does not exist in the repo; nothing here claims
  a Titan result that wasn't produced by Titan.

**1024 dims chosen for Titan v2** (the API default, and the model's full
Matryoshka-trained width) rather than 512 or 256: at 132 documents the
storage/latency cost of the extra dimensions is a few hundred KB, and staying
at full width keeps "which model" the only axis of variation in the
local-vs-Titan comparison instead of adding "which truncation" as a second
one. `EMBEDDING_BEDROCK_DIMENSIONS` overrides it if cost ever matters at a
larger corpus.

**What to run once an AWS account with Bedrock access to
`amazon.titan-embed-text-v2:0` exists**, in order:

```bash
EMBEDDING_BACKEND=bedrock node scripts/ml/build-index.mjs   # → data/embeddings-titan.json
node scripts/ml/evaluate.mjs                                 # scores dense_local + dense_titan together
node scripts/ml/compare-encoders.mjs                          # readable table + label-free comparison
```

No code changes needed — the same harness that already scores MiniLM will
pick up the Titan index automatically once it exists.

## Not done, on purpose

- **The label-free MiniLM-vs-Titan comparison** (Spearman rank correlation and
  top-100 Jaccard overlap, exactly like the existing overlap-vs-bm25-vs-dense
  table above) is wired and tested but has no real numbers yet — it needs
  `data/embeddings-titan.json`, i.e. it needs the AWS account. This is the one
  piece of the model-comparison deliverable that is genuinely blocked on
  something outside this repo, not on missing code.
- **Tests for the pre-existing lexical baselines.** `tests/lib/dedup/` now
  exists (added alongside the Bedrock work) but only covers `embed.ts` and
  `scripts/ml/_shared.mjs`'s `buildMethods`/`loadAllEmbeddings`. Still worth
  adding, roughly in order:
  1. `buildBm25Index` — IDF and the length-normalisation term against
     hand-computed values on a 3-document toy corpus; the non-negative IDF
     variant specifically.
  2. `sweep()` in `evaluate.mjs` — that tied scores collapse into one row, and
     the tp/fp/fn arithmetic on a hand-built 6-item example.
  3. `averagePrecision` / `rocAuc` against known values (a perfect ranker → 1.0,
     a reversed ranker → 0.0, all-tied → 0.5 AUC).
  4. `overlapHits` — that it still equals the original `overlapScore` in
     `lib/tool-fit.ts` minus the quality term, on a fixed input. This is the
     regression that would silently invalidate the baseline comparison.
  5. `extract-corpus.mjs` null handling — `body: null`, missing `user`,
     `merged_at` absent on issues.
- **Shipping it** (backlog §3 step 6: Scout checks the index before filing, queue
  UI shows "similar to #114 (0.87)"). That needs a threshold, and a threshold
  needs the labels.

## Known gotcha for the container

The backlog flags it and it still stands: `onnxruntime-node` is unreliable on
musl, and the Dockerfile is `node:22-alpine`. Running the local backend in the
container will likely need `node:22-slim`. Untested — this all ran on macOS
(darwin 25.5.0, Node v26).
