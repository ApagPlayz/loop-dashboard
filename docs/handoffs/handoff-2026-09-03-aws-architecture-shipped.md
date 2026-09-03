# Handoff — AWS architecture shipped, repo public (2026-09-03)

## TL;DR

The AWS work is **done, live, and verified by running it** — not asserted. The dashboard
runs on ECS Fargate at https://d1ougmzejkasx3.cloudfront.net, publicly viewable with no
login and every mutation blocked. A Lambda dedup endpoint, S3 artifact store, Bedrock
(Titan **and** Claude), OIDC CI/CD, and least-privilege IAM are all working. The repo is
**public**: https://github.com/ApagPlayz/loop-dashboard. `main` is clean and pushed;
147 tests, `tsc` and `npm run build` all pass.

**Next action:** nothing is blocked. The remaining work is (a) the UI redesign, which was
attempted and rejected — read "Dead ends" before touching it, and (b) two credential-hygiene
items only the owner can do.

**Waiting on the owner:** swap the `gho_` GitHub token for a scoped fine-grained PAT; move
his personal AWS access off the root identity.

---

## Goal

Loop Dashboard must be two things at once (see the memory file `OVERARCHING-GOAL.md`):
a tool the owner personally uses to run autonomous Claude agents against his own repos,
**and** a resume project filling real gaps — cloud/AWS, LLM systems, DevOps, TypeScript.
This session's arc was: make AWS genuinely part of the product, then make the repo and a
live demo presentable to recruiters. Both are done.

---

## State

`main` is clean and in sync with `origin/main`. Nothing uncommitted, nothing unpushed.

Working, and each one exercised directly this session:

- **ECS Fargate + ECR + CloudFront** — the app, live, HTTPS, arm64/Graviton, ~$11.50/mo
  (94% of that is the always-on task plus its public IPv4; everything else is cents).
- **Public read-only demo** — anonymous `GET /` returns 200; every mutation, LLM route and
  launcher route returns an identical 403 so probing reveals nothing.
- **Lambda** `loop-dashboard-dedup-infer` — embeds a proposal with Titan, cosine-scores it
  against the S3 index. 146–275 ms warm.
- **S3** `loop-dashboard-ml-777164055831` — 7 objects, versioned, SHA-256 content-addressed,
  public access blocked.
- **Bedrock** — Titan V2 embeddings and Claude (Sonnet 4.5 / Haiku 4.5 / Opus 4.5).
- **CI/CD** — push to main → ECR → Fargate → CloudFront origin refresh → health check.
- **147 tests**, `tsc` clean, `npm run build` clean.

Broken or unfinished: **the UI**. It is exactly as it was at the start of the session —
zero files under `app/` or `components/` were changed for design reasons. The owner
considers it "very AI"-looking and wants a simpler, centered launcher. Not started.

`docs/ARCHITECTURE.md` is new and is the single best thing to read before touching
anything — it documents all 9 agents, every screen, the data model, the AI layer, the AWS
architecture, and five design decisions that are **intentional** and must not be "fixed".

---

## Verified vs assumed

**Verified by running the command and reading the output in this session:**

- Claude on Bedrock — `invoke-model` returned real completions from Haiku 4.5 and
  Sonnet 4.5. Re-verified twice, because an agent claimed it did not work.
- Lambda dedup — invoked with novel text absent from the corpus; it returned #68 (0.858)
  and #117 (0.856) above the 0.842 threshold. Real inference, not a fixture.
- S3 — `aws s3 ls`, versioning `Enabled`, all four public-access blocks `true`.
- The live site — `/api/health` 200; anonymous `/` 200 with no redirect; three
  representative mutating routes 403; CSP, HSTS, `nosniff`, `X-Frame-Options` present.
- CI/CD — two consecutive `success` runs in `gh run list`, site healthy afterwards.
- The auth bypass fix — reproduced the bug with `curl` before, confirmed 401 after.
- Repo is public — `curl` to the GitHub URL returns 200 unauthenticated.

**Assumed, NOT verified:**

- **Most of the UI has never been looked at.** One screenshot of the Overview page was
  taken; the other 8 tabs were never opened. Any claim about how they look or behave is
  unverified.
- **The demo snapshot's content was never eyeballed.** It renders and it is labelled, but
  nobody has read what a visitor actually sees. Worth ten minutes before sharing widely.
- **The Lambda is not wired into the product.** It is a live endpoint that nothing calls.
  The Scout still files duplicates; closing that loop is real remaining work.
- **Cost is projected, not observed.** ~$11.50/mo is arithmetic on the pricing sheet. The
  first real bill has not arrived. The budget alarm is set to $25.
- **The reporter cron fix is unverified in production.** It was proven on an isolated
  clone; whether `CRON_SECRET` is set on the live deployment was never checked.

---

## Dead ends — read this before redoing any of it

**The UI mockups (9 files under `docs/mockups/`) were rejected.** Three directions —
Instrument, Editorial, Blueprint — all built with real data. The owner's verdict was
"genuinely terrible". The specific, reproducible failures:

- Each mockup rendered the full 9-item sidebar but only 3 screens existed, so 6 of 9 links
  were dead and he could not click through to judge anything.
- Text overflowed its container in Blueprint's "YOU DECIDE" block.
- The sidebar KPI said 23 and the panel below said 34 — same metric, two numbers.
- Raw jargon on screen (`cos 0.82`) that meant nothing to him.
- A model-evaluation panel was added to pages he never asked for it on.

Root cause, and the important lesson: **the design brief came from a stale handoff, not
from the owner.** He wants a simple, centered launcher — "welcome back, which project
today", a project selector, big obvious buttons through to the process map / ideas / pull
requests. What was built was a dense telemetry console. Do not restart design work without
first agreeing, in plain English, what each page is *for*.

**Do not "fix" these five things — they are deliberate product design** (also in
ARCHITECTURE.md §8): per-repo rather than global tool install; project chat scoped only to
workflow YAML; the folder picker limited to one configured directory; substring (not
semantic) catalog search; agent capabilities derived from YAML rather than stored.

**Fargate Spot was rejected** for the hosting — it saves ~$5/mo but AWS can reclaim the
task on 2 minutes' notice, and a resume link that intermittently dies is worse than $5.

**`--platform linux/amd64` does not work on this machine**, despite the previous handoff
listing it as a hard requirement. Next.js 16 + Turbopack segfaults under QEMU on Apple
Silicon. The image is built native arm64 and runs on Graviton instead.

**The shadcn/ui MCP server was researched and rejected** — its 7 tools are wrappers around
`npx shadcn@latest search/view/add`, costing ~2k tokens of context every turn for
capabilities Bash already provides. Revisit only if a second/private registry appears.

---

## Running & resumable

Two processes survive this session and are **not** needed:

- `next dev --port 3001`, PID **85203** — the local dashboard.
- `python3 -m http.server 4599`, PID **95129** — was serving the rejected mockups.

Kill both with `kill 85203 95129`. Nothing depends on them.

Live AWS resources that keep costing money: the Fargate service (`loop-dashboard` cluster,
`desiredCount: 1`), the CloudFront distribution, the Lambda, the S3 bucket. Budget alarm
is at $25/mo with alerts at 50/90/100%.

**The task's public IP changes on every deploy** and CloudFront must be re-pointed —
`infra/refresh-cloudfront-origin.sh` does this and the pipeline calls it automatically. If
the URL ever 502s, run that script first.

---

## Next steps

1. **Look at the live demo as a stranger would** — open
   https://d1ougmzejkasx3.cloudfront.net in a private window and read what a recruiter
   sees. The demo data is a deliberately invented project ("Aurora Notes") with a banner
   saying so; nobody has checked that it reads well. Ten minutes, and it is the thing
   currently linked from a resume.
2. **Confirm `CRON_SECRET` on the deployment.** The reporter cron fix is committed but the
   live env var was never checked, so the 6-hourly refresh may still not run.
3. **Wire the Lambda into the Scout's path** so a duplicate proposal is caught before it is
   filed. This is the piece that turns the ML from a demo into a feature.
4. **UI redesign** — only after agreeing page-by-page purpose with the owner in plain
   English. See "Dead ends".

---

## Key context

- **Read `docs/ARCHITECTURE.md` first.** It is new, verified against the code, and exists
  precisely so a cold session does not re-derive the project badly.
- Verify commands: `npm test` (147), `npx tsc --noEmit`, `npm run build`.
- `scripts/shot.sh <url> <out.png>` screenshots a page via headless Chrome. It exists
  because **Playwright's MCP screenshots report success and then vanish** — which is how a
  batch of mockups shipped with overflowing text and dead links while being described as
  "verified". Do not trust a screenshot tool whose output you have not read back.
- **Claude on Bedrock requires inference-profile IDs** — the `us.` prefix. A bare
  `anthropic.claude-sonnet-4-5-...` returns a `ValidationException` that never mentions
  entitlement, and the `bedrock-mantle` endpoint 404s for granted models regardless. Three
  different errors all read as "no access"; two mean "wrong request shape". This cost an
  agent a wrong conclusion in a document.
- `DASHBOARD_AI_BACKEND` is deliberately **unset** so local runs use the owner's Claude
  subscription via the CLI and cost nothing. Setting it to `bedrock` starts billing.
- Target repos `content-generation-platform` and `supply-chain-optimizer` are **already
  public** — an earlier agent assumed otherwise and built an invented demo dataset to
  avoid leaking them. That caution was unnecessary, though the invented data is harmless.
- The resume deliverables are `docs/resume-bullets.{md,html}` and
  `~/Desktop/Loop-Dashboard-Resume-Bullets.pdf`.

---

## Open questions

1. **Project name** — keep "Loop Dashboard", or rename to **Flywheel**? He liked
   *"Flywheel — Autonomous Multi-Agent Code Improvement Loop"*. Renaming the repo is cheap
   now (GitHub redirects the old URL) and awkward later.
2. **Rotate the `gho_` token?** It is account-wide, was never committed, and lives only in
   `.env.local`. Replacing it with a scoped PAT also restores live GitHub data in the cloud.
3. **Move personal AWS access off root?** The CI path is clean via OIDC; only his own login
   uses root.
4. **UI redesign — start now or later?** It needs him to define each page's purpose first.
