# Resume bullets — Loop Dashboard

Single-line, tool-dense, number-anchored. Every figure below is measured, not estimated.
See "Do not claim yet" at the bottom. Written 2026-09-02.

---

## PROJECTS entry

**Loop Dashboard** | *LangGraph, AWS Bedrock, TypeScript, Next.js, Docker, Vitest*

- Built a human-in-the-loop LangGraph agent that triages a 42-issue backlog, halting at a checkpointed interrupt for approval before any write.
- Benchmarked Amazon Titan Text Embeddings V2 on AWS Bedrock against a local MiniLM encoder across 132 documents, reaching 0.93 average precision.
- Implemented Okapi BM25 from scratch as a lexical baseline, scoring 150 labeled pairs with 1000-replicate bootstrap confidence intervals.
- Cut embedding cost to zero by proving a 384-dim local model matched a 1024-dim Bedrock model within overlapping confidence intervals.
- Integrated three LLM backends (CLI, Anthropic API, AWS Bedrock) using forced tool use to guarantee schema-valid JSON across 12 call sites.
- Identified an author leak inflating a merge classifier to a false 0.95 AUC, invalidating the model before it shipped.
- Established the first automated test suite using Vitest, covering HMAC-SHA256 session cryptography and LLM parsing across 88 tests.
- Containerized a Next.js 16 control plane with multi-stage Docker at 301 MB, patching 9 security advisories including 4 high severity.

---

## Trimmed to 4 bullets (if space is tight)

**Loop Dashboard** | *LangGraph, AWS Bedrock, TypeScript, Next.js, Docker*

- Built a human-in-the-loop LangGraph agent that triages a 42-issue backlog, halting at a checkpointed interrupt for approval before any write.
- Benchmarked Amazon Titan Text Embeddings V2 on AWS Bedrock against a local MiniLM encoder across 132 documents, reaching 0.93 average precision.
- Implemented Okapi BM25 from scratch, scoring 150 labeled pairs with 1000-replicate bootstrap confidence intervals to select the cheaper encoder.
- Established the first test suite using Vitest across 88 tests and containerized the app with Docker, patching 9 security advisories.

---

## TECHNICAL SKILLS additions

**Programming Languages**: add TypeScript, JavaScript
**Frameworks**: add Next.js, React
**Libraries**: add LangGraph, LangChain, Transformers.js, Vitest
**Tools**: add AWS, Bedrock, Docker, GitHub Actions, Node
**Concepts**: add LLM Integration, Agent Orchestration, Model Evaluation, Semantic Search, CI/CD

---

## Where every number comes from

| Figure | Source |
|---|---|
| 42-issue backlog | open issues in the target repo at triage time |
| 132 documents | `data/corpus.jsonl` |
| 0.93 average precision | `metrics/dedup-eval.json`, Titan 0.934 / MiniLM 0.937 |
| 150 labeled pairs | `data/gold-pairs-llm.jsonl` |
| 1000-replicate bootstrap | `scripts/ml/evaluate.mjs` |
| 384-dim vs 1024-dim | MiniLM-L6-v2 vs `amazon.titan-embed-text-v2:0` |
| 12 call sites | every AI call funnels through `lib/map-ai.ts` |
| 0.95 false AUC | author leak: 24/24 human PRs merged, 26/26 rejections bot-authored |
| 88 tests | `npm test` |
| 301 MB | built Docker image |
| 9 advisories, 4 high | Next.js 16.2.10 to 16.3.4 |

---

## Do not claim yet

- **"Hand-labelled gold set."** The 150 labels are LLM-assigned. Only 10 human labels exist and
  all are one class, so no inter-annotator agreement is computable. Label ~25 pairs across all
  three classes, compute Cohen's kappa, then it is claimable.
- **"Semantic embeddings outperform lexical baselines."** True in the numbers, but the labeller
  judged semantics and dense encoders model semantics, so the comparison is confounded. The
  Titan-vs-MiniLM comparison is unaffected, since the bias applies equally to both.
- **"Deployed on AWS."** Bedrock has been invoked; nothing is hosted on AWS.
- **"55/60 successful agent runs."** Misleading — most "successes" are agents standing down.
- Prompt caching, token/cost accounting, and IaC are not implemented.
