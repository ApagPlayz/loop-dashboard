# Backlog

The agreed list of what to build next, in order, with the reasoning kept attached so it
survives a context reset. Updated 2026-09-01.

**Direction:** this is a personal project first — a tool the owner actually uses to build
their own projects autonomously on AWS, posted publicly as portfolio work. Selling it is a
later, separate question. Multi-tenancy is deferred (see `design-decisions.md` §7).

---

## 0. Fix the GitHub credential — IN PROGRESS, blocks nothing else but goes first

The `GITHUB_TOKEN` in `.env.local` is **the GitHub CLI's own OAuth token** (`gho_`),
confirmed by hash comparison — not a fine-grained PAT as `.env.example` and `README.md`
claim. It leaked into a local agent log on 2026-08-31. Its scopes are `repo`, `workflow`,
`read:org`, `gist` across the entire account.

**Steps, in this order:**
1. Create a fine-grained PAT at <https://github.com/settings/personal-access-tokens>,
   scoped to the target repo(s), with: Contents (r/w), Issues (r/w), Pull requests (r/w),
   Actions (r/w), **Secrets (read)**, **Workflows**.
   The last two are not documented in `.env.example` — they were found only by reading the
   code (`app/api/map/projects/checklist/route.ts` calls `listRepoSecrets`; writing into
   `.github/workflows/` needs the Workflows permission).
2. Put the new value in `.env.local`. No code changes needed — everything reads one variable.
3. Revoke the leaked token: <https://github.com/settings/applications> → "GitHub CLI" →
   Revoke access. `gh auth logout` does **not** revoke, per gh's own help text.
4. `gh auth login` again to restore the CLI (revoking signs `gh` out on all devices).

**Also:** update `.env.example` to document the two missing permissions. Check what
`GITHUB_TOKEN` is set to in Vercel's environment variables — if it starts with `gho_` it
also needs rotating; if `github_pat_`, it is a separate token and is probably fine.

**Not affected:** `secrets.GITHUB_TOKEN` in the loop workflow templates is GitHub Actions'
auto-issued per-run token. Nothing to rotate.

---

## 1. Add a test suite — DONE 2026-09-01

Vitest added; **47 tests passing** (`npm test`), `tsc` clean. Files: `vitest.config.mts`,
`tests/lib/auth.test.ts` (20), `tests/lib/map-ai.test.ts` (27). No network calls, process
spawns, or filesystem access in any test. Three pure helpers in `lib/map-ai.ts` gained an
`export` keyword; no logic changed. No bugs were uncovered — every assertion passed as
written.

Also done in the same pass: **Next.js upgraded 16.2.10 → 16.3.4**, closing 9 advisories
(4 high: App Router middleware/proxy bypass, SSRF in Server Actions, SSRF via rewrites,
DoS in Server Actions). Verified with tsc + tests + build.

Still worth adding later: a regression test that `overlapHits` in `lib/dedup/baseline.ts`
still matches `overlapScore` in `lib/tool-fit.ts` — if those drift, the whole
baseline-vs-dense comparison silently becomes invalid. See `docs/ml-dedup.md` for the
other four candidates.

**Original plan, for reference** — 15–20 tests targeting the two areas where a bug is both
likely and expensive:
- **Auth crypto** (`lib/auth.ts`) — signature verification, tampered and expired cookies,
  `SESSION_KEY_VERSION` revocation, constant-time comparison under length mismatch.
- **AI schema validation** (`lib/map-ai.ts`) — `parseLoose` fence-stripping and
  first-object extraction, the retry-on-malformed-JSON path, `AiError` status mapping.

These are pure functions with no network calls, so they are cheap to test and the tests
prove the security claims rather than just asserting coverage. Rank above everything except
the credential fix.

---

## 2. Actually deploy to AWS

Nothing has ever run on AWS; there is no account. Until this happens, none of the AWS
material is honestly claimable on a resume.

1. Create an AWS account, `aws login`, and **request Bedrock model access immediately** —
   it is an approval on Amazon's side, so start that clock first.
2. Pilot Bedrock on **one** non-critical workflow per `docs/bedrock-setup.md`; confirm the
   call appears in CloudTrail. Leave the Scout on the subscription.
3. Stand the container up on ECS, then set five repo variables for
   `.github/workflows/deploy.yml`: `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `ECR_REPOSITORY`,
   `ECS_CLUSTER`, `ECS_SERVICE`. (`AWS_ACCOUNT_ID` is documented in that file's header but
   never actually consumed by it — it only appears inside the role ARN.)
4. Create the EventBridge Scheduler rule, then delete `vercel.json`.

---

## 3. Machine learning work

The owner wants genuine ML — not more LLM API calls, which the project already does
extensively. A brainstorming pass ran 2026-09-01 against the **live GitHub data**, not the
handoff's summary. Findings below are measured.

### Data problems that must be respected

- **The `declined` and `redraft` labels have never been used — 0 issues each.** Every "no"
  in this system is silence, not a recorded judgment. This blocks any acceptance model.
- **Author leak:** all 24 human-authored PRs merged (100%); all 26 rejections are bot PRs.
  A merge-prediction model trained on all 70 learns "is this a human?" and reports a fake
  ~0.95 AUC.
- **Date confound:** last merge was 2026-07-28 and the queue has been stalled since, so
  "not merged" / "ignored" mostly means *filed after triage stopped*, not *bad idea*.
- **"55/60 successful runs" is not a trustworthy metric.** Median Scout run is 15s, Builder
  64s, Retro 560s — the short ones are stand-downs. `LEARNINGS.md` line 1 already says a
  green run that did nothing is a lie. Do not quote this figure on a resume.
- Cost, tokens, and model-used are **recorded nowhere**.

### Build first: semantic duplicate detection — BUILT 2026-09-01, blocked on labelling

Steps 1–5 below are implemented and have been run end to end. See `docs/ml-dedup.md` for
the run order and `docs/ml-practices.md` for the sourced background reading.

- `scripts/ml/extract-corpus.mjs` → `data/corpus.jsonl` — **132 documents** (62 issues,
  70 PRs). Re-runnable, byte-identical output.
- `lib/dedup/baseline.ts` — the in-repo `overlap` scorer, a normalised variant, and a
  hand-written Okapi BM25 (no dependency added).
- `lib/dedup/embed.ts` + `scripts/ml/build-index.mjs` → `data/embeddings.json` — MiniLM,
  384 dims, 3.5s warm for the whole corpus. `EMBEDDING_BACKEND` switch with `local` live
  and `bedrock` a documented throw (no silent fallback).
- `scripts/ml/generate-pairs.mjs` → `data/gold-pairs-unlabeled.jsonl` — 150 pairs across
  5 strata, each row carrying its `inclusion_prob` so a corpus-level estimate is possible.
- `scripts/ml/evaluate.mjs` → `metrics/dedup-eval.json` — threshold sweep, PR curve, AP,
  ROC AUC, P@k/R@k, and 1000-replicate bootstrap CIs.

**Nothing is claimed about baseline vs dense yet.** The eval file currently holds random
labels and is stamped `synthetic-smoke-test`; it exists only to prove the harness runs.
The harness was validated two ways: chance-level AUC across five random-label seeds, and
exact AP = 1.000 recovery of a known rule.

**Two corrections to the original assumptions:** the fp32 MiniLM model is **90 MB, not
23 MB** (23 MB is the int8 variant, wired up as `EMBEDDING_DTYPE=q8` but unused), and
**87 of 132 documents exceed MiniLM's context window and are truncated** — for two thirds
of the corpus only the opening is encoded. Both are real limitations, not blockers.

**One label-free finding:** dense and BM25 rank pairs meaningfully differently (Spearman
0.51, top-100 Jaccard 0.49), so labelling will be able to separate them. Meanwhile raw
`overlap` and BM25 correlate at ρ = 0.96 — they are nearly the same ranker on this data.

**THE ONLY BLOCKER — roughly one hour of owner time:**
```bash
cp data/gold-pairs-unlabeled.jsonl data/gold-pairs.jsonl
# fill in "label" on all 150 rows: duplicate | related | unrelated
node scripts/ml/evaluate.mjs
```
Each row already carries both titles, both GitHub URLs, and all four scores. Rows are
shuffled to prevent threshold drift. `evaluate.mjs` refuses to run on an incomplete file
and names the first offending pair.

Expect overlapping bootstrap intervals once labelled — 150 pairs is small. **Report the
interval, not the point estimate.** Later: swap the encoder (`bge-small-en-v1.5` or
`nomic-embed-text-v1.5` are current upgrades over MiniLM) and rerun the same eval.

### Original plan, for reference (~25h)

Needs no labels to start, has a baseline already in the repo to beat (`overlapScore` in
`lib/tool-fit.ts`), is not blocked on AWS, and addresses a measured pathology — 19
near-duplicate proposal pairs found, 23 proposals ignored past 7 days while Scout keeps
filing.

1. Extract every CGP issue + PR to `data/corpus.jsonl` (~124 documents).
2. Hand-label ~150 pairs (duplicate / related / unrelated), stratified by lexical overlap
   so it isn't all easy negatives. **This gold set is the artifact that makes it ML.**
3. Score the lexical baseline (BM25 + existing `overlapScore`) **before** touching
   embeddings — you must know what you're beating.
4. Dense embeddings via `@huggingface/transformers` + `all-MiniLM-L6-v2` (~23 MB, 384 dims,
   runs in Node, no API key, no AWS).
5. Precision-recall curve for both; pick a threshold favouring precision (a false
   "duplicate" that suppresses a good proposal is worse than a miss). Write
   `metrics/dedup-eval.json`.
6. Ship: Scout checks the index before filing; queue UI shows "similar to #114 (0.87)".
7. Later: flip the encoder to Bedrock Titan v2, rerun the *same* eval, get a
   backend-comparison table free. Mirror the `EMBEDDING_BACKEND` switch on the existing
   `cli | api | bedrock` pattern in `lib/map-ai.ts`.

**Gotcha:** `onnxruntime-node` is unreliable on musl. The Dockerfile is `node:22-alpine`;
expect to move to `node:22-slim`.

### Do now, cheaply, because it unblocks later work

- Wire the unused `declined` / `redraft` labels to a one-line reason capture. Six weeks of
  that turns the acceptance model from impossible into the best idea on the list.
- Start recording per-run tokens, cost, model, and duration. A few lines; currently captured
  nowhere; in six months it is the dataset for routing Scout between Haiku and Sonnet.
- Persist Actions run outcomes to `metrics/loop-runs.jsonl` (2,147 runs are live-queryable
  but never stored), joining runs to the artifacts they produced, so "productive vs no-op"
  becomes a real label and the headline metric becomes honest.

### Other ranked ideas

- **Dense retrieval to replace tool-fit's keyword prerank** — shares all infrastructure with
  the dedup work; measure recall@10 against `overlapScore`. Build second.
- **Calibration/eval harness for the Auditor's `SHIP | FIX FIRST | DO NOT MERGE` verdicts** —
  confusion matrix, reliability diagram, Brier score. n≈46, so report bootstrap CIs and
  expect them wide. No model trained; evals engineering is in demand.
- **Proposal acceptance model** — highest ceiling, blocked on the label capture above.
- **PR merge-risk scoring** — don't build. n=46 after dropping leaky human PRs, features are
  near-noise, and the one strong feature is the Auditor's own LLM verdict.

### Do not

Fine-tune anything (off by three orders of magnitude); RL/bandits over agent policy;
forecasting `loop-metrics.json` (51 cumulative, non-stationary points); a "which repo should
the loop work on" model (n=1 active repo); SageMaker or any training cluster at this data
scale — it is an active negative signal, not a credential.

---

## 4. Unblock the CGP loop — independent of everything above

CGP's loop is live and running against a **completely empty** `docs/loop-brief.md`
(untouched template, last modified 2026-07-27). Needs: the owner's yes/no on the five
drafted goals in `docs/drafts/cgp-loop-brief-draft-2026-08-18.md`, landing it as CGP's
`docs/loop-brief.md`, and adding a `scout` block to its `.github/loop-config.json`.
Then triage 13 open PRs / 42 open issues — the Scout stands down every run until that
queue moves (last merge 2026-07-28).

---

## Open questions

- Has `CRON_SECRET` been set in Vercel? The cron fails closed without it, by design.
- Was the CGP `@mention` security hole ever exploited? Offered 2026-08-19, never checked.
- The dashboard UI still has not been opened and looked at since the power-menu changes.

## Known gaps deliberately left alone

- Three pre-existing lint errors: `components/help-chat.tsx:55`,
  `components/tools/catalog-browser.tsx:231`, `components/map/power-menu.tsx:221`.
  They predate the AWS work and do not block the build.
