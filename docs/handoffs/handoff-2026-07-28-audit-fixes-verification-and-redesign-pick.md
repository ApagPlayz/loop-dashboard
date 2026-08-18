# Handoff — Audit fixes shipped & live-verified; loop back ON; redesign pick pending (2026-07-28)

> **SUPERSEDED by `handoff-2026-08-03-redesign-shipped-to-pr-and-merge-backlog.md` (2026-08-03)** — read that file instead; this one is kept for history. Its audit/rollout detail is still the best reference for *what was fixed on 2026-07-27*. Two of its instructions are now known to be WRONG and were corrected in the newer handoff: (a) its "Next steps 1" says to comment on issue #49 — #49 is closed and the Builder has no `issue_comment` trigger, so that route reaches nothing; the redesign was instead filed as new issue #126 and built as PR #127. (b) Its "Running & resumable" PIDs are stale — 1135 and 89187 are both dead.

## TL;DR
- Branch `main`, **clean and pushed** (`8c5386c`). A full audit of the loop's idea-sourcing was run, ~40 fixes implemented by parallel agents, adversarially verified, committed, and **rolled out live to both target repos** (byte-verified).
- End-to-end verified in the real UI: power toggle, approve→build (produced live PR #122), new Scout stand-down gate, drift chip, launcher.
- **Single next action:** get the owner's redesign pick (style 1/2/3 + dark/light) and post it as a comment on content-platform issue #49 (include the "two identical nav rows" feedback), then let the loop build it.
- **Blocked on the user:** redesign pick; pull+restart of the stale Content Engine; supply-chain-optimizer token decision; yes/no on the "don't run unconfigured loops" feature.

## Goal
Arc: audit the loop dashboard's improvement-sourcing/suggestion-generation ("default vs specific repo" tailoring), fix everything found, verify it works end to end, and unblock the content platform's visible progress (redesign).

## Repo state (Loop Dashboard, 2026-07-28)
- Branch `main`, in sync with `origin/main`, **no modified/untracked files** (this handoff file is the only new file; not committed unless asked — project rule says dashboard commits go straight to main, so committing it is fine if requested).
- Recent commits: `8c5386c` (audit fixes, 86 files), `3d9bba9` (redesign phase 5: overview home + Inter), then earlier redesign phases.
- No open PRs on `ApagPlayz/loop-dashboard`.
- Target repos updated live: content-generation-platform commit `37e2364`, supply-chain-optimizer commit `987e497` — 10 workflows + `scripts/loop-metrics.mjs` + `docs/DASHBOARD-CONTRACT.md` + new `docs/loop-brief.md`, all byte-identical to `config/loop-template/`; `declined` label (color `6E7781`) created on both.

## Done so far (this session)
1. **Audit** (4 parallel Opus agents) → `docs/audits/audit-improvement-sourcing-2026-07-27.md`. Headline: live suggestions were already ~96% product-specific; the real problems were a broken feedback loop (approval rate mis-counted as 0% forever — real 35%), a frozen queue, no rejection channel, and copy-once-then-drift template architecture with the pilot's stack hardcoded.
2. **Implementation** (6 parallel implementers + 2 follow-ups, then 4 verifiers + 3 fixers — all changes in `8c5386c`):
   - Per-repo `scout` block in `.github/loop-config.json` (productSummary/currentGoals/offLimits/lenses/maxPerRun) + "What should the Scout look for?" card on Ideas (`components/queues/scout-settings.tsx`).
   - Scout rebuilt: triage-throughput gating (stand down when >5 approved waiting or oldest proposal >7d), batch cap 3, `--limit 200`, race-proof verify, rotating lenses, declined/redraft negative signal, untrusted-data fencing, org-safe assignee.
   - Decline channel end-to-end: `declined` label, atomic `setLabels`, close as not_planned, Decline button + reason in `idea-card.tsx`, surfaced in Closed tab, injected into Scout prompt.
   - `loop-metrics.mjs` counting bug fixed (template file `config/loop-template/files/loop-metrics.mjs`); LOOP-DASHBOARD.md now a learning ledger (approved/declined/ignored title lists).
   - Template architecture: `config/loop-template/files/` is canonical (no pilot copies/fallback), onboarding seeds `loop-brief.md`+`CLAUDE.md`+`declined` label and guards missing assets; drift endpoint `app/api/map/template/drift` + chip on Process Map; template editor covers files section with content-hash conflict checks.
   - De-piloted `repo-tests.yml`/`claude-demo.yml` (stack detection Node/Python, route discovery, best-effort steps, `demoPort` config); Retro gets activity gate + idea-quality remit + `docs/loop-suggestions.md` path (its old workflow-edit path could never push).
   - Security: Redraft gated to repo admins via permission check; shell-injection quoting in audit/redraft/demo; idea-chat fenced + label-gated + works on API backend; tool-install payload validated/fenced.
   - Scoping: `REPOS.primary` deleted, `repo` required everywhere; Tools page fully project-scoped; `resolveProject` throws (400/404/502) instead of pilot fallback; `app/(app)/error.tsx` boundary; metrics page degrades gracefully.
   - loop-config: sha-guarded saves (TOCTOU fixed via `expectedSha` in `commitFile`), unknown keys preserved (`extra`), non-404 read errors rethrow, fingerprint+409 flow in both panels (drafts preserved on conflict).
   - Reporter: dead checkpoints removed, honest `partial` semantics + immediate background refresh (`after()`), single-flight "Refresh now".
   - IMPORTANT regression caught by verification: `id-token: write` is REQUIRED by claude-code-action (OIDC-minted GitHub App token) — restored in all 8 agent workflows; never remove it.
3. **Live verification** (Playwright against local dashboard): login ✓, overview counts ✓, Ideas tabs + automation panel ("Builder slots used", demoPort field) ✓, Scout card shows "Not set up yet" ✓, drift chip "Workflows match the template" ✓, **power toggle flipped all 9 workflows to `active` on GitHub** ✓, **approved idea #82 → labels swapped atomically → Builder started in 1s → real PR #122 (`claude/issue-45-defamation-name-matching`, Closes #45 — oldest-approved-first is designed behavior)** ✓, manual Scout dispatch → green stand-down: "10 approved ideas are already waiting on the Builder" ✓, launcher green "Open http://localhost:3000" with Content Engine live ✓.
4. **Stale-product diagnosis** (user: "UI looks the same"): the running Content Engine serves checkout `~/Documents/Claude Projects/Content Generation Platform` at July-22 code, **16 commits behind origin/main** (missing #53 auto-refresh, #66 TikTok warning, #99 stall timeout, #111 budget cap). Server PID 1135 started Jul 26 13:12 **without pulling** (PR #93's auto-pull runs only via the dashboard Launch button). Also: most merged PRs are pipeline/safety (invisible in UI), and the redesign (#49) only merged **3 draft looks** at `public/design-drafts.html` — never applied because the owner never picked. Explained the page's confusing double nav row (top row = preview control, second row = static mockup chrome).

## Current state
- Loop on content-generation-platform: **ON** (all 9 workflows active; turned on via dashboard this session). 25 proposals / ~10 approved / 11 open PRs. Scout will keep standing down until approved ideas get built/merged or triaged — by design.
- supply-chain-optimizer: workflows synced but **Scout fails red every ~3-4h on missing `CLAUDE_CODE_OAUTH_TOKEN`** (user said keep the project, set up later). Its own `ci.yml`/`deploy-render.yml` fire on pushes — our rollout commit triggered a successful Render deploy.
- Content Engine (the product): running but stale (16 commits behind); NOT restarted/pulled — waiting on user OK.
- Scout brief card: not filled in yet for any project (Scout logs "running on defaults").
- Nothing broken known in the dashboard; `tsc` + `next build` clean at `8c5386c`.

## Running & resumable
- **PID 1135** — Content Engine dev server, port 3000, cwd `~/Documents/Claude Projects/Content Generation Platform`, running since Jul 26 (STALE code).
- **PID 89187** — Loop Dashboard dev server, port 3100 (`PORT=3100 npm run dev`, background task from this session; dies with this session or machine — restart with the same command if needed).
- Playwright MCP browser session was used for UI verification; disposable.
- No resumable workflow runs; no cron/scheduled tasks created.

## Next steps (ordered)
1. **Get the redesign pick** (style 1/2/3, dark/light default) — page is `http://localhost:3000/design-drafts.html`. Post a comment on `ApagPlayz/content-generation-platform` issue **#49** with the pick + feedback: "make the mockup's own nav do the switching — the preview showed two identical nav rows". Then the loop (Builder) implements it. (#49 is closed/approved-completed; if the loop doesn't act on a comment, file it as an approved follow-up idea referencing #49/#52.)
2. **Pull + restart Content Engine** (user OK'd nothing yet): `cd "~/Documents/Claude Projects/Content Generation Platform" && git pull && restart` — or quit it and use the dashboard's Launch button (auto-pulls per PR #93). Then verify budget-cap display/login warnings appear.
3. **supply-chain-optimizer decision**: `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ApagPlayz/supply-chain-optimizer` (owner-only) OR toggle its loop off from the dashboard to stop red runs.
4. **If user says yes to "don't run unconfigured loops"**: (a) onboarding installs `claude-*` workflows then immediately disables them via the existing power machinery (`lib/map-power.ts`), so new projects start OFF until the checklist passes; (b) add a first gate step to each agent workflow template that stands down with a clear `::notice::` when `CLAUDE_CODE_OAUTH_TOKEN` is absent (step-level `if:` can read secrets; job-level cannot) — then roll templates out again.
5. Fill in the Scout brief card for the content platform (Ideas page) so the next Scout run uses real goals instead of defaults.
6. Triage the idea backlog with the new Decline button — the Scout stays stood-down until the pile shrinks; declining stale ideas is now a real signal.
7. Optional deferred items (verifier "plausible/minor" list): empty-registry onboarding UX; `lib/tools.ts` catalog/install second pass; reporter cold-build-vs-full-refresh race (P5); redraft first-send when the labeler is a bot identity.

## Key files & context
- Audit report: `docs/audits/audit-improvement-sourcing-2026-07-27.md` (defect register + full recommendation list — the source of truth for what was fixed and what was consciously deferred).
- Template: `config/loop-template/workflows/*.yml` + `config/loop-template/files/*` — canonical; live repos synced 2026-07-27. Template is read via GitHub API, so template changes must be pushed to take effect.
- Rollout pattern: one atomic commit per target repo via git trees API (`gh api`), non-force; verify byte-identity + `actions/workflows` state after.
- Dashboard runs: `npm run dev` (use `PORT=3100` if Content Engine holds 3000); login password in `.env.local`.
- Gotchas: `id-token: write` is load-bearing (see above). Label-event workflow triggers fire because the dashboard uses the owner's PAT (verified live). Approving builds the OLDEST approved idea, not the one just approved. Dashboard commits go straight to main (memory rule); content-platform changes go through the loop's idea/PR queue, never direct commits.

## Open questions / decisions pending (answerable in a word or two)
1. Redesign: **1, 2, or 3? Dark or light default?**
2. Content Engine: **OK to pull + restart now?** (briefly interrupts any render)
3. supply-chain-optimizer: **add token now, or toggle its loop off?**
4. Setup-guard feature (onboard-off + secret gate): **build it?**
5. prCap input now capped at 99 in the UI (server allows any): **fine, or remove the cap?**
