# Handoff — Loop change-detection fixes shipped & rolled out; CGP brief awaiting approval (2026-08-19)

> **SUPERSEDED by `handoff-2026-08-31-aws-bedrock-migration-phases-0-3.md` (2026-08-31)** — read that file instead; this one is kept for history.

## TL;DR
- The loop's blindness to hand-made work is **fixed and live**: Builder/Scout now check real code before acting, both refuse to run on an unconfigured brief, metrics count human PRs, Resume no longer blanket-enables, chat admits local-checkout drift. Dashboard `main` clean & pushed at `b405f32`.
- **supply-chain-optimizer's loop is OFF on purpose** (owner's decision, mid-repair — see memory `supply-chain-loop-intentionally-paused`). Do not resume or "fix" it.
- A live **security hole was closed**: content-generation-platform (public repo) had an ungated `@claude` mention workflow = arbitrary code execution for anyone. Gate now live.
- **Single next action:** get the owner's yes/no on the 5 drafted goals in the CGP loop-brief (draft committed at `docs/drafts/cgp-loop-brief-draft-2026-08-18.md`), land it in the repo, then roll the new Scout/Builder to CGP.
- **Owner pushed the supply-chain commits** (2026-08-19: local == origin at `fed1bb6`) — the "25 unpushed commits" blocker from this session is RESOLVED.
- Separate deliverable completed: elderly-care market research, fully filed in `~/Documents/Claude Projects/elderly care/` (self-contained, not this repo's concern).

## Goal
Arc: make the autonomous loop *trustworthy alongside a hands-on owner* — it must see work done manually in the owner's own Claude sessions and adjust recommendations/builds instead of re-proposing or re-building shipped work. Triggered by GitHub email spam from the supply-chain Builder cron and the owner's direct question "can the loop see my changes?" (answer was no, on three levels — full register in `docs/audits/audit-change-detection-2026-08-18.md`).

## State
- **Dashboard repo:** `main` == `origin/main` at `b405f32`, tree clean. All of yesterday's work committed and pushed (`dbedb6d` security gate, `3c76b2d` change-detection fixes, `b405f32` docs tidy).
- **Rolled out live (byte-verified):**
  - supply-chain-optimizer: new `claude-builder.yml`, `claude-scout.yml`, `scripts/loop-metrics.mjs` (safe — loop paused).
  - content-generation-platform: security-gated `claude-mention.yml`, new `scripts/loop-metrics.mjs`.
- **Deliberately NOT rolled out:** new Scout/Builder to content-generation-platform — its `docs/loop-brief.md` is still 100% placeholder and the new guard would halt its live, shipping loop. Owner chose "draft the brief first, then roll out."
- **Also deliberately not rolled out:** template `claude-mention.yml` to supply-chain — its live copy has an equivalent gate PLUS repo-specific content (a "Re-check the PR" step) the template lacks. Overwriting would destroy it.
- **CGP brief draft** is committed at `docs/drafts/cgp-loop-brief-draft-2026-08-18.md` (99 lines, no placeholders). The 5 goals awaiting approval: (1) make loop work visible in the product, (2) keep Warm Creator look consistent, (3) shrink the review queue, (4) nothing bad auto-publishes, (5) bounded/honest spend.

## Verified vs assumed
**Verified:**
- All rollouts byte-verified against the template after push; supply-chain confirmed still fully paused afterwards; no workflow runs were triggered by the pushes.
- Dashboard: `npx tsc --noEmit` clean, `npm run build` succeeds, all 10 template YAMLs parse, gate scripts pass `bash -n`, `node --check` on metrics script.
- Scout's git-log pipeline exercised against a real repo + synthetic bot/human rows; tag logic correct.
- Drift detection (`getCheckoutStatus`) tested read-only against the genuinely diverged Logisitics checkout (then 1 behind / 25 ahead / 19 dirty — numbers matched reality).
- Owner's push confirmed 2026-08-19: `git ls-remote` == local HEAD `fed1bb6` in `Logisitics Project/`.

**Assumed / NOT verified:**
- **The new Builder/Scout prompts have never executed live.** Their behaviour (stand-down on placeholder brief, already-implemented abort, git-history use) is prompt-engineering, verified only by reading. First real runs happen when supply-chain resumes or CGP gets the rollout.
- **The new pause/resume state mechanism (`.github/loop-pause-state.json`) has never been exercised against a live repo** — pause was done via `gh` CLI *before* this feature existed, so supply-chain has NO pause record. Expected behaviour on resume: the confirmation path (shows what it would enable), not silent blanket-enable. Expected, not tested.
- **Whether anyone ever exploited the CGP @mention hole is UNCHECKED.** The gate is closed going forward; historical issue comments were never audited. Owner was offered this check and hasn't answered.
- The dashboard UI after the power-menu changes has not been opened and looked at.
- The CGP brief's "Current goals" section is inferred from evidence, not stated by the owner — it's marked `DRAFT — owner to confirm` inside the file.

## Dead ends
- **`sed` on multi-line YAML prompt text mangles line flow** — a one-line substitution left a dangling wrapped fragment mid-paragraph. Use a python string-replace over the full block instead (see `patch_scout*.py` pattern).
- **Reddit is unfetchable directly** (tool-level block, both HTML and .json). Working proxies: gummysearch.com summaries, AgingCare.com (fetches clean), Scrapling MCP for stealth. (Mattered for research; recorded in the elderly-care files.)
- The first "professional/clinical" research scout spawned nested sub-agents and appeared hung; it was killed twice. Lesson applied since: research agents get an explicit "work alone, no sub-agents" instruction.

## Running & resumable
- **Port 3000:** node PID `1112` LISTENing — the Content Engine (other project). Leave alone.
- **Dashboard dev server (port 3100): not running.** Start: `PORT=3100 npm run dev`.
- **supply-chain-optimizer GitHub workflows:** 8 loop workflows `disabled_manually` (INTENTIONAL — owner's repair pause). `claude-mention.yml` left active by design; project-own CI/deploy/lead-time crons untouched and still firing.
- **content-generation-platform loop: fully live** and cycling (Scout hourly, Builder every 30 min) — still on the OLD Scout/Builder prompts until the brief lands.
- No background agents, no resumable workflow runs, no crons created this session.
- Published artifact (elderly-care report): https://claude.ai/code/artifact/2ce13847-cb73-4086-9d34-90c41e126e48 — its live-watch died; harmless.

## Next steps
1. **Show the owner the 5 CGP goals → get yes/edits.** On yes: commit the brief to `ApagPlayz/content-generation-platform` as `docs/loop-brief.md` (Contents API PUT, same as yesterday's rollout), optionally drop the DRAFT banner, then push template `claude-scout.yml` + `claude-builder.yml` to that repo and byte-verify. The loop then runs with real product context for the first time.
2. **Offer/do the @mention exploitation check:** scan CGP's historical issue/PR comments for `@claude` from non-owner accounts and cross-reference mention-workflow run history (`gh run list -R ApagPlayz/content-generation-platform -w claude-mention.yml`).
3. **When the owner wants supply-chain's loop back:** now that the code is pushed, fill in that repo's `docs/loop-brief.md` + add a `scout` block to `.github/loop-config.json` FIRST (the new guards will refuse to run otherwise — by design), set `CLAUDE_CODE_OAUTH_TOKEN` secret (Scout's historical failure cause), then enable workflows **individually** (`gh workflow enable <file> -R ApagPlayz/supply-chain-optimizer`) — master Resume has no pause record here and will ask for blanket confirmation.
4. Deferred audit items if the owner wants more: B4 (hardcoded process map), B5/B6 (stale-cache fallbacks), B7 (overview pagination), C4 (approved-issue reconciliation). Register: `docs/audits/audit-change-detection-2026-08-18.md`.

## Key context
- **The audit + rollout log** (single best reference): `docs/audits/audit-change-detection-2026-08-18.md`.
- **Rollout is manual**: template lives in `config/loop-template/` (must be pushed to take effect); installing into target repos = Contents API PUT per file + byte-verify. Before overwriting any live workflow, **diff it against the previous template first** — that check is what saved supply-chain's customized mention workflow.
- Memory files to trust: `supply-chain-loop-intentionally-paused`, `deliberate-off-states-are-not-bugs`, `dashboard-commits-straight-to-main`.
- The supply-chain local checkout is the folder named **`Logisitics Project`** (typo and all), NOT `Supply Chain Project` (not a git repo).
- CGP repo is **public** — anything shipped there is world-readable; its 13-PR merge backlog (per the 2026-08-03 handoff) is still the owner's bottleneck.
- Owner is non-technical: plain language, micro-recap block after changes (global CLAUDE.md), decisions arrive terse.

## Open questions
1. **CGP brief goals — approve as drafted, or what changes?** (blocking step 1)
2. **Check whether the @mention hole was ever exploited — yes/no?**
3. **When do you want the supply-chain loop back on?** (no rush — it's off by your choice)
