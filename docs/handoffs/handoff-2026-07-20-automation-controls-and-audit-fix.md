# Handoff — Automation controls, audit re-trigger fix, and verification round

> **SUPERSEDED by `handoff-2026-07-21-merge-failure-and-session-summary.md` (2026-07-21)** — read that file instead; this one is kept for history. Its still-pending items (commit strategy, stale `:3100` server, unconfirmed agent-drawer/idea-card changes) are carried forward there, unchanged.

## TL;DR
- Branch `main`, 18 modified + 5 untracked files, **nothing committed yet** — all working-tree changes.
- Done: (1) fixed the real bug that caused unapproved overnight builds, added a full per-project Automation panel (idea-queue cap + autonomous-build toggle) to the Ideas page; (2) guaranteed real AI reasoning for the Tools page's top-10 scan results; (3) found and fixed two more real bugs (stale Auditor verdicts never re-checking, and the dashboard missing verdicts posted as PR reviews instead of comments), added a "Re-run audit" button; (4) verified (read-only) how the weekly Retro audit works and confirmed template-vs-per-project edit isolation holds.
- **Single next action:** run `npx tsc --noEmit && npm run build` one more time to reconfirm clean (last confirmed clean at the end of this session), then ask the user whether to commit everything as one or several logical commits.
- **Blocked on user:** nothing code-wise. User should eyeball the new Ideas-page Automation panel and PR #42 (now shows SHIP) in the browser before committing.

## Goal
This was a long session on the "Loop Dashboard" app (manages Claude-powered GitHub Actions agents — Scout, Builder, Auditor, Demo, Retro, @mention, Metrics — across external target repos `ApagPlayz/content-generation-platform` and `ApagPlayz/supply-chain-optimizer`). It started from the owner waking up to find overnight builds that skipped approval, and grew into: fixing that root cause, building real user-facing controls for it, fixing a second unrelated automation gap (stale audit verdicts) discovered while verifying the first fix, and a final read-only verification round of two things the owner asked about (the Retro agent, and workflow-edit isolation).

## Repo state
- Branch: `main`, tracking `origin/main`, no divergence beyond working-tree changes below.
- **No open PRs on the dashboard repo itself.**
- Open PRs on `ApagPlayz/content-generation-platform`: 16, pre-existing/unrelated to this session except **PR #42** (see below). Full list via `gh pr list --repo ApagPlayz/content-generation-platform --state open`.
- Open PRs on `ApagPlayz/supply-chain-optimizer`: none (Scout still failing there, per earlier investigation — unrelated, not touched this session).
- This handoff file itself is untracked, not committed.

### Working tree — every changed file, all uncommitted
| File | What changed |
|---|---|
| `config/loop-template/workflows/claude-builder.yml` | Removed hardcoded overnight PR-cap lift + unconditional self-pick; both now read `.github/loop-config.json` (`prCap`, `autonomousBuildEnabled`), gated via a bash-computed prompt-text swap (`steps.gate.outputs.pick_rule`) so the agent isn't even told self-pick is an option when it's off. |
| `config/loop-template/workflows/claude-scout.yml` | Hardcoded idea-pool cap of 8 replaced with `.github/loop-config.json`'s `ideaQueueCap` (default 25, `"unlimited"` supported). |
| `config/loop-template/workflows/claude-audit.yml` | Added `workflow_dispatch` (`pr_number` input) alongside the existing `pull_request` trigger, with a "Resolve PR number" + `gh pr checkout` step, so it can be re-run manually/programmatically outside the normal PR-open/sync events. |
| `config/loop-template/workflows/claude-mention.yml` | Bumped `permissions.actions` to `write`; added a before/after-SHA check that, when an `@claude` push actually lands a new commit on an existing PR, explicitly dispatches `claude-audit.yml` + `claude-demo.yml` + `repo-tests.yml` (they'd otherwise never re-fire — see "Done so far" below for why). |
| `lib/loop-config.ts` (new) | `LoopConfig` type + `DEFAULT_LOOP_CONFIG` + `getLoopConfig`/`setLoopConfig` — reads/writes `.github/loop-config.json` **inside each target repo** (not the dashboard's own repo), via the same Contents-API pattern as `lib/projects.ts`. |
| `app/api/loop-config/route.ts` (new) | `GET`/`PATCH ?project=<key>` wrapping the above. |
| `lib/onboard.ts` | `installBaselineLoop` now also seeds a default `.github/loop-config.json` for newly-onboarded projects. |
| `lib/queues.ts` | `loadIdeas`/`listThreadComments`/`closeIssue` gained an optional `repo` param (Ideas page is now project-scoped; Builds page deliberately left alone, see Open Questions). Also added `listPRReviewComments` and merged it into `loadPRDetail`'s comment/verdict source — see Bug 2 below. |
| `app/api/ideas/route.ts`, `app/api/ideas/[number]/route.ts` | Accept `?project=`/body `project`, resolve via `resolveProjectFromUrl`, thread through to `lib/queues.ts`. |
| `components/queues/ideas-view.tsx` | Added its own `ProjectSwitcher` (separate `localStorage` key `loop-dashboard.project.ideas` from the Map page's), a "Viewing: X" label, and mounts the new `AutomationPanel`. |
| `components/queues/idea-card.tsx`, `components/queues/custom-idea.tsx` | Thread `project` through their fetches; `custom-idea.tsx`'s success-screen copy and pilot-check logic fixed to be project-aware. |
| `components/queues/automation-panel.tsx` (new) | The "Automation for `<project>`" panel: autonomous-build toggle, PR-cap number field, idea-queue-cap slider, explicit Save button (not autosave — each save is a real GitHub commit). |
| `components/queues/toggle-switch.tsx` (new) | Extracted the pill on/off switch pattern from `power-menu.tsx` into a reusable component. |
| `components/queues/cap-slider.tsx` (new) | New — no slider primitive existed before. 5 discrete stops: 10/25/50/100/Unlimited. |
| `lib/tool-fit.ts` | Added a backfill pass: after final sort, guarantees the top-10 scanned tools get real AI-written reasons (not a generic "Quick keyword estimate" fallback) via one extra small AI batch call when needed. |
| `app/api/assistant/route.ts` | Corrected the in-app help assistant's false claim that "a human approves everything — nothing ships on its own"; now accurately describes the per-project autonomous-build setting. |
| `lib/map-agents.ts` | Deleted the dead, unused `TARGET_REPO` constant (confirmed zero other references before deleting). |
| `app/api/builds/[pr]/route.ts`, `components/queues/pr-card.tsx`, `components/queues/evidence-viewer.tsx` | New `reaudit` action (dispatches `claude-audit.yml`); exported `RerunButton` from `evidence-viewer.tsx` and reused it in `pr-card.tsx`'s `VerdictBadge` for a new "Re-run audit" button. |

**Untracked/new files:** `app/api/loop-config/`, `components/queues/automation-panel.tsx`, `components/queues/cap-slider.tsx`, `components/queues/toggle-switch.tsx`, `lib/loop-config.ts`, `docs/handoffs/` (this file).

**Left over from BEFORE this session, still uncommitted, unrelated to this session's work:** `components/map/agent-drawer.tsx` and `components/queues/idea-card.tsx` both still carry the earlier (2026-07-18) tab-merge/toast-copy changes described in `handoff-2026-07-18-agent-drawer-and-setup.md` — that work is still pending the user's visual confirmation from before, and now sits in the same files alongside this session's new edits. `idea-card.tsx`'s diff is a mix of both sessions' changes.

## Done so far (this session, verified directly — not just agent self-report)

### 1. Root-caused and fixed the overnight-builds incident
Investigated why builds appeared overnight with no approvals given. Root cause, confirmed against real GitHub run/issue/PR data: `claude-builder.yml` was built to self-pick an unapproved proposal whenever nothing was approved ("You do not have to approve anything for the loop to keep moving" — literally in its own old comments), and lifted its normal 3-PR cap to unlimited overnight (11pm–7am ET). Fixed both live on GitHub (both target repos) **before** any dashboard UI existed, so the fix took effect immediately — verified via `gh api .../contents/.github/loop-config.json` on both repos and by tracing the actual bash logic.

### 2. Built the full Automation panel (per-project, not just a live-repo fix)
Entered plan mode, got explicit approval, then built: `.github/loop-config.json` per target repo (structurally isolated — two repos literally cannot share this file), a dashboard settings module + API route, Ideas-page project-awareness (previously hardwired to the pilot repo, exactly the same "silently defaults to pilot" bug class found twice more later this session), and the UI panel itself. All verified with `tsc`, `eslint`, and `npm run build` — clean throughout.

### 3. Tool-fit top-10 reason guarantee
User pointed out the "Find tools for a project" scan already shows a reason per tool (it does — this was already built); the real gap found was that a top-10-ranked tool could still get a generic templated fallback reason instead of real AI reasoning, if it missed the initial pre-rank cut or its AI batch failed. Fixed in `lib/tool-fit.ts`: one extra backfill AI call for exactly the top 10, only when needed.

### 4. Investigated "I sent a PR back to Claude and it didn't clear the queue" — found TWO real bugs
User reported PR #42 stayed stuck on a stale "FIX FIRST" verdict after using "Send back." Fully verified against live GitHub data (not guessed):
- **Bug A:** `@claude`-driven pushes to an existing PR use GitHub's default bot identity, and GitHub's own recursion-prevention rule means that identity's pushes never trigger `pull_request: synchronize` — so Auditor/Demo/Tests silently never re-ran after any follow-up fix, on ANY PR, ever. Fixed: `claude-mention.yml` now detects when it actually pushed a new commit to an existing PR and explicitly re-dispatches all three via `workflow_dispatch` (which IS exempt from that GitHub rule).
- **Bug B:** Even after manually re-triggering the Auditor and confirming (via the run's own log) that it posted a fresh **SHIP** verdict, the dashboard still didn't show it — because this particular run posted the verdict as a formal `gh pr review --comment` (a PR *review*) rather than a plain issue comment, and `lib/queues.ts`'s verdict parser only ever read plain comments. Fixed: `loadPRDetail` now fetches and merges both plain comments and PR reviews before picking the newest audit-shaped message.
- Manually re-triggered the Auditor on PR #42 live — confirmed it now shows **SHIP** (verified via `gh pr view 42 --json reviews`).
- Added a "Re-run audit" button to the Builds page (mirrors the existing "Re-run demo" button) so the user has a manual option too, not just the new automatic re-trigger.

### 5. Filed a new proposal issue (at the user's direct request, fully pre-written by them)
Filed `ApagPlayz/content-generation-platform#92` — "Auto-pull the latest code every time I start the app locally" (`npm run go` should `git pull --ff-only origin main` when safe, non-blocking). Labeled `proposal`, assigned to the owner, exact body as given. Confirmed `scripts/dev-start.sh` and the `npm run go` script both actually exist in that repo before filing. This is unrelated to everything else in this session — just something the user asked to be filed while other work was in progress.

### 6. Read-only verification round (no code changes)
Two parallel agents, at the user's request:
- Explained exactly how the weekly Retro agent works: reads 7 days of raw PR/issue/run activity plus `metrics/loop-metrics.json` (a separate, non-AI daily job) directly from the target repo; only ever opens a PR to LEARNINGS.md/workflow prompts when there's a genuinely repeated lesson (most weeks: none); never auto-merges anything. Confirmed the Metrics page reads the exact same files Retro does, so they can't diverge.
- Verified template-edits-vs-per-project-edits isolation across 5 specific claims (template propagation, agent-instruction edits, Draft-with-AI/History/Restore, shared-cache risk, and the core "editing project A never touches project B" claim). **All passed.** One informational-only note: a legacy fallback in the "restore an in-progress AI-draft on page reload" convenience feature defaults to the pilot project for very old jobs with no project tag — cannot cause a cross-project write, not a real risk, not fixed (not worth it for a read path with no write consequence).

## Current state
- Everything above is implemented and was verified clean at each step (`npx tsc --noEmit`, `npx eslint`, `npm run build` — all clean as of the last check this session, re-confirmed once more right before writing this handoff).
- Nothing has been committed. Nothing has been pushed to the dashboard's own GitHub remote (only to the two TARGET repos' workflow files/config, which is intentional and already live).
- Both target repos (`content-generation-platform`, `supply-chain-optimizer`) have the fixed `claude-builder.yml`, `claude-scout.yml`, `claude-audit.yml`, `claude-mention.yml`, and a `.github/loop-config.json` — this is real, live, already in effect.
- PR #42 on `content-generation-platform` is open, shows a fresh SHIP verdict, not yet merged — that's the user's call, not something to action further.

## Running & resumable
- No Workflow (`wf_…`) runs from this session — all work went through the plain `Agent` tool (background subagents) or was done directly; nothing is mid-flight.
- Dev servers (pre-existing, not started this session): PID 73399 on :4400 (Loop Dashboard, current/correct), PID 88980 on :3100 (stale leftover, flagged in the previous handoff, still not cleaned up), PID 35427 (or similar) on :3000 (unrelated other project — ignore). Check with `lsof -iTCP -sTCP:LISTEN -P -n | grep node`.
- No scheduled cron/loop jobs were created this session.
- `gh` CLI authenticated as `ApagPlayz` with repo/workflow scopes — sufficient for everything done this session (workflow_dispatch, contents API, PR/review reads).

## Next steps
1. Run `npx tsc --noEmit && npx eslint . --quiet && npm run build` one final time to reconfirm clean before touching anything else (should be instant/clean — nothing has changed since the last check).
2. Open the dashboard (`:4400`), go to Ideas, confirm the new Automation panel renders correctly for both projects, and that switching projects actually changes what's shown.
3. Open Builds, find PR #42, confirm it now shows SHIP and a working "Re-run audit" button.
4. Ask the user how they want this committed — this session touched a lot of unrelated-feeling areas (automation settings, tool-fit reasoning, audit re-trigger fix), so probably worth 2-3 separate commits rather than one giant one. Suggested split: (a) automation-settings feature (loop-config + Ideas panel + workflow YAML), (b) audit re-trigger + verdict-parsing fix + Re-run-audit button, (c) tool-fit top-10 reason guarantee + the small `lib/map-agents.ts` cleanup + assistant copy fix could go with (a) or standalone.
5. Separately (not this session's work, still pending from before): decide on the two leftover files mixing old + new changes (`agent-drawer.tsx`, `idea-card.tsx`) — the user still hasn't visually confirmed the 2026-07-18 tab-merge work.
6. Low priority: the stale dev server on :3100 is still sitting there, unaddressed across two sessions now.

## Key files & context
- `config/loop-template/workflows/*.yml` — the editable template, lives in THIS repo, copied byte-for-byte into a target repo only once, at onboarding. Live target-repo copies are edited independently afterward (verified isolated this session).
- `.github/loop-config.json` — new, lives INSIDE each target repo (not here), schema: `{version, autonomousBuildEnabled, prCap, ideaQueueCap}`.
- `lib/loop-config.ts`, `app/api/loop-config/route.ts` — the new settings backend.
- `lib/queues.ts` — Ideas + Builds data layer; `loadPRDetail`/`parseAuditFromComments` now consider both comments and reviews for verdicts.
- `lib/github.ts` — `dispatchWorkflow`, `commitFile`, `getFileContent`, `REPOS.primary` (the "pilot" repo constant — still used as the default for anything not yet made project-aware, e.g. the Builds page, by design/agreed scope for this session).
- `lib/projects.ts` — project registry (`config/projects.json` in THIS repo), `resolveProject`/`resolveProjectFromUrl`.
- Typecheck: `npx tsc --noEmit`. Lint: `npx eslint . --quiet` (project has no dedicated typecheck npm script). Build: `npm run build`.
- Full plan for the automation-settings feature (already executed) is preserved at `~/.claude/plans/shiny-drifting-manatee.md` if you want the original design reasoning.

## Open questions / decisions pending
- **Commit strategy** — one commit or several logical ones? (See Next steps #4 for a suggested split.)
- **Scope confirmed deliberately narrow this session:** Builds/Tools/Metrics pages still ignore the project switcher (always show the pilot project) — the user explicitly agreed this round would fix only the Ideas page; the rest is an acknowledged, not-yet-scheduled follow-up.
- **Not asked yet:** does the user want the OTHER currently-open PRs (besides #42) checked for the same "silently-stale-verdict-from-a-past-@mention-push" issue? The fix going forward is automatic; anything that happened before today isn't retroactively covered.
- Stale `:3100` dev server — stop it, or does something else depend on it? (asked twice now, still unanswered)
