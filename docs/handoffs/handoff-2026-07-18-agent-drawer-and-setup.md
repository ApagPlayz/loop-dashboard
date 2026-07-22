# Handoff — Agent drawer cleanup + project setup diagnostics

> **SUPERSEDED by `handoff-2026-07-20-automation-controls-and-audit-fix.md` (2026-07-20)** — read that file instead; this one is kept for history. Its still-pending items (the agent-drawer tab merge and idea-card toast fix, both unconfirmed by the user) are carried forward there.

## TL;DR
- Branch `main`, 2 uncommitted files (both intentional, not yet reviewed by user): `components/map/agent-drawer.tsx`, `components/queues/idea-card.tsx`.
- Done: merged the drawer's "Abilities" tab into "Overview", made Recent Runs auto-refresh every 20s, fixed a misleading toast, diagnosed (no code fix needed) the `supply-chain-optimizer` setup blockers.
- **Single next action:** wait for user to refresh the dashboard and confirm (a) the drawer now shows 5 tabs with the merged Overview, and (b) Scout's Recent Runs shows all-success after reopening. Then decide whether to commit.
- **Blocked on user:** they need to run 3 manual steps to finish `supply-chain-optimizer` setup (see Open Questions) — nothing more Claude can do there without their token.

## Goal
This session was a grab-bag of dashboard UX fixes and live-issue triage for the "Loop Dashboard" app, which manages a fleet of Claude-powered GitHub Actions agents (Scout, Redraft, Builder, Auditor, Retro, Metrics, etc.) across two target repos: `ApagPlayz/content-generation-platform` (main/active) and `ApagPlayz/supply-chain-optimizer` (new, still being onboarded).

## Repo state
- Branch: `main`, tracking `origin/main`, no divergence noted beyond the uncommitted working-tree changes below.
- Working tree (uncommitted, not yet staged):
  | File | Status | Disposition |
  |---|---|---|
  | `components/map/agent-drawer.tsx` | Modified (+80/-50) | Real feature work this session — merged Abilities tab into Overview + added 20s auto-refresh for Recent Runs. User has NOT yet confirmed it looks right in the browser. Do not commit until confirmed. |
  | `components/queues/idea-card.tsx` | Modified (+1/-1) | Toast-copy fix ("tonight" → "within a minute"), already confirmed correct by grep-verification this session. Safe to commit whenever the other file is also ready. |
  - This handoff file itself is **untracked** (new, under `docs/handoffs/`) — not committed.
- Open PRs on `ApagPlayz/content-generation-platform` (18 open, unrelated to this session's work — pre-existing autonomous-loop output, listed for situational awareness only, not something this session touched): #68, #67, #66, #65, #64, #62, #60, #55, #54, #53, #52, #48, #47, #46, #42, #39, #38, #37. Full titles available via `gh pr list --repo ApagPlayz/content-generation-platform --state open`.
- Open PRs on `ApagPlayz/supply-chain-optimizer`: none.
- Open PRs on the dashboard repo itself: none.

## Done so far (this session, verified by me directly — not just agent self-report)
1. **Fixed misleading approval toast** — `components/queues/idea-card.tsx`, `approve()` function. Was: "Approved — the Builder will pick this up tonight (or trigger it from Testing)." Now: "Approved — the Builder will start on this within a minute (or trigger it from Testing)." Confirmed the real Builder trigger (`config/loop-template/workflows/claude-builder.yml`) fires within ~1 minute via a GitHub `labeled` event, with a 30-min cron as backstop only — the old "tonight" copy was simply wrong, not a real scheduling issue.
2. **Merged "Abilities" tab into "Overview"** — `components/map/agent-drawer.tsx`. Tab list went from 6 (`overview, instructions, capabilities, run, install, history`) to 5 (`overview, instructions, run, install, history`). Overview now shows, in order: description → "When it runs" → new "Installed" section (same 3 `ChipGroup`s: Tools / Connected services (MCP) / Skills, reading `detail.capabilities`) → "Recent runs". Added a "Browse & install tools →" button in the Installed section that calls `setTab("install")`, gated by `TOOL_TARGET_AGENTS.has(detail.meta.id)` (same set used elsewhere: `scout, builder, audit, retro, mention, demo`). Deleted the old `CapabilitiesTab` component entirely; confirmed via grep no other file references it. Verified via `npx tsc --noEmit` (clean) and my own grep pass over the final file.
3. **Fixed "Recent Runs" going stale** — same file. Root cause: the panel fetched once on drawer-open and never refreshed. User saw 5 "Failed" Scout runs in the UI, but the real GitHub Actions history (last 100 runs on `claude-scout.yml` in `content-generation-platform`) is 100% success — Scout was never actually broken. Fix: added `setInterval(() => load(true), 20000)` (confirmed present at `components/map/agent-drawer.tsx:93`) so Recent Runs re-fetches every 20s while the drawer stays open.
4. **Diagnosed `supply-chain-optimizer` setup blockers — no code changed, this is real, not a dashboard bug.** Confirmed via `gh secret list --repo ApagPlayz/supply-chain-optimizer` that `CLAUDE_CODE_OAUTH_TOKEN` is genuinely absent (only `RENDER_API_KEY` is set there), unlike `content-generation-platform` which has the token. Also confirmed the dashboard's "can't check GitHub App install" message is expected behavior (a personal-access-token-based check can't query GitHub App installation state — needs a JWT/App credential) — not a bug, and it fails the same way even on the known-working repo, by design (see `app/api/map/projects/checklist/route.ts`).

### Noted but not part of this session's work (surfaced by an agent, unverified by me directly)
- Local machine currently has **3 node dev servers** listening: port 3000 = a *different* project ("Content Generation Platform" repo, unrelated — ignore), port 4400 = current/correct Loop Dashboard server (started 2026-07-16), port 3100 = a **stale leftover Loop Dashboard server** (started 2026-07-15, likely running with an outdated `.env.local`/token). If the user has an old browser tab pointed at port 3100, it could show stuck/wrong data. Not stopped automatically — user's call whether anything else depends on it.

## Current state
- Both modified files are working-tree changes only, not committed, not pushed.
- No dev server was restarted by this session — the existing servers (see above) should already be serving whatever's on disk for :4400 and :3100 via Next.js hot-reload, but genuinely stale state after a large edit is possible; a hard refresh is the safe bet.
- No build/tsc errors known; the drawer-merge agent ran `npx tsc --noEmit` clean after its edit.
- User had NOT yet confirmed in-browser that the merged Overview tab (5 tabs, Installed section, Browse & install shortcut) looks correct, or that Scout's Recent Runs now shows all-success — last screenshot (before the Recent-Runs fix landed) still showed the old 6-tab layout, which was flagged as likely a stale-page issue and a refresh was suggested.

## Running & resumable
- No Workflow (`wf_…`) runs were used this session — all delegated work went through the plain `Agent` tool (background subagents), all of which have already completed and reported back. Nothing is still running from this session.
- Dev servers (pre-existing, not started by this session — see table above): PID 73399 on :4400 (Loop Dashboard, current), PID 88980 on :3100 (Loop Dashboard, stale), PID 50398 on :3000 (unrelated project). Check with `lsof -iTCP -sTCP:LISTEN -P -n | grep node`.
- No scheduled cron/loop jobs were created this session (`CronList` not used; nothing to check there).

## Next steps
1. Ask the user to hard-refresh the dashboard (or reopen the tab) and confirm: (a) an agent drawer now shows 5 tabs with an "Installed" section inside Overview, and (b) Scout's drawer now shows all-success Recent Runs instead of the earlier "Failed" streak.
2. Once confirmed, offer to commit the two modified files (`components/map/agent-drawer.tsx`, `components/queues/idea-card.tsx`) — separate logical changes (toast copy vs. tab merge + auto-refresh), consider whether the user wants one commit or two.
3. No further action needed on `supply-chain-optimizer` from Claude's side — it's fully blocked on the user completing their 3 manual steps (see Open Questions). Once they've done so, a good follow-up would be triggering one agent run there to confirm end-to-end.
4. Optional/low-priority: user may want the stale dev server on :3100 stopped, and/or old browser tabs closed — purely their call, not urgent.

## Key files & context
- `components/map/agent-drawer.tsx` — the agent detail drawer opened from the Process Map; now has `OverviewTab`, `InstructionsTab`, `RunTab`, `InstallToolsTab`, `HistoryList` (5 tabs). `TOOL_TARGET_AGENTS` constant gates which agents support tool installs.
- `components/queues/idea-card.tsx` — idea approval card; `approve()` function holds the toast copy.
- `lib/map-agents.ts` — single source of truth for agent metadata (descriptions, triggers, `TARGET_REPO = {owner: "ApagPlayz", repo: "content-generation-platform"}`).
- `config/loop-template/workflows/*.yml` — the actual GitHub Actions workflow templates (source of truth for real trigger/schedule behavior — always check here before trusting in-app copy).
- `app/api/map/projects/checklist/route.ts` — backs the "Finish the setup" panel checks (secrets + GitHub App install status).
- `lib/tool-catalog.ts` / `components/tools/catalog-browser.tsx` — the MCP/skill/plugin marketplace catalog and single-tap install flow (already existed before this session; relevant if the user revisits the "browse/install tools" ask).
- Typecheck command used: `npx tsc --noEmit` (project has no dedicated `npm run typecheck` script — only `lint`/`dev`/`build`/`start` in package.json).
- `gh` CLI is authenticated as `ApagPlayz` with `repo`/`workflow` scopes — sufficient for secret-name listing, PR/run inspection, but NOT for GitHub App installation checks (needs a JWT/App credential instead).

## Open questions / decisions pending
- **Commit the 2 pending files?** Waiting on user to visually confirm the drawer changes look right first.
- **User still needs to do, for `supply-chain-optimizer`** (nothing Claude can do here — needs their credential):
  1. Run `claude setup-token` in a terminal to generate a `CLAUDE_CODE_OAUTH_TOKEN`.
  2. Run `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ApagPlayz/supply-chain-optimizer` and paste it.
  3. Open https://github.com/apps/claude and make sure `supply-chain-optimizer` is in the app's repo access list.
- **Stale dev server on :3100** — stop it, or is something else relying on it? (low priority)
