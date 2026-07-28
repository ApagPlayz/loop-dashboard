# Handoff — Loop safety, commit hygiene, News/Tools/Builds features (2026-07-22)

> **SUPERSEDED by `handoff-2026-07-28-audit-fixes-verification-and-redesign-pick.md` (2026-07-28)** — read that file instead; this one is kept for history.

## TL;DR
- Branch `main`, **working tree CLEAN and fully pushed** (`main...origin/main`, 0 uncommitted). This is new — the whole prior backlog of uncommitted work is now committed.
- This session shipped 5 dashboard features (all committed+pushed, `npm run build` green): News/reporter sentiment overhaul, agent-aware tool-fit, a PR **conflict + "Rebuild fresh"** action, **Scout/Builder dedup**, and a **stale-PR "behind main" warning**. Plus resolved a big scare: nothing was being committed (now fixed) and clarified that a real "pause the loop" already exists.
- **Single next action:** answer the 4 pending product decisions (see Open Questions) — they gate live merges/rebuilds on `content-generation-platform` and rolling the dedup workflow changes out to that repo. **Re-poll PR mergeability first — the backlog is live-churning.**
- **Blocked on user:** those 4 decisions. Nothing else.

## Goal
Ongoing work on the **Loop Dashboard** (Next.js app that controls Claude-powered GitHub Actions agents — Scout, Builder, Auditor, Demo, Retro, @mention, Metrics, Reporter/News, Tool-installer — across target repos `ApagPlayz/content-generation-platform` and `ApagPlayz/supply-chain-optimizer`). This session's arc: make tool recommendations genuinely per-agent, make the News section actually informative (sentiment + techniques), fix the merge-conflict pain, and — the big one — fix that work was never being committed, then harden the loop against building off a stale repo.

Global/project rules auto-load (global CLAUDE.md: micro-recap, delegation, handoff-at-threshold; project `AGENTS.md`: **modified Next.js — read `node_modules/next/dist/docs/` before route code**; memory files). Not restated here.

## Repo state (dashboard: `ApagPlayz/loop-dashboard`, branch `main`)
- **Working tree: CLEAN.** `git status` = `## main...origin/main` only. Everything committed and pushed. **Nothing to commit or leave.**
- This handoff file is **untracked** (not committed) until you choose to.
- Commits added this session (oldest→newest), all pushed:
  - `66ce15c` News: sentiment enrichment, technique sources, and auto-refresh
  - `fb384d6` Tools: make fit scoring agent-aware, not just repo-aware
  - `6e1eeb4` Builds: warn on main conflicts + "Rebuild fresh" action
  - `898e81d` Save in-flight dashboard work: idea-chat, automation controls, launcher freshness
  - `c2e7fe5` Loop: broaden Scout/Builder dedup against in-flight work
  - `0108e31` Builds: warn when an open PR is falling behind main
- **No open PRs on the dashboard repo itself.**
- **`content-generation-platform` open PRs: ~16 and LIVE-CHURNING** (the loop is still running — since the mid-session survey, #46/#52/#55 dropped off and #97/#98/#99 appeared). A cold session MUST re-poll with `gh pr view <n> --repo ApagPlayz/content-generation-platform --json mergeable,mergeStateStatus` before acting — earlier statuses are stale.

## Done so far (all committed + pushed unless noted)

### A. News/Reporter sentiment overhaul (`66ce15c`) — built by 3 parallel agents
Was: an aggregator of announcements only, counting HN/Reddit votes without reading a word; recommended nothing about *sentiment* or *techniques*; never auto-refreshed. Now:
- `lib/reporter-enrich.ts` (NEW) — `enrichDigest(items)`: AI turns HN/Reddit/GitHub-Discussions comment text into a one-line "what people say" insight; clears raw `discussion` before persist.
- `lib/reporter-sources.ts` — new fetchers: Simon Willison Atom, TLDR AI, Reddit via `.rss` + `r/ClaudeCode`, GitHub Discussions (GraphQL, needs `GITHUB_TOKEN`), and HN top-comment fetch. **Anthropic Engineering RSS is dormant** (no working feed as of today; auto-activates if they publish one).
- `lib/reporter-types.ts` — added `technique` category + `discussion?`/`insight?`/`discussionUrl?` fields.
- `lib/reporter.ts` — `refreshDigest` now calls `enrichDigest`; merge preserves `insight`.
- `components/reporter/reporter-view.tsx` — "💬 What people say" line + `technique` chip.
- `app/api/reporter/route.ts` — stale-on-load background refresh (`STALE_MS` 6h) + single-flight guard.
- `app/api/reporter/cron/route.ts` (NEW) — protected cron endpoint (`CRON_SECRET`, Vercel-Bearer convention, `?token=` fallback; open if unset).
- `vercel.json` (NEW) — cron every 6h → `/api/reporter/cron`.
- `app/api/reporter/summarize/route.ts` — briefing now uses real insights.
- `docs/reporter-sources.md` — updated to reality.

### B. Agent-aware tool-fit (`fb384d6`)
Root problem the user spotted: every agent got the same recs (e.g. "Memory") regardless of what it already had. Fixed:
- `lib/tool-fit.ts` — scores each tool against **every loop agent's role AND its current tools**; per-tool `recommendForAgents` + `alreadyHave`; **dropped the static `rankScore*0.5` boost → `*0.02`** (that baseline floated Memory to the top of every repo).
- `lib/tools.ts` — `loadCapabilityInventory(repo?)` now repo-parameterized so it reads the **scanned** repo's agents, not always the primary.
- `components/tools/fit-scan.tsx` — "For: …" / "Already on: …" chips.

### C. PR conflict + "Rebuild fresh" (`6e1eeb4`)
- `app/api/builds/[pr]/route.ts` — new `rebuild` action: comment + close the conflicting PR, then reopen its **source idea** and re-apply `approved` so Builder rebuilds fresh against current main. Finds source idea from PR body `Closes #N` → title `(#N)` → branch `-N`; `422` if none found (PR left untouched).
- `components/queues/pr-card.tsx` — red "⚠️ Conflicts with main" banner when `detail.mergeable === false && detail.mergeableState === "dirty"` + "Rebuild fresh" button.
- `lib/queues.ts` — `reopenIssue` helper.
- `components/queues/builds-view.tsx` — left a `// TODO` for a list-level "N conflict" count (needs a per-PR fetch; deferred).
- ⚠️ **NOT exercised end-to-end** on a real PR (typechecks + builds only). First live use should be watched.

### D. Scout/Builder dedup (`c2e7fe5`) — TEMPLATE ONLY, not rolled out to live projects
- `config/loop-template/workflows/claude-scout.yml` — Scout now also reads **open PRs** + **approved ideas** before proposing (added `pull-requests: read`); told not to propose anything already in flight.
- `config/loop-template/workflows/claude-builder.yml` — `claimed` detection widened to match issue number from PR **title** + **branch name**, not just body `Closes #N`.
- **These are the dashboard's template copies.** They do NOT affect the live loop until synced into `content-generation-platform/.github/workflows/`. That sync is a pending decision (#4).

### E. Stale-PR "behind main" warning (`0108e31`)
- `lib/queues.ts` — `PRDetail.behindBy` via GitHub compare API (best-effort, 0 on error).
- `components/queues/pr-card.tsx` — amber "⏳ N commits behind main" banner at `STALE_THRESHOLD = 10`; red conflict banner still wins. No auto-rebase (by user's explicit choice — just warn + offer the button).

### F. No-code outcomes this session
- **Removed `firecrawl` MCP from user scope** (`~/.claude.json`) — restart Claude Code to fully drop it from the running session. `jina` MCP disconnected mid-session on its own.
- **Clarified the loop's staleness/duplication risk:** the loop's only view is **GitHub** (every agent `actions/checkout`s a GitHub ref) — local uncommitted work is structurally invisible, so it can propose/build things that conflict with unpushed local work.
- **A TRUE "pause the loop" already exists:** Process Map → **Power** button → "Pause entire loop" disables the actual GitHub workflows (Scout cron + Builder label/cron + Auditor/Demo/Retro), leaving only @mention on (`components/map/power-menu.tsx` → `/api/map/power` → `lib/map-power.ts:pauseLoop`). The Ideas-page **"Autonomous build" toggle is NOT a pause** — Scout still runs hourly and Builder still builds `approved` issues; it only stops Builder self-picking.
- **Root-caused the "I build it and nothing's there" fear:** work was uncommitted (now all committed+pushed). Launchers **never** destroy work (`lib/launchers.ts` forbids `git`/`rm`/`sudo` in start cmds — read-only `git fetch` only). `content-generation-platform`'s launcher DOES pull latest on start (`npm run go` → `scripts/dev-start.sh` → `git pull --ff-only`).

## Current state
- All 5 features: committed, pushed, `npm run build` **exit 0**, `tsc`/`eslint` clean.
- Dashboard on `:4400` serves the working tree (now == `origin/main`), so the features are live locally; a hard reload shows them.
- Nothing mid-edit. No broken files.

## Running & resumable
- **Dashboard dev server:** `:4400`, PID `4149` — running (Next dev, hot-reloads).
- **content-generation-platform dev server:** `:3000`, PID `20098` — running.
- **Stale `:3100`** leftover Loop Dashboard server — flagged in every prior handoff, still unaddressed (user's call). Check: `lsof -iTCP -sTCP:LISTEN -P -n | grep node`.
- **No Workflow (`wf_…`) runs** this session — all delegated work went through the plain `Agent` tool; all completed, none resumable/pending.
- **MCP:** `firecrawl` removed from user scope (restart to drop from the live session); `jina` disconnected mid-session.
- **`gh` CLI:** authed as `ApagPlayz` (repo/workflow scopes) — sufficient for live pushes to both target repos.

## Next steps (ordered, resume cold from here)
1. **Re-poll the `content-generation-platform` backlog** (it churns): `for n in $(gh pr list --repo ApagPlayz/content-generation-platform --state open --json number --jq '.[].number'); do gh pr view $n --repo ApagPlayz/content-generation-platform --json number,mergeable,mergeStateStatus,title; done`. Also get audit verdicts (grep each PR's comments for `Verdict`).
2. **Get the user's 4 decisions** (Open Questions below).
3. If approved: **merge** the SHIP+mergeable PRs one at a time (re-check mergeability after each — each merge moves main); **rebuild** the conflicting ones via the new "Rebuild fresh" button (WATCH the first one — untested live; #42→idea 26, #48→idea 27, #65→idea 17); handle the unreviewed set per the user's choice.
4. If approved: **sync the #2 dedup workflows** into `content-generation-platform/.github/workflows/claude-scout.yml` + `claude-builder.yml` (commit via the dashboard's `commitFile`/tool-install path or `gh`). Ensure `pull-requests: read` lands on the live scout workflow.
5. **Verify the new features live** in the running dashboard (`:4400` reload): News "💬 What people say" + technique sources; Tools "For:/Already on:" chips; Builds red-conflict + amber-stale banners.
6. Optional: implement the `builds-view.tsx` list-level "N conflict with main" count (needs per-PR mergeable fetch).

## Key files & context
- Build: `npm run build` · Typecheck: `npx tsc --noEmit` · Lint: `npx eslint <files>` — all clean at handoff time.
- Reporter pipeline: `lib/reporter.ts` (`refreshDigest` orchestrates pull→merge→`enrichDigest`→persist), `lib/reporter-sources.ts` (`pullAllSources`), `lib/reporter-enrich.ts`, `lib/reporter-store.ts` (tmp cache).
- Builds actions: `app/api/builds/[pr]/route.ts` (`merge`/`sendback`/`close`/`comment`/`redemo`/`reaudit`/**`rebuild`**); PR detail assembled in `lib/queues.ts` (`loadPRDetail`, now with `behindBy`).
- Loop config: `.github/loop-config.json` per project (`autonomousBuildEnabled`, `prCap`, `ideaQueueCap`) via `lib/loop-config.ts`. **`content-generation-platform` has `prCap: "unlimited"`** (set last session to clear the backlog).
- Pause: `components/map/power-menu.tsx` / `lib/map-power.ts`.
- **Standing behavior established with the user:** (a) I commit + push after each change and say "pushed" — no more silent uncommitted work; (b) user should hit **Power → Pause entire loop** before local coding sessions, Resume after pushing.

### Gotchas
- "Rebuild fresh" action never run end-to-end — verify live on the first use.
- GitHub Discussions reporter source needs `GITHUB_TOKEN` in the runner; Anthropic Engineering source dormant (no RSS).
- The dedup workflow edits are template-only until synced to the live project repo.
- `content-generation-platform` backlog moves on its own — always re-poll before acting.

## Open questions / decisions pending (all for the user, answerable in a word)
1. **Merge #60 (add Memory MCP to the loop) — yes or skip?** (SHIP verdict, but it's the "memory" thing you were skeptical about.)
2. **The unreviewed PRs (no audit verdict) — re-audit first, or merge as-is?**
3. **Rebuild the 3 conflicting PRs (#42/#48/#65) via the new flow — go?**
4. **Roll out the #2 dedup workflow changes to `content-generation-platform`'s live workflows — go?**
