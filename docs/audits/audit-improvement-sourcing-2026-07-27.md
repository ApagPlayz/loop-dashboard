# Audit — Improvement Sourcing & Suggestion Generation (2026-07-27)

Full parallel-agent audit (4 Opus reviewers) of how the loop's improvement ideas are
sourced and generated, and how that machinery is tailored to a *default* repo template
vs the *specific* active repo (`ApagPlayz/content-generation-platform`).

Scope covered:

1. **Scout/Retro/Audit/Redraft workflow templates** (`config/loop-template/workflows/`) — the prompts that generate ideas.
2. **Template instantiation & onboarding** (`lib/onboard.ts`, `lib/loop-template.ts`, `lib/loop-config.ts`) + live diff against both registered repos.
3. **Dashboard-side ideas pipeline** (`lib/queues.ts`, `app/api/ideas/*`, `components/queues/*`, reporter subsystem).
4. **Real-world output quality** — complete census of all 52 Scout-generated ideas, 65 PRs, retros, and metrics on the live content platform.

---

## Executive summary

**The surprise finding: the live suggestions are NOT generic.** A full read of all 52
Scout-generated ideas on the content platform rates ~96% as product-grounded (56%
creator-economy/product strategy, 29% product-behaviour bugs with `file:line` evidence)
and only ~2% purely generic ("add tests"). 87% cite a real file in `src/`. Tailoring of
*output* is working despite the machinery being one-size-fits-all — because the Scout
agent reads the target repo's code at runtime.

**The actual problems are structural, and they cluster in four places:**

1. **The feedback loop is broken and inverted.** A one-line counting bug in
   `scripts/loop-metrics.mjs` reports the approval rate as **0%** every day since 07-14;
   the real rate is **35% (18/52)**. `LOOP-DASHBOARD.md` — the file the Scout is
   explicitly told to learn from — contains no idea titles and one wrong number telling
   a healthy Scout it is failing completely. Retro learnings (11 entries) are all CI
   mechanics, zero about idea quality. Rejections don't exist as a signal: **not one
   idea has ever been closed as `not planned`**, and mass-closed PRs were rebuilt as
   near-equivalents within hours because "closed" can't mean "no".

2. **The loop is currently frozen.** The proposal queue has sat at exactly the
   `ideaQueueCap` (25) since 07-23; 20+ Scout runs since then have been no-ops. The gate
   measures shelf size, not triage throughput — exactly what retro #81 diagnosed and
   nothing implemented.

3. **"Default vs specific" tailoring doesn't exist as an architecture.** The template
   is a byte-for-byte copy of the pilot with **zero placeholders**; the only per-repo
   knobs are 4 runtime values in `.github/loop-config.json` (caps + autonomy). The
   pilot's tech stack — and even its literal page routes `/factories`, `/agents`,
   `/settings` — are baked into the "generic" template. There is no drift detection, no
   re-sync path, and no layering (base + per-repo overlay). The second project
   (`supply-chain-optimizer`) proves the failure: a Python+Vite repo running an
   unmodified Next.js/Prisma template, with a **fully dead loop** (Scout fails every run
   on a missing `CLAUDE_CODE_OAUTH_TOKEN` secret, open since 07-18) that *looks*
   half-alive because the Builder reports green no-op runs — plus 2 workflows stale
   behind the template (missing the duplicate-PR fix the pilot got 07-23).

4. **Real defects in the pipeline code**, headed by: `gh` list commands silently
   truncating at 30 (caps above 30 unenforceable → potential hourly Opus spam);
   a race in Scout's verify step producing false-red runs; the Retro's
   self-improvement path being dead on arrival (`GITHUB_TOKEN` cannot push to
   `.github/workflows/`); a cross-project UI leak that can approve the wrong issue in
   the wrong repo; label re-adds that silently fire no workflow ("Rebuild" is a no-op);
   and two prompt-injection holes (Redraft obeys any commenter; idea-chat interpolates
   untrusted issue content into a filesystem-capable local agent).

**Convergent recommendation.** All three code-focused agents independently arrived at
the same structural fix: extend the per-repo `.github/loop-config.json` (already read by
both the dashboard and every workflow via `jq … // default`) with a **scouting block** —
product summary, current goals, off-limits areas, researcher lenses, per-run batch cap —
and inject it into the Scout prompt. That single change converts sourcing from
one-size-fits-all to per-repo using plumbing that already exists end to end.

---

## Part 1 — How sourcing works today (mechanism)

- **Scout** (`claude-scout.yml`, hourly cron): a bash gate reads `ideaQueueCap` (default
  25) from `.github/loop-config.json`, counts open `proposal` issues, stands down if
  full. Otherwise boots an Opus agent (`--max-turns 50`) told to: read the codebase +
  `CLAUDE.md` + `LEARNINGS.md` + `LOOP-DASHBOARD.md` (best-effort), avoid duplicating
  injected lists of open proposals / open PRs / approved ideas, spawn **four fixed
  researcher lenses** (Competitors, Users, Codebase, Revenue), and file up to
  `room = cap − pool` issues via `gh issue create --label proposal`. A verify step
  re-counts proposals and fails the run if the count didn't rise.
- **Dashboard**: `loadIdeas()` buckets issues by label into Waiting / Approved /
  Redraft / Closed tabs; approve/reject/redraft actions swap labels (approve = `+approved
  −proposal`), which is what frees Scout cap room and (via `issues:labeled`) fires the
  Builder or Redraft workflows.
- **Structure**: prose-only. The `proposal` label is the only machine-readable output;
  effort (S/M/L), evidence, and lens live in free text. Dedup is 100% LLM judgment
  against three injected lists. Capping is a single global pool cap with **no per-run
  batch limit**.
- **Reporter/News subsystem plays no role in sourcing.** `lib/reporter*.ts` is a global
  Claude-ecosystem digest (11 fetchers), takes no project parameter, and no code path
  connects a digest item to an idea, a repo, or the Scout.
- **Tailoring today**: the only per-repo signals reaching Scout are the repo name, the
  cap number, and runtime state lists. No product summary, no goals, no off-limits
  areas, no configurable lenses. `CLAUDE.md` is never seeded at onboarding despite three
  agent prompts instructing agents to read it.

## Part 2 — Default vs specific: the tailoring architecture

- **No templating engine.** `listTemplateWorkflows()` returns raw bytes; onboarding
  writes them unchanged. Zero placeholders anywhere in the template files.
- **Per-project parameterization = 4 runtime values** (`version`,
  `autonomousBuildEnabled`, `prCap`, `ideaQueueCap`). Schedules, prompts, build
  commands: identical everywhere by construction.
- **Pilot stack baked into the "generic" template** (`repo-tests.yml`,
  `claude-demo.yml`): Prisma `DATABASE_URL`, root-level npm, unconditional
  `npm run lint/test/build` (no `--if-present`; the comment at `repo-tests.yml:5`
  claiming otherwise is false), port 3000, and the pilot's literal route list
  (`claude-demo.yml:170-171`).
- **Dual source of truth**: the template was seeded from the pilot, the pilot is also
  the onboarding *fallback* (`lib/onboard.ts:128`), and `.mcp.json` /
  `DASHBOARD-CONTRACT.md` / `loop-metrics.mjs` are copied live from the pilot at
  onboarding — pilot state can leak into new projects (the `.mcp.json` divergence on
  supply-chain-optimizer suggests it already did).
- **Copy-once-then-drift**: no drift detection (the primitives — `snapshotWorkflows` +
  `listTemplateWorkflows` — already exist, just never compared), no upgrade path
  (re-running onboarding skips existing files), no live→template feedback (Retro edits
  target-repo workflows — which fails anyway, see D3 — and nothing writes improvements
  back to `config/loop-template/`).
- **Template-vs-live diff (measured)**: pilot = 10/10 byte-identical (no drift; the
  07-22 handoff's pending "roll out dedup" decision #4 was in fact completed on 07-23,
  commits `ae79994`/`e02f113`). supply-chain-optimizer = 8/10 identical, **2 stale**
  (`claude-scout.yml` missing PR-dedup + `pull-requests: read`; `claude-builder.yml`
  missing title/branch claim detection) — it still carries the duplicate-work bug the
  pilot fixed.
- **Pilot literals leaked into "generic" dashboard code**:
  `app/api/map/ai-job/latest/route.ts:36`, `components/queues/custom-idea.tsx:38`,
  `app/layout.tsx:21`; `resolveProject(undefined)` and a registry-read failure both
  silently collapse to the pilot (`lib/projects.ts:78,106-108`); `REPOS.primary`
  (`lib/github.ts:25`) is a stale second registry defaulting ~30 helper signatures to
  the pilot; `app/api/tools/issue-action/route.ts:30`,
  `app/api/tools/request-change/route.ts:25`, `lib/tools.ts:18` still write to the
  pilot regardless of the project switcher.

## Part 3 — Live output quality (content-generation-platform, full census)

- 52 Scout ideas over 07-14 → 07-23; 19 filing runs, batch size 1–10 (median 2).
- **Tailoring: ~96% product-grounded** (e.g. #118 retention-weighted winner ranking
  with `analytics.ts:76`/`winnerDigest.ts:43` evidence; #45 defamation-gate bypass in
  `defamationLint.ts:59`; #114 three-hop TikTok/YouTube publish race including a wrong
  code comment as root cause). Only #20 is classic generic hygiene. 87% cite a real
  file; 63% cite `file:line`; burst size correlates inversely with evidence depth (the
  10-issue burst on 07-20 produced the only zero-evidence ideas).
- **Duplication despite injected context**: #102 duplicated approved #96 + open PR #99
  **22 minutes after the PR opened, with both in its injected context**; #79 vs #27;
  #56 vs #49; #77 vs #19; two thematic clusters of 3. Two structural templates ("port
  pattern A to pipeline B", "silent failure") account for ~44% of all ideas — a
  monoculture caused by the four fixed hourly lenses.
- **Approval reality**: true rate 35% (18/52), reported as 0% since day one due to the
  `loop-metrics.mjs:40-41` bug (approve *swaps* labels, the script counts `approved` as
  a subset of `proposal` → structurally always 0). 12 unapproved ideas were built
  anyway (Builder pulls from the `proposal` shelf), making approval partly decorative.
- **Approval archetypes** (what the owner says yes to): existential channel risk
  (copyright/defamation/demonetization/shadowban); a promise the app makes that the
  code doesn't keep; more money from content already produced. Never approved:
  measurement-only dashboards, format polish, new surface area.
- **No negative signal exists**: zero ideas closed `not planned`; the 07-23 mass-close
  of 7 PRs was followed by 6 functional-equivalent re-opens within 17 min–7 h because
  "closed PR" cannot be distinguished from "rebuild it".
- **Retro → Scout feedback has never functioned**: retros #63/#69/#81 diagnosed the
  same problems three weeks running (including "stand down until redesign") — the day
  #81 was filed, Scout filed its largest batch ever (19 issues).

## Part 4 — Defect register (merged, deduplicated)

Severity | Where | Defect
---|---|---
HIGH | `claude-scout.yml:51,67,71,185`, `claude-builder.yml:78-100` | No `--limit` on any `gh issue/pr list` → silent truncation at 30. Caps > 30 (or `"unlimited"` → 999999) are unenforceable: pool reads ≤30 forever, Scout is told it has ~999,969 slots, hourly. Dedup lists also truncate.
HIGH | `claude-scout.yml:179-191` | Verify step race: label changes mid-run (approve/reject/redraft) make `now ≤ BEFORE` → false-red run with wrong diagnostics; at pool ≥ 30 combined with the truncation it's guaranteed red on every successful run. Also missing `success() &&` guard.
HIGH | `claude-retro.yml:71` | Retro cannot push edits to `.github/workflows/` — `GITHUB_TOKEN` lacks `workflow` scope. The prompt-self-improvement half of the loop has likely never succeeded.
HIGH | `claude-redraft.yml:15-31,77-82` | No actor gate: anyone who can label/comment steers an Opus agent with Bash+WebFetch and `issues:write`, instructed to obey "the latest comment" without confirmation. Prompt-injection with real capability.
HIGH | `components/queues/ideas-view.tsx:163`, `use-idea-chat.ts:45-66` | Cards keyed by issue number only + stale data on project switch → chat transcript cross-write and, worst case, Approve posted against the same-numbered issue in the *other* repo.
HIGH | `lib/queues.ts:176-183` | `loadIdeas` fetches 100 unfiltered issues (PRs eat slots, oldest fall off) → approved ideas can vanish from the dashboard while the Builder still acts on them; queue count disagrees with Scout's gate.
HIGH | `app/api/builds/[pr]/route.ts:175`, `app/api/ideas/[number]/route.ts:101` | Re-adding an already-present label emits no GitHub event → "Rebuild fresh" and repeat-redraft are silent no-ops until an unreliable cron.
HIGH | `scripts/loop-metrics.mjs:40-41` (lives in target repo) | Approval-rate counting bug: reported 0% vs real 35%; poisons `LOOP-DASHBOARD.md`, the retros, and Scout's only prescribed learning input.
MED/HIGH | `app/api/ideas/[number]/chat/route.ts:102-120` | Issue title/body/comments (third-party + machine-authored) interpolated verbatim into a local agent with `Read/Grep/Glob`; `cwd` is set but `Read` accepts absolute paths → `~/.ssh`, `.env` reachable; answer text is the exfil channel. Any issue number accepted.
MED | `claude-scout.yml:146,149` | Untrusted PR/issue titles interpolated into the Scout prompt with no fencing.
MED | `claude-audit.yml:45,59`, `claude-redraft.yml:54,78` | `${{ }}` interpolated into shell unquoted — classic Actions command injection (dispatch-gated).
MED | `claude-scout.yml:162` (+builder, tool-install) | `--assignee ${{ github.repository_owner }}` breaks on org-owned repos → issue never created, verify goes red.
MED | `app/api/ideas/[number]/route.ts:79-102` | Non-atomic add+remove label pairs → dual-label states the dashboard and Builder read differently (UI says "waiting", Builder builds it). Use `issues.setLabels`.
MED | `loop-metrics.yml:7-45` | No concurrency group; concurrent runs on burst PR-merges → non-fast-forward push failures exactly when activity peaks.
MED | `claude-scout.yml:61,130` | `room` handed to the agent unclamped — no per-run batch limit (the "accumulate steadily" comment is unimplemented).
MED | supply-chain-optimizer live | Loop dead (missing `CLAUDE_CODE_OAUTH_TOKEN`, Scout red on every run since ≥07-25) while Builder reports green skipped no-ops — health signals actively misleading. 2 workflows stale behind template. `repo-tests.yml`/`claude-demo.yml` guaranteed to fail on first PR (npm/Prisma on a Python+Vite repo; pilot routes in demo prompt).
MED | `app/api/ideas/custom/route.ts:92` | "Attached integrations" written into issue bodies for a Builder/tool-installer wiring step **no workflow performs**.
MED | `app/api/ideas/[number]/chat/route.ts:33` vs `custom/*` | Idea chat gated CLI-only (503 on Vercel) while custom-idea chat accepts CLI or API key — inconsistent for no structural reason; no route exports `maxDuration`, so the 150s synchronous `custom/chat` gets killed mid-turn serverless.
MED | `lib/queues.ts:384` vs `claude-builder.yml:78` | Draft PRs excluded from the dashboard count but counted against `prCap` by the Builder → "free slot" shown while Builder stands down.
LOW | various | Malformed `ideaQueueCap` hard-fails the gate (no read-time validation); Scout/Redraft granted `Write,Edit` they shouldn't have; unused `id-token: write`; dead `LoopConfig.version`; inert `[skip ci]`; Redraft has no verify step (its own known label-flip failure mode is unguarded); Retro boots Opus with no activity gate; fork-PR trap in `claude-audit.yml`; reporter checkpoints computed-but-never-read + `os.tmpdir()` cache on serverless; blind loop-config PATCH overwrite; cap-slider display/saved mismatch; DST-wrong cron comments; `createIssue` 422 retry can create junk labels; custom ideas filed with no assignee (the owner's own ideas don't notify).

## Part 5 — Ranked recommendations (merged)

### P0 — Broken now, cheap to fix

1. **Fix the approval-rate counting bug** (`scripts/loop-metrics.mjs:40-41`, in the
   target repo): count `approved`-labelled issues as their own set; denominator = union.
   Then make `LOOP-DASHBOARD.md` a real ledger: emit explicit title lists of *approved*
   and *ignored >7 days* ideas so Scout's prescribed learning input contains something
   learnable. One-line bug, corrupts the entire feedback loop.
2. **Unfreeze the loop — gate Scout on triage throughput, not shelf size**: stand down
   when >N approved ideas await builds or the oldest proposal is >7 days untouched,
   instead of `pool < cap`. (Retro #81's fix, still unimplemented; the queue has been
   frozen at 25 since 07-23.) Pair with a per-run batch cap `min(3, room)` and an
   evidence floor (require `src/…:NN` or a dated external source — the corpus already
   hits 87% voluntarily).
3. **Create a rejection channel and feed it back**: a `declined` label (+ one-line
   reason) from the Ideas page; inject declined + redraft lists into the Scout gate
   alongside approved; distinguish "closed-to-rebuild" from "rejected" at the PR layer
   so the Builder stops resurrecting rejected work. Scout has literally never seen a
   "no".
4. **supply-chain-optimizer: add the secret or deregister it.** `gh secret set
   CLAUDE_CODE_OAUTH_TOKEN --repo ApagPlayz/supply-chain-optimizer` (owner action) or
   remove from `config/projects.json`. Also sync its 2 stale workflows from the
   template, and stop counting a skipped agent step as a green run in any health
   signal.

### P1 — The structural tailoring fix (all agents converged)

5. **Per-repo `scout` block in `.github/loop-config.json`**, injected into the prompt
   via the same `jq … // default` pattern the caps already use:
   `productSummary`, `currentGoals[]`, `offLimits[]`, `lenses[]`, `maxPerRun`,
   optionally `competitors[]`. Extend `lib/loop-config.ts` types/validation + surface
   as a "What should the Scout look for?" card beside `AutomationPanel`. This is the
   single change that makes sourcing per-repo, with plumbing that exists end to end.
6. **Rotate/configure researcher lenses** (kills the 44% two-template monoculture and
   the hourly competitor WebSearch): pool of 8–10 lenses, 2–3 per run seeded by run
   number; content-platform preset = retention/watch-through, cost-per-video,
   platform-policy changes, output quality as a viewer judges it, upstream API
   breakage, untouched factories. Add "no two ideas in one batch share a primary
   subsystem" and steer the mix toward the three proven approval archetypes.
7. **Machine-check dedup**: dump *all* idea issues ever (open+closed, both labels) +
   PR titles in the gate; post-filing verification flags high title-overlap and fails
   the run (same discipline the existing verify step applies to "did you file
   anything"). Follow-through items become comments on the parent idea, not new issues.
8. **De-pilot the template**: replace the literal route list in
   `claude-demo.yml:170-171` with route discovery; make `repo-tests.yml` stack-aware
   (`--if-present`, detect `package.json`/`pyproject.toml`, drop unconditional
   Prisma); seed a product brief (`CLAUDE.md` or `.github/loop-brief.md`) at
   onboarding; move the pilot-copied files (`.mcp.json` etc.) into
   `config/loop-template/` and drop the pilot-snapshot fallback.
9. **Drift detection + upgrade path**: a `GET /api/map/template/drift` composing the
   existing `listTemplateWorkflows()` vs `snapshotWorkflows()` per project, surfaced on
   the Process Map; route Retro's prompt improvements to the dashboard *template* (via
   `repository_dispatch` → `applyTemplateChanges`, which already exists) instead of the
   target repo's workflows — this also fixes the dead `workflow`-scope push (D3) and
   makes lessons learned on one repo reach the next.

### P2 — Defect fixes

10. `--limit 200` on every `gh issue/pr list` in Scout+Builder; race-proof the verify
    step (high-water issue number + `success() &&` guard).
11. Dashboard: key idea cards `${project}:${number}` + clear data on switch + port the
    `loadedProjectRef` guard into `use-idea-chat.ts`; label-filtered paginated
    `loadIdeas` (pattern already in `lib/testing.ts:297`); explicit
    `dispatchWorkflow` after approve/redraft/rebuild label writes; atomic
    `issues.setLabels`; align draft-PR accounting and surface "Builder standing down:
    N/N slots".
12. Security: actor-gate Redraft to the repo owner (and "latest comment *authored by
    the owner*"); fence untrusted text in Scout + idea-chat prompts; move `${{ }}`
    into `env:` and quote in audit/redraft; restrict idea-chat to queue-labelled
    issues; drop `Write,Edit` from read-only agents; fix org-owner assignee.
13. Retro: add an idea-quality remit (duplicate rate, approval-by-category, one dated
    LEARNINGS entry per week) + a cheap activity gate before booting Opus; add
    Redraft's missing verify step; `loop-metrics.yml` concurrency group + rebase-retry.

### P3 — Housekeeping

14. Retire `REPOS.primary` as a default (make `repo` required; `resolveProject(undefined)`
    throws); fix the three leaked pilot literals + the pilot-fallback-on-registry-error;
    scope or honestly-globalize the reporter (per-project `interests[]` + "file as
    proposal", or delete dead checkpoints and fix its docs); unify AI availability
    gating + `maxDuration`/jobs for chat routes; close or remove the integrations
    promise in custom ideas; loop-config optimistic concurrency; cap-slider
    normalization; assignee on custom ideas; validate `ideaQueueCap` at read time;
    DST-correct cron comments.

---

*Method: 4 parallel Opus agents — (1) workflow-template prompt review, (2) onboarding/
template machinery + live-repo diffing via `gh`, (3) dashboard pipeline code review,
(4) full census of live Scout output on the content platform. Findings above are merged
and deduplicated; file:line references verified by the reporting agents.*
