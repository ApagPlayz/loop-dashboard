# Handoff — UI defect sweep and the real-data demo (2026-09-05)

## TL;DR

Everything is pushed, deployed and green: `main` clean and in sync, **212 tests**, `tsc`
and build clean, last deploy succeeded. The public demo at
https://d1ougmzejkasx3.cloudfront.net now serves a frozen snapshot of the owner's **real**
loop instead of invented data, and a full behavioural pass over the UI found and fixed
~15 defects — including one that had silently broken the project switcher for the whole
app's life.

**Next action:** nothing is blocked. The best remaining work is token/cost accounting +
prompt caching (see Next steps).

**Waiting on the owner:** rotate the `gho_` GitHub token; run `aws login` (expired again).

---

## Goal

Loop Dashboard is both a tool the owner personally uses to run autonomous Claude agents
against his own repos **and** a resume project filling real gaps — see the memory files
`OVERARCHING-GOAL.md` and `resume-project-claims.md`. This session's arc: stop trusting
screenshots, actually *interact* with every feature, fix what that turned up, and make the
public demo something a recruiter can be sent to.

---

## State

`main` is clean and in sync with `origin/main`. Nothing uncommitted.

Working and verified by exercising it: the whole AWS architecture (ECS Fargate, Lambda
dedup inference, S3, Bedrock Titan **and** Claude, OIDC CI/CD, least-privilege IAM), the
LangGraph triage panel, the duplicate check, and the public read-only demo.

`docs/ARCHITECTURE.md` remains the single best thing to read before touching anything.

---

## Verified vs assumed

**Verified this session by running it and reading the output:**

- The project-switcher fix — `curl` with each project cookie now returns a different
  project on `/`, `/metrics` and `/tools`. Previously byte-identical.
- The real-data demo is live: anonymous fetch of the CloudFront root shows
  "Content Generation Platform", zero "Aurora Notes", and anonymous POSTs to
  `/api/loop-config` and `/api/triage` still 403.
- Modal scrolling, the map's zoom controls, template agents opening with real YAML, and
  Escape closing both the editor and the add-project wizard — all driven in a real browser.
- Deploy pipeline green; `/api/health` 200 after each.
- No credentials and only the two approved public repos appear anywhere in `lib/demo/`.

**Assumed / NOT verified — treat with suspicion:**

- **The Lambda dedup path has not been exercised end to end since the AWS session
  expired.** The code path was proven earlier (app → SigV4 → Function URL → Bedrock →
  ranked matches), but the out-of-domain UI copy added this session was verified against
  a **stubbed** response only. Re-test after `aws login`.
- **The dedup "short query" diagnosis was measured on MiniLM, not Titan.** The mechanism
  is sound and Titan shows the same monotone length trend, but there is no Titan
  measurement of a short query. Do not treat the 950-char calibration floor as precise.
- **~61 catalog entries are still in the wrong category** from the original bare-`search`
  bug. Only the reviewed entries were hand-patched. A real
  `node scripts/build-catalog.mjs` would flush them — nobody has run it, and it must be
  checked that the 26 hand-reviewed entries survive.
- **The demo's relative timestamps keep ageing** ("3h ago") because the snapshot is
  frozen. The banner carries the capture date. Inherent, not a bug, but it will look
  stale in a month.
- The two write-path features nobody has run: the triage panel's **apply** (write box
  ticked) and the agent drawer's **Save**. Both were deliberately never clicked.

---

## Dead ends — do not repeat these

**Do not lower the dedup threshold.** A tester reported it as too strict because a
paraphrase of #115 scored 0.714 against a 0.842 threshold. The investigation proved the
opposite: **zero of 40 corpus documents match themselves above threshold when represented
by title alone** (median self-similarity 0.63). The problem is that index vectors are
built from full bodies (shortest text in any gold positive pair: 950 chars) while the
query was 52 chars — the two are not comparable. Lowering to 0.714 would take precision
from 0.909 to 0.639 and false positives from 2 to 13. Also tested and **rejected on
evidence**: applying the index's title-doubling to the query scored *worse* (0.594 vs
0.621). The fix shipped was honesty about the out-of-domain case, not recalibration.

**Do not "fix" the catalog's bare-`design` regex** without thinking. It matches the verb
("schema design", "design a solution") and affects ~27 entries, but a phrase whitelist
drops genuine cases like "Canvas Design". Trading a false-positive class for a
false-negative one is not obviously an improvement.

**Screenshots are not verification.** Earlier in this arc, mockups were reported as
"rendered and verified at 1440px" when nothing had been looked at — the Playwright MCP
screenshots report success and then vanish. `scripts/shot.sh` (headless Chrome to a path
we control) exists because of that. For anything behind auth, Playwright is installed in
the scratchpad (see below) — `shot.sh` cannot carry a session cookie.

**The five design decisions in `docs/ARCHITECTURE.md` §8 are intentional.** Per-repo (not
global) tool install, workflow-YAML-scoped project chat, the single-directory folder
picker, substring catalog search, and YAML-derived agent capabilities. Every session so
far has tried to "fix" at least one.

---

## Running & resumable

- `next dev --port 3001`, **PID 10811** — kill with `kill 10811`. Nothing depends on it.
- Playwright 1.62.1 + a `state.json` session cookie live in
  `/private/tmp/claude-501/-Users-alessiopagliarulo-Documents-Claude-Projects-Loop-Dashboard/277df58d-fba1-4580-8b3c-56066a1b2809/scratchpad/ui`.
  Run scripts *from that directory* so `import { chromium } from "playwright"` resolves.
  Refresh the cookie by POSTing `{"password": <DASHBOARD_PASSWORD from .env.local>}` to
  `/api/login`. **This is a scratchpad and will not survive; recreate with `npm i
  playwright@1.62.1` if gone.**
- **AWS session is EXPIRED** — `aws login` needs the owner's browser.
- Live AWS costs ~$11.50/mo (94% of it the always-on Fargate task + its public IPv4).
  Budget alarm at $25.
- The Fargate task's public IP changes on every deploy; `infra/refresh-cloudfront-origin.sh`
  re-points CloudFront and the pipeline calls it. **If the URL 502s, run that first.**

---

## Next steps

1. **Token/cost accounting + prompt caching.** All ~27 LLM call sites funnel through
   `lib/map-ai.ts`, which **discards `usage` entirely** (`grep -n "usage" lib/map-ai.ts`
   returns nothing) and sets no `cache_control` anywhere. Single-point fix, real
   LLM-systems work, and it is the clearest remaining resume gap. Read the CLI's real
   output keys with `--output-format json` rather than guessing them.
2. **Run `node scripts/build-catalog.mjs`** to flush the ~61 stale categories, verifying
   the 26 reviewed entries survive.
3. **Fill `docs/loop-brief.md`** — empty for 5+ weeks, so the Scout is guessing what
   matters. `docs/drafts/cgp-loop-brief-draft-2026-08-18.md` has 5 drafted goals awaiting
   approval. This directly improves proposal quality.
4. Re-test the Lambda dedup path end to end once AWS is back.

---

## Key context

- Verify: `npm test` (212), `npx tsc --noEmit`, `npm run build`.
- `scripts/shot.sh <url> <out.png>` for unauthenticated pages; Playwright for authed ones.
- **Claude on Bedrock needs inference-profile IDs** (`us.` prefix). A bare
  `anthropic.claude-sonnet-4-5-...` returns a `ValidationException` that never mentions
  entitlement, and the `bedrock-mantle` endpoint 404s for granted models regardless.
  Three different errors all read as "no access"; two mean "wrong request shape". This
  already caused one agent to write a false claim into a doc.
- **`DASHBOARD_AI_BACKEND` is deliberately unset** so local runs use the owner's Claude
  subscription and cost nothing. Setting it to `bedrock` starts billing.
- The loop's agents authenticate with `CLAUDE_CODE_OAUTH_TOKEN`, so the 9 agents running
  in GitHub Actions bill the subscription, not per-token API charges.
- Bot-PR approval policy on both target repos was relaxed to
  `first_time_contributors_new_to_github` this session, so Demo runs no longer park at
  `action_required`. An `action_required` run is **not** a failure.
- The demo is a *frozen snapshot* by necessity: the deployment holds **no
  `GITHUB_TOKEN`** (the owner's is over-scoped and must never reach the cloud), so it
  cannot fetch live data. Do not try to make it.

---

## Open questions

1. **Rotate the `gho_` GitHub token?** Account-wide, leaked into a local log 2026-08-31,
   still live. A scoped fine-grained PAT would also let the cloud show live GitHub data.
2. **Run the catalog rebuild?** ~61 entries are visibly miscategorised until someone does.
3. **Project name** — keep "Loop Dashboard" or rename to **Flywheel**? Repo rename is
   cheap now, awkward later.
4. **Prove the triage write path?** Nobody has ever run it with the write box ticked.
