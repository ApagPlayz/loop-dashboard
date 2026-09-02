# Handoff — AI/ML + AWS resume sprint (2026-09-02)

**Written under time pressure: the owner has job applications going out TONIGHT.**
Read the "What is true right now" section first — that is what can honestly go on a resume today.

---

## Goal

Loop Dashboard must be **both**:
1. A tool the owner personally uses to build his own Claude projects autonomously in the cloud.
2. A resume project filling **real** gaps.

Priority stated 2026-09-02, in his words: *"Experience with AI/ML concepts, large language
models (LLMs), and model evaluation techniques"* **plus an AWS component**.

Gaps confirmed by reading his resume (`~/Downloads/Alessio.Pagliarulo.Resume.pdf` — **do not
copy it into this repo, the repo is going public**):
- **Cloud (AWS/Azure/GCP): completely absent.** The biggest gap.
- **LLM / GenAI / agents: completely absent**, despite "AI & Operations Research" in his degree.
- **Docker / CI-CD / IaC: absent.**
- **TypeScript / React / Next.js: absent from Skills**, despite 31k lines of it here.
- **Already strong, do NOT add more:** classical ML/stats/optimization (CVaR, stochastic
  programming, Brier-score-validated classifier, walk-forward folds, Chronos-vs-Prophet
  benchmarking) and embeddings/vector search (Portal Pair: sentence-transformers MiniLM-L6-v2,
  384-dim cosine, ChromaDB, HNSW).

**The single most important consequence:** the duplicate-detection ML in this repo is
**resume-redundant** — it is the same skill Portal Pair already demonstrates. Keep it as a
feature; do not sell it as a gap-filler. What moves his resume is **AWS + LLM systems +
evaluation methodology**.

---

## What is true right now (verified this session, safe to claim)

All verified by running it, not by assertion.

- **47-test Vitest suite, passing.** `tests/lib/auth.test.ts` (session crypto: tampered
  payloads, forged signatures, expiry, key-version revocation, constant-time comparison under
  length mismatch) and `tests/lib/map-ai.test.ts` (LLM response parsing, error taxonomy,
  model-ID resolution, backend selection). Previously the project had **zero** tests.
- **Next.js upgraded 16.2.10 → 16.3.4**, closing **9 security advisories**, four high severity
  (App Router middleware/proxy bypass, SSRF in Server Actions, SSRF via rewrites, DoS).
  Verified with tsc + tests + build.
- **A complete model-evaluation pipeline** (`lib/dedup/`, `scripts/ml/`) — see Architecture below.
  Built and run end to end: 132-document corpus, 384-dim embeddings, BM25 + lexical baselines,
  150 stratified pairs with inclusion probabilities, an evaluation harness with PR curves,
  P@k/R@k, and 1000-replicate bootstrap CIs. **The harness was validated two ways:**
  chance-level AUC across five random-label seeds, and exact AP=1.000 recovery of a known rule.
- **A three-backend LLM abstraction** (`lib/map-ai.ts`, pre-existing): local CLI / Anthropic API
  / AWS Bedrock behind one interface, with forced-tool-use structured output, JSON-schema
  enforcement, retry on malformed output, and an error taxonomy.
- **Docker container** built and health-checked locally (301 MB, multi-stage, non-root).
- **A working LangGraph human-in-the-loop agent** (`lib/agent/`, `scripts/triage-cli.mjs`).
  Four nodes: `load_backlog → assess → propose → apply_decisions`, with `interrupt()` as the
  first executing statement in the final node and a `MemorySaver` checkpointer.
  **Verified live** against `ApagPlayz/content-generation-platform` on the local CLI backend:
  halted after 32.6s with `__interrupt__` set and no actions in state; `getState()` showed
  `next: ["apply_decisions"]` while paused and `next: []` after resume; supplying different
  decisions than the model proposed produced correspondingly different actions. **Nothing was
  written to GitHub** — dry-run is the default and `--apply` is required to write.
  *Honest caveat:* assessment verdicts wobble between runs on the same issues (#132 came back
  needs-info / decline / needs-info across three runs). The interrupt is what makes that
  acceptable — the model proposes, the human decides. Do not oversell the assessment step.
  `lib/agent/` has no Next.js or path-alias imports, so it lifts to AgentCore unchanged.
- **Amazon Titan Text Embeddings V2 backend** (`lib/dedup/embed.ts`) — the previously stubbed
  `bedrock` path, implemented via `InvokeModelCommand` with the request/response shape taken
  from AWS's published docs. 1024 dims, credentials from the default AWS chain, bounded
  concurrency with backoff on throttling, and it **never silently falls back to the local
  model**. Indexes are per-backend (`embeddings-local.json` / `embeddings-titan.json`) so both
  encoders coexist, and `evaluate.mjs` scores every available encoder side by side on the same
  gold set. `@aws-sdk/client-bedrock-runtime` was promoted from transitive to a direct
  dependency so a lockfile change cannot silently remove it.

### What is NOT true yet — do not claim these

- **Nothing has ever run on AWS.** As of writing there was no account; the owner has since
  created one but `aws login` had not yet been run.
- **No live Bedrock or Titan call has ever been made**, by any path. The Titan code is tested
  against a mocked SDK only.
- The duplicate-detection system has **no measured result** — `metrics/dedup-eval.json` holds
  random labels and is stamped `synthetic-smoke-test`. It needs `data/gold-pairs.jsonl` labelled.
- `"55/60 successful runs"` from earlier handoffs is **misleading** — median Scout run is 15s,
  most "successes" are agents standing down. Do not put it on a resume.

---

## Architecture — how the whole system works

### The loop (the product)

A control plane over autonomous Claude coding agents running against the owner's GitHub repos:

```
Scout ──files proposals as GitHub issues──▶ [OWNER APPROVES in dashboard queue]
                                                        │
                                                        ▼
                                          Builder ──opens a PR──▶ Auditor (5 parallel
                                                        │           adversarial reviewers)
                                                        ▼
                                            Demo (real browser, screenshots/video)
                                                        │
                                                        ▼
                                          weekly Retro ──▶ LEARNINGS.md
```

**The critical architectural split:** the agents do **not** run in the dashboard. They run as
`claude-code-action` inside **GitHub Actions runners** in the *target* repo (10 workflow
templates in `config/loop-template/workflows/`). GitHub supplies orchestration, durable state,
retries, logs and 6-hour execution for free. **The dashboard is the decision layer; GitHub
Actions is the execution layer.** This is why bolting on LangGraph/CrewAI to "host the agent
brain" was rejected — there is no brain to host, and Claude Code is a better one than a
hand-built graph.

### The data model — why there is no database

Application state lives in **GitHub itself**, read and written through the Contents API:
- Proposals and decisions = GitHub issues + labels.
- Builds = pull requests.
- Project registry = `config/projects.json` in this repo.
- Per-project settings = `.github/loop-config.json` in each target repo.
- Metrics = `metrics/loop-metrics.json`, committed daily by a workflow.

**Why:** the data is small, naturally versioned, human-readable, and already lives where the
work happens. Git gives history and rollback free. Nothing to run, pay for, or back up.
**Limits:** no transactions, no concurrent-write safety, no querying, and GitHub API rate
limits. This breaks the moment there are multiple users — which is exactly what the deferred
multi-tenancy phase would force.

### The AI layer (`lib/map-ai.ts`, 896 lines)

One funnel, `aiStructuredCall` / `aiChatCall`, with **three interchangeable backends**:
- `cli` — shells out to the local `claude` binary, sandboxed, tools disabled, `--json-schema`.
- `api` — Anthropic Messages API with **forced tool use** (`tool_choice: {type:"tool"}`) to
  guarantee structured JSON rather than free text.
- `bedrock` — same shape via `@anthropic-ai/bedrock-sdk`, credentials from the AWS chain
  (ECS task role in cloud, `AWS_PROFILE` locally). **Never executed live.**

Selection is `DASHBOARD_AI_BACKEND=cli|api|bedrock|auto`. `auto` tries CLI → Bedrock → API →
disabled. All 12 call sites in the app go through this funnel.

**Known gap, unfixed:** every response carries token counts and **the code discards them** —
`grep -n "usage" lib/map-ai.ts` returns zero hits. There is also **no prompt caching**
(`cache_control`) anywhere, and no rate limit or budget guard on AI spend.

### The ML layer (`lib/dedup/`, `scripts/ml/`)

**Problem:** the Scout keeps filing proposals into a queue nobody triages — 42 open issues,
last merge 2026-07-28, and ~19 near-duplicate pairs (two with identical titles).

**Pipeline:**
1. `scripts/ml/extract-corpus.mjs` → `data/corpus.jsonl` (132 docs, deterministic/idempotent).
2. `lib/dedup/baseline.ts` — two **lexical** baselines: `overlap` (the scorer already shipping
   in `lib/tool-fit.ts`, ported faithfully) plus a length-normalised variant, and a hand-written
   **Okapi BM25** (k1=1.5, b=0.75, non-negative IDF). No dependency added.
3. `lib/dedup/embed.ts` — **semantic** embeddings, MiniLM-L6-v2 via transformers.js, 384-dim,
   L2-normalised, ~3.5s for the corpus. Has an `EMBEDDING_BACKEND` switch (`local` live,
   `bedrock` stubbed) deliberately mirroring `map-ai.ts`'s `cli|api|bedrock` pattern.
4. `scripts/ml/generate-pairs.mjs` → 150 pairs **stratified** across score bands, each carrying
   its `inclusion_prob` so a biased sample can be corrected back to a corpus-level estimate
   (inverse-probability weighting). Random sampling was rejected: nearly all random pairs are
   trivially unrelated, so a system scores well without being good. **Hard negatives are the point.**
5. `scripts/ml/evaluate.mjs` → threshold sweep, PR curve, AP, ROC AUC, P@k/R@k, and
   **1000-replicate bootstrap confidence intervals**, for every method.

**The methodology, which is the actual skill:** establish baselines *first*, then measure the
challenger against them on a hand-labelled gold set, report intervals rather than point
estimates at small n, and validate the harness itself before trusting any number.

**Honest limits:** 87 of 132 documents exceed the model's context window and are truncated —
two thirds of the corpus is embedded from its opening only. And there is **no result yet**;
labelling is unfinished.

**Two data problems found by measurement, worth more than any model:**
- **Author leak:** all 24 human-authored PRs merged (100%); all 26 rejections are bot PRs. A
  merge-prediction model trained on all 70 learns "is this a human?" and reports a fake ~0.95 AUC.
- **Date confound:** the queue stalled 2026-07-28, so "not merged" mostly means "filed after
  triage stopped," not "bad idea."
- Also: the `declined` and `redraft` labels have **never been used** — every "no" in this
  system is silence, which is why an acceptance model is currently impossible.

### Auth (`lib/auth.ts`, `proxy.ts`)

Single shared password; **stateless HMAC-SHA256 signed cookies** via Web Crypto (works on the
Edge runtime where Node's `crypto` doesn't). Signing key separated from the login password;
`SESSION_KEY_VERSION` revokes all sessions without a password change. **Constant-time
comparison implemented three different ways**, including hashing both values before
`timingSafeEqual` to dodge its throw-on-length-mismatch. `proxy.ts` (Next 16 renamed Middleware
→ Proxy) gates every route except `/login`, `/api/login`, `/api/health`.

Stateless cookies mean **auth works across any number of containers** with no sticky sessions.

---

## Current state

`main` is clean, **88 tests passing**, `tsc` clean, and **11 commits ahead of `origin/main` —
nothing has been pushed.** Both build agents completed; no partial work is outstanding.

**The scoped execution plan is `docs/plans/tonight-2026-09-02.md`** — read it alongside this.

---

## Next steps, in priority order

### 1. `aws login` — the only hard blocker (owner, ~5 min)

The AWS account now exists. Run `aws login`, then `aws sts get-caller-identity` to confirm.
Also set the $10 budget alert and root MFA if not already done. **Use `us-east-1`, never
change it.** An IAM Identity Center admin user is the correct practice but was deferred for
speed — do it before this becomes a habit.

### 1b. Run Titan for real (~30 min, unblocked by 1)

```bash
EMBEDDING_BACKEND=bedrock node scripts/ml/build-index.mjs   # → data/embeddings-titan.json
node scripts/ml/evaluate.mjs
node scripts/ml/compare-encoders.mjs
```
**Titan needs no use-case form** (that form is Anthropic-specific; Amazon's own models aren't
sold through AWS Marketplace). Costs about half a cent. **This is what makes the AWS bullet
true.** Even with zero labels it yields a real result: Spearman rank correlation and top-k
Jaccard between MiniLM and Titan.

### 2. Amazon Titan embeddings — the fastest honest AWS + ML + evaluation win

**Critically: Titan needs NO use-case form.** The Anthropic first-time-use form does not apply
to Amazon's own models (Amazon, Meta, Mistral, DeepSeek, Qwen models "aren't sold through AWS
Marketplace and don't have product keys"). Titan is available as soon as an account exists.

Run the existing pipeline with `EMBEDDING_BACKEND=bedrock`, then evaluate **both encoders on the
same gold set**. That produces a real model-comparison table with confidence intervals =
"AI/ML + LLM + model evaluation + AWS" in one deliverable. Cost: about half a cent.

### 3. Label the gold set (owner, ~1 hour, or ~20 min for a partial set)

```bash
cp data/gold-pairs-unlabeled.jsonl data/gold-pairs.jsonl
# fill "label" on each row: duplicate | related | unrelated
node scripts/ml/evaluate.mjs
```
Every row carries both titles, both GitHub URLs, and all four method scores. Rows are shuffled
to prevent threshold drift. `evaluate.mjs` refuses to run on an incomplete file and names the
first offending pair. **Without this there is no measured result at all.**

### 4. LangGraph agent — DONE, notes retained for whoever extends it

Verified API notes for v1.4.13 (confirmed by running it, not from memory):
- `import { StateGraph, Annotation, START, END, MemorySaver, Command, interrupt } from "@langchain/langgraph"`
- `interrupt(value)` throws `GraphInterrupt` the first time, halting the node. Resume by
  invoking again with `new Command({ resume: value })` and the **same `thread_id`**.
- The halted `invoke()` result carries a top-level **`__interrupt__`** key.
- **Confirmed by experiment: on resume the node re-runs from the top.** Put no side effects
  before the interrupt.
- `graph.compile({ checkpointer: new MemorySaver() })`; a persistent saver just needs to extend
  `BaseCheckpointSaver` — a one-line swap.

### 5. Token/cost accounting (was in progress, not started in the repo)

All 12 call sites funnel through `lib/map-ai.ts`, so this is a single-point fix: read
`data.usage` (~:677, ~:736), `message.usage` (~:852), extend `CliEnvelope` (~:333) — **run the
CLI once with `--output-format json` to learn its real keys rather than guessing.** Emit
CloudWatch EMF lines on stdout so they become custom metrics for free once containerized.

### 6. Deploy to ECS (stretch)

Everything is pre-built. Three gotchas already identified:
- Build `--platform linux/amd64` — the owner is on Apple Silicon and ECS Express Mode pins
  x86_64; a mismatch crash-loops **and Express auto-rolls-back, hiding the evidence.**
- Pass `--health-check-path /api/health` — the default hits `/`, gets 307'd to `/login`, and the
  target never goes healthy.
- Pin `maxTaskCount: 1` — the default is 20, and six module-level in-memory stores
  (`lib/reporter-store.ts:31`, `app/api/reporter/route.ts:18`, `lib/map-ai-jobs.ts:51`,
  `lib/launcher-jobs.ts:33`, `lib/tool-fit-jobs.ts:41`, `lib/queues-evidence.ts:38`) assume one
  process, so background-job polling 404s with more.
- **`.github/workflows/deploy.yml` is wrong for Express Mode** — it calls
  `aws ecs update-service`, but Express services need `aws ecs update-express-gateway-service
  --service-arn`. Rewrite before relying on it.
- **Never set `LOOP_DASHBOARD_LOCAL_MODE` in the cloud** — six launcher routes gate on it.

---

## Key context and gotchas

- **`aws login`** (CLI v2.36.35) gives auto-refreshing temporary credentials from a console
  session — no long-lived access keys to create or leak. Use it.
- **Bedrock access is NOT an approval queue.** AWS: *"Access to the model is granted immediately
  after use case details are successfully submitted."* The `bedrock-mantle` endpoint — which
  `lib/map-ai.ts` defaults to — is exempt from the form entirely. **The real risk is quota:**
  new accounts often land with Anthropic on-demand quotas at ~0 and every call 429s, needing an
  unschedulable Support ticket. **So keep Bedrock off any critical path** — the app runs on
  `ANTHROPIC_API_KEY` and `aiBackend()` already falls through correctly.
- **App Runner is unavailable** (closed to new customers 2026-04-30) and **Bedrock Agents
  "Classic" closed to new customers 2026-07-30.** AgentCore is the successor.
- **Amazon Bedrock AgentCore is framework-agnostic** and explicitly supports LangGraph and
  CrewAI — so it was never "framework *or* AWS."
- **CrewAI is a dead end for this stack** — Python-only; the unofficial JS ports are abandoned.
- `langchain-core` had a critical RCE (CVE-2025-68664, CVSS 9.3) in Dec 2025 — pin versions.
- **The GitHub token in `.env.local` is still the GitHub CLI's OAuth token** (`gho_`, confirmed
  by hash comparison), not a fine-grained PAT. It leaked into a local log on 2026-08-31 and is
  **still not rotated.** Scopes: `repo`, `workflow`, `read:org`, `gist` across the whole account.
  `gh auth logout` does **not** revoke it — that needs
  github.com/settings/applications → "GitHub CLI" → Revoke.
- Scripts import `.ts` files directly by path (`../../lib/dedup/baseline.ts`) — Node 26 strips
  types natively, no loader needed. Follow that pattern.
- **CGP's `docs/loop-brief.md` is still empty** (untouched template, last modified 2026-07-27) —
  5 weeks open, blocking the Scout's quality.
- Three pre-existing lint errors remain, deliberately untouched: `components/help-chat.tsx:55`,
  `components/tools/catalog-browser.tsx:231`, `components/map/power-menu.tsx:221`.

## Verify commands

```bash
npm test            # 47 tests, must stay green
npx tsc --noEmit    # must stay clean
npm run build       # full Next.js build
```

## Open questions for the owner

1. **Rotate the GitHub token** — still outstanding since 2026-08-31.
2. **Is `CRON_SECRET` set in Vercel?** The cron fails closed without it, by design.
3. **The CGP loop brief** — approve the 5 drafted goals in
   `docs/drafts/cgp-loop-brief-draft-2026-08-18.md`, or change them? Blocking, 5 weeks open.
4. **Push the 7 local commits?** Nothing has been pushed to `origin/main` yet.
