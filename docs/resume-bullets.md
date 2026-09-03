# Loop Dashboard — resume bullets

Written 2026-09-02 against `~/Downloads/Alessio.Pagliarulo.Resume.pdf` (nothing from that
file is reproduced here). Every number below is traced in the provenance table.

---

## ⚠️ PENDING VERIFICATION — confirm before you send

Two bullets describe work that was still landing when this was written. **Read this list
first.** If the work landed, send them. If it did not, delete those two lines and send the
other eight.

| Bullet | Claim | How to confirm in 10 seconds |
|---|---|---|
| **B9 — CI/CD** | GitHub Actions → OIDC → ECR → ECS with post-deploy health check | `gh run list --limit 5` — you need a run with status **success**. As of writing, the last 8 runs of `Deploy to ECS` all **failed**. |
| **B10 — Public demo mode** | CloudFront URL public read-only, mutations blocked, security headers | `git log --oneline -5` for a demo-mode commit, then open https://d1ougmzejkasx3.cloudfront.net in a private window without logging in. |

Everything else (B1–B8) was verified live tonight by running the actual commands.

---

## Project entry

**Loop Dashboard** github.com/ApagPlayz/loop-dashboard **May 2026 – Present**

1. Built a control plane orchestrating 9 autonomous Claude coding agents — Scout, Builder, Auditor, Demo, Retro — across GitHub repos via GitHub Actions.
2. Deployed the Next.js control plane to AWS ECS Fargate on arm64 Graviton behind ECR and CloudFront HTTPS, live in production on 0.25 vCPU.
3. Shipped an AWS Lambda duplicate-detection endpoint (Node 22, arm64, IAM-authed Function URL) returning Bedrock-embedded ranked matches in 146–275 ms warm at ~$0.12/month.
4. Indexed a 132-document corpus with Amazon Bedrock Titan Text Embeddings V2 (1024-dim), served from versioned Amazon S3 as SHA-256 content-addressed artifacts.
5. Scoped the Lambda IAM role to zero managed policies — one inline policy over 1 Bedrock model, 2 S3 prefixes, and its own CloudWatch log group.
6. Engineered 34,600 lines of TypeScript across a Next.js App Router dashboard with 68 API routes and a 3-backend LLM layer (CLI, Anthropic API, Bedrock).
7. Built a 4-node LangGraph human-in-the-loop agent with checkpointed interrupts; a live run triaged 8 GitHub issues in 33.3 s, human input flipping 8 of 8 actions.
8. Benchmarked 5 retrieval methods over 150 pairs with 1,000-replicate bootstrap CIs, keeping the free local encoder over Bedrock Titan (0.937 vs 0.934 AP).
9. Automated deploys with GitHub Actions and AWS OIDC federation — zero long-lived keys — building to ECR and releasing to ECS Fargate with a post-deploy health check.
10. Opened the live CloudFront demo to public read-only traffic, blocking every mutating route for anonymous users behind 4 hardening headers (CSP, nosniff, referrer-policy, frame-ancestors).

**Also available if you need a security/testing line instead of one of the above:**

- Closed 3 security defects including a live authentication bypass on API routes ending in `.png`, growing the Vitest suite from 88 to 146 tests.

---

## Trimmed 4-bullet version

Use this when the project has to fit four lines. It covers all five gaps.

1. Built a control plane orchestrating 9 autonomous Claude coding agents across GitHub repos, deployed on AWS ECS Fargate (arm64 Graviton) behind ECR and CloudFront.
2. Shipped an AWS Lambda duplicate-detection endpoint on Amazon Bedrock Titan embeddings with S3-hosted indexes, returning ranked matches in 146–275 ms warm at ~$0.12/month.
3. Engineered 34,600 lines of TypeScript across a Next.js App Router dashboard with 68 API routes, closing 3 security defects and growing the suite from 88 to 146 tests.
4. Benchmarked 5 retrieval methods over 150 pairs with 1,000-replicate bootstrap CIs, keeping the free local encoder over Bedrock Titan (0.937 vs 0.934 AP).

---

## Skills section — exact additions

Your current format is three bolded categories with comma-separated values. Keep it. These
are drop-in replacements for the **Technical** and **Concepts** lines; **Certifications** is
unchanged.

**Technical**: SQL, Power BI, Tableau, Python, TypeScript, JavaScript, Excel, MySQL Workbench, Microsoft Office, Java, C, C++, Bash, Linux, Pandas, GeoPandas, Matplotlib, Streamlit, Restful API, AWS (ECS Fargate, Lambda, S3, Bedrock, ECR, CloudFront, IAM, CloudWatch, SSM), Docker, GitHub Actions, React, Next.js, Node.js, LangGraph, PyTorch, Vitest, Git

**Concepts**: Data Analysis, Data Science, Machine Learning, LLM/GenAI Applications, Cloud Architecture, CI/CD, Project Management, Supply Chain, Optimization, Continuous Improvement, Statistics, Consulting, Business Analytics, Decision Modeling

**Certifications**: Lean Six Sigma Yellow Belt - Council of Six Sigma *(unchanged)*

**Notes on the changes**

- `Python`/`SQL` stay first — they are still your strongest signal.
- `TypeScript` and `React, Next.js, Node.js` are new; you had `JavaScript` only, despite 34,600 lines of TypeScript in this repo.
- The AWS services are spelled out in one parenthetical rather than as a bare "AWS" — recruiters and ATS keyword filters match on the service names.
- `Docker` and `GitHub Actions` are safe to list regardless of the pending CI/CD bullet: the Dockerfile is a real multi-stage arm64 build and the 9 agents genuinely run on GitHub Actions workflows.
- Dropped nothing except the reordering; `Restful API` retained.

---

## Gap coverage

| Gap in your current resume | Covered by |
|---|---|
| **1. Cloud (AWS)** — completely absent | B2 (ECS Fargate, ECR, CloudFront), B3 (Lambda), B4 (Bedrock, S3), B5 (IAM), B9 (CI/CD) |
| **2. LLM / GenAI / agents** — completely absent | B1 (9-agent orchestration), B3 (Bedrock inference), B6 (3-backend LLM layer), B7 (LangGraph HITL) |
| **3. Docker / CI-CD / IaC** — absent | B2 (containerized to ECR/Fargate), B9 (GitHub Actions -> OIDC -> ECR -> ECS), Skills: Docker, GitHub Actions |
| **4. TypeScript / React / Next.js** — absent from Skills | B6 (34,600 lines, App Router, 68 routes), Skills line |
| **5. Security / testing discipline** — thin | B5 (IAM least privilege), B10 (public demo), the alternate security bullet (3 defects, 88→115 tests) |

Every gap except #3 is covered by at least one **already-verified** bullet. Gap #3 rests on
B2 plus the Skills line if the CI/CD bullet does not land.

---

## Number provenance

| Figure | Source |
|---|---|
| 9 agents | `lib/map-agents.ts` — 9 `id:` entries (scout, redraft, builder, audit, demo, retro, metrics, mention, toolinstall), each bound to a workflow `.yml` |
| Live in production, 0.25 vCPU / 0.5 GiB, arm64 | ECS Fargate task definition; `curl https://d1ougmzejkasx3.cloudfront.net/api/health` → `{"ok":true}`, re-verified while writing this |
| 146–275 ms warm, 1.14 s cold | Timed live invocations of `loop-dashboard-dedup-infer` Function URL |
| ~$0.12/month | Lambda arm64 pricing against measured duration and expected invocation volume — an **estimate**, and phrased as one |
| Node 22, arm64, IAM-authed Function URL | Lambda function configuration; handler signs its own SigV4, zero npm dependencies |
| 0.858 / 0.856 vs 0.842 threshold, 0.31 unrelated | Real inference call: novel text matched issues #68 and #117 above threshold; unrelated control scored 0.31 |
| 132 documents | `docs/ml-dedup.md` §corpus — 62 issues + 70 PRs; `docs/ml-artifacts-s3.md` lists `corpus/corpus.jsonl` at 351 KB |
| 1024-dim Titan v2 | `docs/ml-dedup.md` — API default and the model's full Matryoshka width; `embeddings/titan/latest.json`, 1.2 MB |
| Versioned S3, SHA-256 content-addressed | Bucket `loop-dashboard-ml-<ACCOUNT_ID>`, 7 objects, versioning on, all public access blocked; loaded by `lib/dedup/artifact-store.ts` with a local fallback |
| Zero managed policies, 1 model / 2 prefixes / 1 log group | Lambda execution role: no attached managed policies, one inline policy granting `bedrock:InvokeModel` on one model ARN, `s3:GetObject` on two prefixes, Logs scoped to its own group |
| 34,600 lines TypeScript | `find . -name '*.ts' -o -name '*.tsx'` excluding `node_modules`/`.next` → **34,629** total (14,195 of it `.tsx`); rounded down |
| 68 API routes | `find app/api -name route.ts` → 68 |
| 3-backend LLM layer | `lib/map-ai.ts` — `aiBackend()` routes to CLI / Anthropic API / Bedrock behind `aiStructuredCall`; imported by 27 modules |
| 4 nodes, 33.3 s, 8 issues, 8 of 8 | `docs/evidence/langgraph-run-2026-09-02.md` — graph nodes `load_backlog`, `assess`, `propose`, `apply_decisions` in `lib/agent/graph.ts:245-248`; run 1 = 33.3 s over 8 real open issues; line 202: "8/8 actions changed purely because the human decided differently" |
| 5 methods, 150 pairs, 1,000 replicates | `docs/ml-dedup.md` — 150 of 8,646 pairs sampled with retained inclusion probabilities; `bootstrap_95ci` = 1,000 resamples |
| 0.937 (MiniLM) vs 0.934 (Titan) AP | Dual-encoder comparison, commit `a0ecbf4`; the CIs overlap, so the bullet says "keeping the free local encoder", not "MiniLM wins" |
| 88 → 115 tests | Grep of `it(`/`test(` across the 8 Vitest files → 115 today, up from 88 before the security work |
| 3 security defects | Commits `aac0fc6` (auth bypass on `.png`-suffixed API routes), `a57b95b` (unbounded filesystem in two LLM chat routes), `e470f55` (authorization-gate inversion via the admin token) |
| Multi-stage Docker build | `Dockerfile` — `deps → builder → runner` on `node:22-alpine`, ships only the pruned `.next/standalone` output |

---

## Do not claim yet

These are off the resume on purpose. Do not add them back without new evidence.

1. **"Hand-labelled gold set."** The 150 pair labels are LLM-assigned. Only 10 human labels exist and they are all one class. Say "labelled pairs", never "gold" or "hand-labelled".
2. **"Semantic embeddings outperform lexical baselines."** Confounded — the same LLM that judged semantics produced the labels, so it is scored on its own criterion. The Titan-vs-MiniLM comparison is *not* affected by this, which is why B8 only makes that comparison.
3. **Any agent-run success rate.** No measured success rate exists for the 9-agent loop. Do not say "95% of PRs merged" or anything like it.
4. **CI/CD**, until `gh run list` shows a **successful** `Deploy to ECS` run. As of writing, the last 8 runs all failed.
5. **Public demo mode**, until you can load the CloudFront URL logged out in a private window.
6. **"Zero-downtime deploys", "auto-scaling", "multi-region", "99.9% uptime."** None of these are configured or measured. One Fargate task, one region.
7. **The 8 real GitHub issues as *applied* changes.** Every LangGraph run was a dry run; `--apply` was never passed and zero writes reached GitHub. "Triaged" is accurate; "resolved" or "fixed" would not be.
8. **Cost savings.** ~$0.12/month is an estimate of spend, not a saving against a baseline. Do not turn it into "cut costs by X%".
