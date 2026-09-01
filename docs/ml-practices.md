# ML Practices Reference: Semantic Near-Duplicate Detection

Written 2026-09-01. First ML project for this dashboard: detect near-duplicate GitHub issues/proposals using text embeddings + cosine similarity, evaluated against a lexical (keyword-based) baseline. Current stack: TypeScript, local embeddings via transformers.js. Later: swap the local embedding model for a Bedrock-hosted one, once there's an AWS account.

**How to read this doc.** Every claim is tagged:
- **VERIFIED** — confirmed by actually fetching a page (AWS docs, a paper, a library's own repo/registry) on or around 2026-09-01. A source URL is given.
- **judgment** — my own synthesis/opinion, applying the verified facts to your specific project. Not something you can independently look up and confirm word-for-word.
- **unverified** — something I looked for but could not confirm. Treat as a guess, not a fact, until checked again.

Everything here was researched fresh (not from training-data memory) because prices and model lineups change fast. If you're reading this more than a few months after 2026-09-01, re-verify anything with a dollar sign or a version number before relying on it.

---

## 1. AWS embedding options, as they exist now

You don't have an AWS account yet, so none of this is urgent — but it's useful to know what you're migrating *toward*, so today's TypeScript/transformers.js choices don't box you in.

### What Bedrock currently offers (VERIFIED)

**Amazon Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`)
- Output dimensions: 1024 (default), or 512, or 256 — you choose at request time. [Model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-text-embeddings-v2.html)
- Max input: 8,000 tokens.
- Price: **$0.02 per 1 million input tokens** — confirmed directly on [AWS's own ML blog](https://aws.amazon.com/blogs/machine-learning/optimizing-costs-of-generative-ai-applications-on-aws/). (One third-party tracker quoted a figure ~5.5x higher; treat that as an error — the AWS blog is the primary source.)
- Available in most commercial regions AWS lists for Bedrock (us-east-1/2, us-west-2, most eu-*, most ap-*, ca-central-1, sa-east-1, GovCloud). Launched Apr 2024, still active, no announced retirement.
- Billed directly as an AWS-native model (not a third-party marketplace line item).

**Cohere Embed English v3 / Multilingual v3** (`cohere.embed-english-v3`)
- Output: 1,024 dimensions (fixed), supports both float and binary vector formats.
- Max input: 512 tokens (~2,048 characters) — notably shorter than Titan.
- Price: **$0.0001 per 1,000 tokens** ($0.10/million) — 5x Titan v2's price.
- Billed as a third-party AWS Marketplace model (shows up separately in AWS Cost Explorer).
- [Model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-english.html)

**Cohere Embed v4** (`cohere.embed-v4:0`) — genuinely new, launched Apr 2025
- Multimodal: handles text, images, and mixed content in one model.
- Max input: 128,000 tokens — far beyond Titan or v3.
- Output: configurable 256–1,536 dimensions; supports float/int8/uint8/binary/ubinary formats (useful for shrinking storage).
- Price: **$0.12 per 1 million input tokens** (~6x Titan v2). This figure is cross-confirmed by two secondary sources but I could not get a clean fetch of AWS's own pricing table row for it — call it **VERIFIED-ish**, not primary-source-clean.
- [Model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-v4.html)

**Newer/other additions** — Amazon Nova Multimodal Embeddings and TwelveLabs Marengo Embed (video/audio) both appear to now be on Bedrock's catalog, but I could not get working model-card fetches for either. **unverified** in detail (dimensions, pricing) — don't rely on this until checked directly when you're actually evaluating AWS models.

### Which one to use (judgment)

For this project's scale — a full re-embed of your entire ~124-document corpus at, generously, 2,000 tokens/doc, is ~250,000 tokens. At Titan v2's price that's about **half a cent**. Cost is a non-issue at any of these price points for you; the real differentiators are dimension/quality tradeoffs and max input length. **Titan Text Embeddings V2 is the sensible default** when you get to Bedrock: cheapest, AWS-native billing, configurable dimensions, and 8K tokens is comfortably more than any GitHub issue body. Reach for Cohere v4 only if you later need multimodal (images in issues) or very long documents (>8K tokens) — neither applies to your current use case.

---

## 2. When SageMaker is (and isn't) the right tool

### SageMaker Serverless Inference — still exists, still active (VERIFIED)

Confirmed via [AWS's own docs](https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html): it's a real, current option, not deprecated. Key facts:
- Memory: 1024 MB–6144 MB, fixed increments. No GPU support.
- Cold starts are explicitly documented as a real tradeoff ("your endpoint may experience cold starts"), mitigated only by paying extra for Provisioned Concurrency.
- Max 200 concurrent invocations per endpoint, 50 endpoints per region.
- Billing: per-millisecond-of-compute (scaled to memory) plus $0.016/GB of data processed. The exact compute rate per GB-second I could not cleanly confirm from AWS's own pricing page (JS-rendered, wouldn't extract) — **unverified** on the exact number, though the shape of the pricing model (pay-per-invocation, no idle cost) is confirmed.

### SageMaker real-time endpoints — the actual overkill threshold (partially VERIFIED)

Instance pricing (ml.t3.large ≈ $0.10/hr, ml.m5.large ≈ $0.115/hr) came from a third-party tracker (CloudZero), not a clean AWS primary-source fetch — treat as **unverified-but-plausible**. What's more solid: the *shape* of the cost argument. Real-time endpoints bill by the hour whether or not you're using them. Break-even math from aggregated sources (not one clean citation, but internally consistent): you'd need well into the millions of predictions per month before a dedicated SageMaker instance beats pay-per-use alternatives. This project — occasional re-embedding of a 124-document corpus — is nowhere near that volume. **judgment: SageMaker real-time endpoints are not worth considering for this project, full stop, regardless of the exact break-even number.**

### The concrete alternatives, with real pricing (VERIFIED)

**AWS Lambda** — from AWS's published rates: $0.20 per 1M requests + $0.0000166667/GB-second (x86) or ~20% less on Graviton/arm64. Free tier covers 1M requests + 400,000 GB-seconds/month. Real caveat: a container-image Lambda bundling a data-science runtime (like an ONNX embedding model) can see cold-start init times over 4.5 seconds in benchmarks — fine for a background job, bad for anything a user is waiting on synchronously.

**AWS Fargate** (your actual planned migration target) — directly fetched from [aws.amazon.com/fargate/pricing](https://aws.amazon.com/fargate/pricing/): $0.000011244/vCPU-second (~$0.0404/vCPU-hour) and $0.000001235/GB-second (~$0.00444/GB-hour), billed per-second, 1-minute minimum, 20GB ephemeral storage included free.

**judgment:** given you're already migrating to ECS Fargate, the natural home for this project's embedding work is a scheduled Fargate batch task (e.g., nightly re-embed of new/changed issues) — not Lambda, not SageMaker. At this data volume, a job running a few minutes a day costs pennies a month, and it reuses infrastructure you're building anyway rather than adding a second compute platform to operate.

---

## 3. Vector storage at your scale (124 → maybe 10,000, headroom to 100k)

You don't need a "vector database" product to store 124 numbers-arrays. Here's the honest range of options, cheapest/simplest to heaviest, with real pricing where it applies.

### In-process / file-based (no AWS needed at all) — judgment, general knowledge

- **In-memory in the app process**: load all embeddings into a JS array/Float32Array at startup, compute cosine similarity in a loop. At 124–10,000 vectors × 384 dims, this is a few MB of RAM and brute-force cosine similarity over 10,000 vectors is sub-second on any modern CPU. This is almost certainly the right answer *today*, before any AWS migration.
- **A JSON or binary file committed to the repo** (or stored alongside your other data): dead simple, versioned with git, no infra. Binary (e.g. a flat Float32Array dump) is more compact than JSON at this scale but JSON is more debuggable. Fine up to low tens of thousands of vectors.
- **SQLite + `sqlite-vec`**: gives you a real query interface (SQL, filtering by metadata, `k`-nearest-neighbor search) without any server process, still just a file. Reasonable step up from raw JSON once you want to combine vector search with structured filtering (e.g. "near-duplicates, but only among open issues").

**judgment: for 124 documents, in-memory or a committed JSON/binary file is not a compromise — it's the correct engineering choice.** Anything heavier is solving a scale problem you don't have.

### AWS options, once you're migrated (VERIFIED pricing)

**pgvector on Aurora Serverless v2** — [pricing](https://aws.amazon.com/rds/aurora/pricing/): $0.12/ACU-hour (Standard) or $0.156/ACU-hour (I/O-Optimized), storage $0.10/GB-month (Standard). Confirmed: Aurora PostgreSQL supports pgvector v0.8.0 with HNSW indexing, and Aurora Serverless v2 supports **scale-to-zero** (0 ACU, auto-pause/resume) as of a Nov 2024 change — though storage cost continues while compute is paused. **judgment:** if you're already going to want a relational Postgres database for structured data (PR outcomes, proposal metadata), pgvector on a pausable Aurora cluster is a very reasonable home for vectors at 10k–100k scale — cheap, one less system to run, real indexing.

**OpenSearch Serverless** — [pricing](https://aws.amazon.com/opensearch-service/pricing/): $0.24/OCU-hour, $0.02/GB-month storage. The classic ("Classic Collections") tier has a **minimum of 2 always-on OCUs**, which floors out around **~$350/month regardless of how small your dataset is** — confirmed directly from AWS's pricing page. That is dramatically overkill for 124–10,000 vectors. There is a newer **"NextGen Collections"** tier (GA'd May 2026, confirmed via [AWS's blog](https://aws.amazon.com/blogs/big-data/the-next-generation-of-amazon-opensearch-serverless-built-from-the-ground-up-for-agents/)) that can scale to 0 OCU after 10 minutes idle, with 10–30 second cold-start latency on wake — this narrows the cost gap a lot, but still requires standing up collection-group infrastructure that buys you nothing at this scale. **judgment: skip OpenSearch entirely for this project.** It's built for a different problem (full-text + vector hybrid search at real scale, high query volume).

**S3 Vectors** — this is real, not a rumor. Confirmed **GA on Dec 2, 2025** via [AWS's own announcement](https://aws.amazon.com/about-aws/whats-new/2025/12/amazon-s3-vectors-generally-available/), with a further price cut (up to 80% on large-index queries) confirmed in a [June 2026 announcement](https://aws.amazon.com/about-aws/whats-new/2026/06/s3-vectors-reduces-query-charges-80-percent-large-indexes/) — i.e., it's actively maintained, not abandoned. Limits (from [AWS docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html)): up to 2 billion vectors/index, 1–4,096 dimensions, up to 10,000 top-K results per query. Pricing is object-storage-shaped (pay for storage + actual query volume, no idle/provisioned-capacity charge) — roughly ~$0.06/GB-month storage, ~$0.20/GB writes, ~$2.50/million queries plus data-processing (exact current rate table **unverified** — secondary sources only, primary pricing page didn't extract cleanly). Query latency is "under one second" per AWS's own GA announcement — fine for a background dedup pass, not for sub-100ms interactive use.

**judgment: S3 Vectors is the best-fit *AWS* option if/when you outgrow in-process storage.** It matches your usage pattern (infrequent batch-style queries, tiny data volume, no interactive-latency requirement) and has no idle-cost floor, unlike OpenSearch. But given your actual scale, this is a "know it exists for later" note, not a near-term action — you're years of data growth away from needing it.

### Bottom line for this project (judgment)

Stay in-process (in-memory + a committed file) through the current TypeScript phase. When you migrate to AWS, if the corpus is still in the thousands, pgvector-on-Aurora (if you already have Postgres) or S3 Vectors (if you don't) are the two credible options. OpenSearch Serverless and SageMaker are both solving problems you don't have yet.

---

## 4. Evaluating a retrieval / near-duplicate-detection system rigorously

This is the part most likely to be skipped in a "quick script," and the part that actually makes the difference between "we tried something" and "we can defend this number."

### Building a gold (labeled) set (VERIFIED + judgment)

A real, shipped, closely-analogous system — a job-posting duplicate detector — used a **176-pair validation set** (74 duplicate, 73 non-duplicate, ambiguous cases discarded rather than force-labeled) plus a **separate, independently-labeled 50-pair test set held out from tuning entirely** ([Engelbach et al., arXiv:2406.06257](https://arxiv.org/abs/2406.06257), full PDF read). This is directly useful as a template: it confirms that a labeled set in the tens-to-low-hundreds of pairs, split into a tuning set and a genuinely separate test set, is treated as legitimate in production, not just a toy.

**The single most important, well-evidenced practice here: don't use random pairs as negatives.** Random pairs of unrelated documents are trivially easy to tell apart — any method, including a bad one, "succeeds" on them, which tells you nothing. The rigorous approach is **hard negatives**: for each document, find its most similar-but-not-actually-duplicate neighbors (by running your own similarity method first) and use *those* as the negative examples you label. This is documented practice from the [Hasso Plattner Institute's duplicate-detection research](https://hpi.de/naumann/projects/data-quality-and-cleansing/deduplication.html) (lower-confidence source — page didn't fetch cleanly, relying on search summary) and independently corroborated by standard sentence-transformers hard-negative-mining guidance. **judgment: when you build your labeled eval set, deliberately include topically-similar-but-not-duplicate pairs, not just random ones** — otherwise your precision/recall numbers will look artificially great and won't reflect real performance.

No source gives a hard statistical minimum for "how many labeled pairs is enough." [Pinecone's evaluation guide](https://www.pinecone.io/learn/offline-evaluation/) suggests 10 queries as an absolute floor for even preliminary signal and stresses reporting multiple metrics together rather than trusting one number. With your "a few dozen" labeled pairs, treat that as a floor for getting *directional* signal, not a number precise enough to report without uncertainty bounds (see below).

### The right metric for your specific task shape (VERIFIED)

Your task — "is document X a near-duplicate of document Y" — is a **pairwise binary decision**, not a ranked list. That means:

- **Precision, Recall, and F1 at a chosen similarity threshold** are the right primary metrics — not MRR or nDCG, which are designed for ranked retrieval (e.g. "here are the 5 most likely duplicates of X, in order"). [Weaviate's retrieval-metrics guide](https://weaviate.io/blog/retrieval-evaluation-metrics) confirms: Precision@K = (relevant items in top K)/K, Recall@K = (relevant items in top K)/(total relevant items) — both metrics for a *list*, not a pair.
- If you *also* build a "here are the likely duplicates of this proposal, ranked" feature later, **MRR** fits when there's typically one true duplicate per query, **nDCG** fits when relevance is graded or multiple valid matches exist (formula: nDCG = DCG/IDCG where DCG@k = Σ(2^relᵢ−1)/log₂(i+1), from the original [Järvelin & Kekäläinen 2002 paper](https://faculty.cc.gatech.edu/~zha/CS8803WST/dcg.pdf)).

### Picking a similarity threshold properly (VERIFIED)

Don't guess a cosine-similarity cutoff (e.g. "0.8 means duplicate"). The rigorous approach, confirmed both in [scikit-learn's own `precision_recall_curve` docs](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.precision_recall_curve.html) and demonstrated in the job-posting paper above:

1. Compute the similarity score for every pair in your labeled *tuning* set.
2. Sweep every possible threshold, computing precision/recall/F1 at each.
3. Pick the threshold that maximizes F1 (or whatever metric matters most to you — e.g. weight recall higher if missing a duplicate is worse than a false alarm).
4. **Freeze that threshold**, then evaluate it exactly once on your held-out *test* set — never re-tune after seeing test results, or the number stops meaning anything.

### Being honest about a tiny eval set (VERIFIED — with an important caveat)

With only ~30–50 labeled pairs, a bare number like "85% precision" is nearly meaningless without an error bar. **Bootstrap confidence intervals** — resample your labeled pairs with replacement, recompute the metric each time, take the 2.5th/97.5th percentile — are the standard way to get one ([Indeed Engineering's writeup](https://engineering.indeedblog.com/blog/2026/07/bootstrap-confidence-intervals-for-llm-evaluation/)).

**Important, well-evidenced caveat**: bootstrap CIs are known to be *too narrow* (falsely confident) at very small sample sizes. A practitioner analysis with actual simulated coverage numbers ([rdoodles.rbind.io](https://rdoodles.rbind.io/2022/11/bootstrap-confidence-intervals-when-sample-size-is-really-small/)) found a nominal-95% bootstrap CI only actually covers the true value ~81–83% of the time at n=5, and still only ~91–93% at n=20 — full nominal coverage isn't reached until roughly n=40+. **judgment: report your bootstrap CI, but explicitly say it's likely optimistic given your sample size** — that honesty is itself a marker of rigor, more credible than a clean-looking number.

**Leave-one-out cross-validation (LOOCV)** — train/tune on all-but-one example, repeated so every item is held out once — is well-suited to checking *threshold stability*: does your chosen F1-optimal threshold move much if you drop any single labeled pair? That's a good sanity check at your scale, more than it is a way to compute a headline metric (some ranking-style metrics are known to be biased under LOOCV; simple correct/incorrect-style metrics are not).

### Comparing fairly against your lexical baseline (VERIFIED)

This is the most important methodological point for your project specifically, because your whole plan is "embeddings vs. lexical baseline."

**Lexical baselines (TF-IDF, BM25, keyword/Jaccard overlap) are not a strawman.** The [BEIR benchmark paper](https://arxiv.org/abs/2104.08663) — testing lexical vs. dense embedding retrieval across 18 datasets — found BM25 is "a robust baseline" that dense embedding models frequently fail to beat out-of-domain. GitHub issue/proposal text is exactly the kind of jargon-dense, terminology-heavy text where lexical overlap can be a genuinely strong signal. **Don't assume your embeddings will win — that's an empirical question your evaluation should actually answer, and "the lexical baseline won" is a legitimate, reportable finding, not a failed experiment.**

To make the comparison fair (judgment, applying general benchmarking-methodology consensus):
- Apply the same preprocessing (lowercasing, markdown stripping, etc.) to both approaches.
- Tune the baseline too — don't leave BM25 at library defaults while F1-optimizing the embedding threshold. An under-tuned baseline makes any comparison misleading.
- Report the *difference* between the two methods with its own confidence interval (a paired bootstrap over the same labeled pairs), not two separate numbers eyeballed side by side — with only a few dozen pairs, a gap like "0.85 vs 0.78" could easily be noise rather than a real effect.

---

## 5. Embedding model choice in JavaScript

### transformers.js is current and healthy (VERIFIED)

The package is now `@huggingface/transformers` (the `@xenova/transformers` name is the predecessor). Latest version at research time: **4.2.0**, published 2026-04-23. The GitHub repo (`huggingface/transformers.js`) has 16,281 stars, is not archived, and had a commit the day before this research ran (2026-08-31) — this is actively maintained, not an abandoned library. Weekly npm downloads: ~2.82M. v4 rewrote the WebGPU runtime and works across Node/Bun/Deno/browser. [Source: HF's v4 blog post](https://huggingface.co/blog/transformersjs-v4), GitHub/npm registry APIs.

### Is all-MiniLM-L6-v2 still reasonable? (VERIFIED + judgment)

Yes, but it's no longer the best small model available. Specs: 384 dimensions, ~22.7M parameters, 256-token input cap, Apache 2.0. It scores roughly **56.3 on the legacy MTEB benchmark** — genuinely the *weakest* of the small-model options checked below. It remains the most heavily used and battle-tested option in the transformers.js ecosystem (26M+ downloads on its HF repo), which has real value: less risk of hitting an obscure compatibility bug.

**judgment:** for your project — short issue/proposal text, ~124 documents — the quality gap between MiniLM and a better small model almost never flips an actual duplicate/not-duplicate decision that good threshold-tuning wouldn't already catch. Staying on MiniLM now, given you're planning to swap to a Bedrock-hosted model later anyway, is a defensible cost-minimizing choice — not the only correct one, but a reasonable one.

### Better small models that also run via transformers.js (VERIFIED, from Hugging Face Hub directly)

| Model | Dims | Notes |
|---|---|---|
| `BAAI/bge-small-en-v1.5` | 384 | MIT license, close drop-in replacement, modest quality bump over MiniLM |
| `thenlper/gte-small` | 384 | MIT, similar tier to bge-small |
| `intfloat/e5-small-v2` | 384 | MIT, requires "query:"/"passage:" text prefixing — a workflow change |
| `nomic-ai/nomic-embed-text-v1.5` | 768 (truncatable) | ~62.28 legacy MTEB — a real step up from MiniLM's 56.3; 8,192-token context; confirmed transformers.js-compatible |
| `google/embeddinggemma-300m` | 768 (truncatable to 128/256/512) | Released ~Sept 2025; Google states it's the #1-ranked open model under 500M params on MTEB; confirmed working with transformers.js via a closed GitHub issue |

**judgment recommendation:** if you want a meaningful quality upgrade while staying local/small, `nomic-embed-text-v1.5` or `google/embeddinggemma-300m` are the strongest options, both verified MTEB-better than MiniLM and both confirmed to run through transformers.js/ONNX. `bge-small-en-v1.5` is the safest near-zero-effort upgrade (same 384 dims as MiniLM, so no downstream code changes) if you'd rather change one thing at a time.

**Caveat on MTEB numbers**: MTEB moved to a v2 benchmark in 2026; v1 ("legacy") and v2 scores are not comparable. The numbers above are legacy v1, pulled directly from each model's own metadata on Hugging Face — flag any MTEB number you use elsewhere with which version it's from.

### ONNX runtime + Alpine/musl — a real compatibility trap for your ECS Fargate plan (VERIFIED)

`onnxruntime-node` (the native binding transformers.js uses server-side) ships binaries linked against **glibc**. Alpine Linux uses **musl libc** — incompatible, and this remains an open, unresolved issue as of 2026 (confirmed via a live GitHub issue thread and the upstream onnxruntime repo). Symptom: a `ld-linux-x86-64.so.2: No such file or directory` error at runtime, not at build time.

**judgment/action item:** when you containerize the embedding pipeline for ECS Fargate, build from `node:20-slim` (Debian-based, has glibc) — **not** `node:alpine`. This sidesteps the whole problem; Fargate doesn't have the tight image-size constraints that make Alpine worth the risk here.

---

## 6. General ML engineering practices worth demonstrating at this scale

### Baseline-first discipline (VERIFIED)

[Google's "Rules of Machine Learning"](https://developers.google.com/machine-learning/guides/rules-of-ml) states this directly: a simple baseline "provides baseline metrics and baseline behavior that you can use to test more complex models," and complex models are hard to judge as better or worse without one. Your plan — build the lexical baseline, then show whether embeddings actually beat it — **is this practice already, by design.** Report the delta as your headline result, not the embedding model's numbers in isolation.

### Data leakage — what it means for a dedup pipeline (VERIFIED + judgment)

The general finding, with real measured effect size: language models evaluated on data overlapping their training set are known to score meaningfully higher than on genuinely unseen data (documented in [Lee et al., "Deduplicating Training Data Makes Language Models Better," arXiv:2107.06499](https://arxiv.org/abs/2107.06499) — GPT-3 scored 84% on leaked benchmark examples vs. 70% on clean ones).

Applied to your project (judgment, not directly sourced):
1. **Don't tune your similarity threshold and report your final accuracy on the same pairs.** If all your labeled pairs come from one pool used both to pick the threshold and to report the result, your number is inflated — this is why the tune-set/test-set split in Section 4 matters.
2. If you ever fine-tune an embedding model on your own corpus later, watch for near-duplicates of your *evaluation* pairs leaking into the fine-tuning data — that would silently inflate reported gains.

### Train/test hygiene at n≈50 (VERIFIED + judgment)

A single random train/test split is genuinely unreliable at small sample sizes — one peer-reviewed study found mean train/test performance differences of 0.092 (±0.071) AUC purely from which random split was drawn ([PMC8360533](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8360533/)). The standard remedy is cross-validation — computing the metric across several different splits and reporting the *spread*, not just one number.

**judgment: with your ~46–54 labeled pairs, a single fixed split is not defensible. Use k-fold cross-validation (or leave-one-out) and report the range/std-dev across folds, not a single point estimate.** This is cheap to do and is one of the clearest, lowest-effort signals of rigor in a small project like this.

### Model cards — worth a lightweight version (VERIFIED + judgment)

Hugging Face's own [model card docs](https://huggingface.co/docs/hub/model-cards) define the standard sections (description, intended use, training data, evaluation) but explicitly say cards aren't mandatory and can be trimmed to what's useful. For a 124-document internal tool, skip the bias/safety sections aimed at public model releases, and instead write a compact record covering: which embedding model + exact version/revision was used, what it was evaluated against (baseline, eval set, and its known limitations), the cross-validated results (not a single number), and the planned Bedrock swap. Think of it as a **reproducibility note**, not a public model card.

### Reproducibility for a small pipeline (judgment, general MLOps practice)

Pin the embedding model by its exact Hugging Face **revision hash**, not just its name (weights/README can change upstream without a version bump). Pin your transformers.js and onnxruntime-node versions via lockfile — this matters more than usual here, given the musl compatibility issue above. Keep a small JSON/markdown eval-report file per run: model revision, library versions, git commit, eval-set identity, per-fold scores, and the raw similarity scores for each pair (so results are recomputable without rerunning the model).

### Is MLflow/W&B overkill here? (VERIFIED + judgment)

Practitioner consensus on this is fairly consistent: Hacker News discussions on MLflow specifically ([1](https://news.ycombinator.com/item?id=33624018), [2](https://news.ycombinator.com/item?id=33625904)) converge on "a database/spreadsheet and some scripts get you extraordinarily far" for solo or small-team work, with the heavier tooling earning its keep only once multiple people need shared access to a model registry and experiment history. There's also a concrete, current reason to be cautious about self-hosting MLflow specifically: a real SSRF vulnerability actively exploited to steal cloud credentials was reported in [August 2026](https://thehackernews.com/2026/08/attackers-exploit-mlflow-ssrf-flaw-to.html) — extra self-hosted infrastructure is extra attack surface, which matters given this project's own AWS security work.

**judgment: yes, MLflow/W&B are overkill for this project.** A git-committed JSON or markdown eval-results file per run — the same thing recommended for reproducibility above — gives you versioned, diffable history with zero added infrastructure, proportionate to a single-owner, 124-document project.

---

## Summary — what this means for your project right now

- **Vector storage**: stay in-process (in-memory + a committed file). Don't reach for a vector database at this scale.
- **Embedding model**: `all-MiniLM-L6-v2` via transformers.js is a defensible default; `nomic-embed-text-v1.5` or `bge-small-en-v1.5` are reasonable upgrades if you want one now rather than waiting for the Bedrock swap.
- **Evaluation**: build a labeled gold set with real hard negatives (not random pairs), split it into a tuning set and a genuinely separate test set, pick your similarity threshold by sweeping F1 on the tuning set only, and report results with a bootstrap confidence interval (explicitly flagged as likely optimistic at your sample size) plus cross-validation spread rather than a single clean-looking number.
- **Baseline comparison**: tune the lexical baseline as seriously as the embedding threshold, and treat "the baseline wins" as a legitimate possible outcome, not a failure to hide.
- **Containerization**: when this moves to ECS Fargate, use a glibc base image (`node:slim`), not Alpine — `onnxruntime-node` doesn't support musl.
- **AWS migration path (later)**: Titan Text Embeddings V2 for embeddings (cheap, AWS-native); a scheduled Fargate batch job rather than SageMaker or Lambda for running it; pgvector-on-Aurora or S3 Vectors (not OpenSearch) if you ever outgrow in-process vector storage.
- **Experiment tracking**: a committed JSON/markdown eval log is sufficient; don't stand up MLflow/W&B for this.

---

## Sources

**AWS / infrastructure**
- Titan Text Embeddings V2 model card — https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-text-embeddings-v2.html
- Titan V2 pricing confirmation — https://aws.amazon.com/blogs/machine-learning/optimizing-costs-of-generative-ai-applications-on-aws/
- Cohere Embed English v3 model card — https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-english.html
- Cohere Embed v4 model card — https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-cohere-embed-v4.html
- SageMaker Serverless Inference docs — https://docs.aws.amazon.com/sagemaker/latest/dg/serverless-endpoints.html
- AWS Fargate pricing — https://aws.amazon.com/fargate/pricing/
- Aurora pricing (pgvector, Serverless v2) — https://aws.amazon.com/rds/aurora/pricing/
- OpenSearch Serverless pricing — https://aws.amazon.com/opensearch-service/pricing/
- OpenSearch Serverless NextGen (scale-to-zero) announcement — https://aws.amazon.com/blogs/big-data/the-next-generation-of-amazon-opensearch-serverless-built-from-the-ground-up-for-agents/
- S3 Vectors GA announcement (Dec 2025) — https://aws.amazon.com/about-aws/whats-new/2025/12/amazon-s3-vectors-generally-available/
- S3 Vectors price reduction (Jun 2026) — https://aws.amazon.com/about-aws/whats-new/2026/06/s3-vectors-reduces-query-charges-80-percent-large-indexes/
- S3 Vectors limitations — https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html

**Evaluation practices**
- Engelbach et al., "Combining Embeddings and Domain Knowledge for Job Posting Duplicate Detection," arXiv:2406.06257 — https://arxiv.org/abs/2406.06257
- Weaviate, "Retrieval Evaluation Metrics" — https://weaviate.io/blog/retrieval-evaluation-metrics
- Järvelin & Kekäläinen, "Cumulated Gain-Based Evaluation of IR Techniques" (2002), original nDCG paper — https://faculty.cc.gatech.edu/~zha/CS8803WST/dcg.pdf
- scikit-learn, `precision_recall_curve` docs — https://scikit-learn.org/stable/modules/generated/sklearn.metrics.precision_recall_curve.html
- scikit-learn, `StratifiedKFold` docs — https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.StratifiedKFold.html
- Pinecone, "Offline Evaluation" guide — https://www.pinecone.io/learn/offline-evaluation/
- Thakur et al., "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of IR Models," arXiv:2104.08663 — https://arxiv.org/abs/2104.08663
- Indeed Engineering, "Bootstrap Confidence Intervals for LLM Evaluation" — https://engineering.indeedblog.com/blog/2026/07/bootstrap-confidence-intervals-for-llm-evaluation/
- rdoodles.rbind.io, "Bootstrap confidence intervals when sample size is really small" — https://rdoodles.rbind.io/2022/11/bootstrap-confidence-intervals-when-sample-size-is-really-small/

**JS embedding models**
- Hugging Face, "Transformers.js v4" blog — https://huggingface.co/blog/transformersjs-v4
- transformers.js GitHub repo/releases — https://github.com/huggingface/transformers.js
- `sentence-transformers/all-MiniLM-L6-v2` — https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- `nomic-ai/nomic-embed-text-v1.5` — https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
- Google, EmbeddingGemma announcement — https://developers.googleblog.com/en/introducing-embeddinggemma/
- transformers.js issue confirming EmbeddingGemma support — https://github.com/huggingface/transformers.js/issues/1418
- onnxruntime-node / Alpine musl issue — https://github.com/huggingface/transformers.js/issues/1275, https://github.com/microsoft/onnxruntime/issues/9483
- MTEB leaderboard changes (v1 → v2) — https://github.com/embeddings-benchmark/mteb/discussions/674

**General ML engineering practices**
- Google, "Rules of Machine Learning" — https://developers.google.com/machine-learning/guides/rules-of-ml
- Eugene Yan, "The First Rule of Machine Learning: Start Without Machine Learning" — https://eugeneyan.com/writing/first-rule-of-ml/
- Lee et al., "Deduplicating Training Data Makes Language Models Better," arXiv:2107.06499 — https://arxiv.org/abs/2107.06499
- SemHash (semantic dedup / leakage detection library) — https://github.com/MinishLab/semhash
- Train/test split reliability at small sample sizes — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8360533/
- Hugging Face, Model Cards docs — https://huggingface.co/docs/hub/model-cards
- Hacker News, "Who needs MLflow when you have SQLite?" — https://news.ycombinator.com/item?id=33624018
- The Hacker News, MLflow SSRF vulnerability report (Aug 2026) — https://thehackernews.com/2026/08/attackers-exploit-mlflow-ssrf-flaw-to.html

**Not independently verified** (flagged in-line above; don't treat as confirmed without re-checking): exact Cohere Embed v4 pricing table row on AWS's own pricing page; Amazon Nova Multimodal Embeddings specs; SageMaker real-time instance hourly rates (sourced from a third-party tracker, not AWS directly); exact S3 Vectors current rate table.
