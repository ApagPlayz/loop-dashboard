# Running the pipelines locally

> The README covers `npm install` / `npm run dev` / `npm test`. This is the rest:
> the ML pipeline, the LangGraph triage CLI, and the container build.

## The ML pipeline

Only the first step and the optional Bedrock variant need credentials; everything else runs offline.

```bash
node scripts/ml/extract-corpus.mjs                        # needs an authenticated gh CLI
node scripts/ml/build-index.mjs                           # MiniLM, local, no AWS — downloads the model once
EMBEDDING_BACKEND=bedrock node scripts/ml/build-index.mjs  # Titan V2 — needs AWS creds + Bedrock model access
node scripts/ml/generate-pairs.mjs                        # stratified sample of pairs to label
node scripts/ml/label.mjs                                 # interactive, resumable, one keypress per pair
node scripts/ml/evaluate.mjs                              # -> metrics/dedup-eval.json
node scripts/ml/compare-encoders.mjs                      # readable comparison table
```

With no labelled file, `evaluate.mjs` fabricates labels from a seeded RNG, prints a banner, and stamps `"labels": "synthetic-smoke-test"` into the output — so every code path is proven to run before anyone spends an hour labelling. The correct outcome there is chance.

## The LangGraph triage agent

```bash
node scripts/triage-cli.mjs --repo=owner/name --limit=8   # dry run by default; --apply to write
node scripts/triage-interrupt-proof.mjs --limit=8         # prints getState() and the raw __interrupt__
```

## Container

```bash
docker build -t loop-dashboard .
docker run -p 3000:3000 -e DASHBOARD_PASSWORD=... -e SESSION_SECRET=... loop-dashboard
```

Multi-stage `deps → builder → runner` on `node:22-alpine`, shipping only the pruned `.next/standalone` output and running as a non-root user. No secrets at build time; everything is read from `process.env` at request time.
