# Audit — can the loop see hand-made changes? (2026-08-18)

**Trigger:** `supply-chain-optimizer` was emailing the owner. Two questions came out of it:
pause the loop, and find out whether the loop can perceive work the owner does by hand in their
own Claude sessions.

**Answer: no, on three independent levels.** Each alone would be enough.

---

## STATUS NOTE — the paused loop is INTENTIONAL

`ApagPlayz/supply-chain-optimizer` has all 8 loop workflows `disabled_manually` as of
2026-08-18. **This is a deliberate decision by the owner, not a fault and not an incident.**
They are fixing the loop before turning it back on.

Do not "helpfully" resume it. Do not treat red/absent Scout runs on this repo as a defect to
chase. It stays off until the owner says otherwise.

Paused via the dashboard's own mechanism (`lib/map-power.ts:67` → GitHub's workflow disable
API). `claude-mention.yml` deliberately left active — that is the master-pause design, so the
phone remote control survives. The project's own workflows (`ci.yml`, `deploy-render.yml`,
`collect-lead-times.yml`, `repo-tests.yml`) were untouched.

**Email source, confirmed:** `claude-builder.yml` on a `*/30` cron — 284 runs in 12 days, 95%
of all Actions activity, the only workflow producing failures (6 in 12 days, clustered
2026-08-17). GitHub emails the repo owner on failed scheduled runs. The dashboard itself sends
no email; there is no mailer anywhere in the codebase.

---

## The root shortfall

The loop has no concept of *"the current state of the product."* It only has a concept of
*"work I proposed or built."* Every item below is a symptom. The correction pattern is always
the same: **make each agent read ground truth before it acts, instead of reading its own paper
trail.**

---

## A — Process shortfalls (OWNER-OWNED — no code fix exists)

These are the expensive ones, and they are also the cheapest to fix (~30 min total).

| # | Shortfall | Consequence | Status |
|---|---|---|---|
| A1 | **25 commits / 243 files never pushed** from `~/Documents/Claude Projects/Logisitics Project` → `ApagPlayz/supply-chain-optimizer`. +57,314 / −18,430. | The loop is blind to ~half the codebase. Nothing downstream can work. | **OPEN — owner** |
| A2 | `docs/loop-brief.md` in the target repo is 100% placeholder — all four sections read `_Not filled in yet._`. `.github/loop-config.json` has **no `scout` block**. | Both owner-intent stores are empty. Scout had no idea what the product is. | **OPEN — owner** |
| A3 | Loop configured to do nothing (`autonomousBuildEnabled: false`, Scout disabled) but crons fired anyway | 284 pointless Builder runs, 6 failures, inbox noise | Mitigated by pause; root fix = D2 |

### A1 detail — the histories have DIVERGED
- Local HEAD `82d7e83` (2026-08-17); GitHub `main` is `f6012ba`, **an object the local clone
  has never seen** (`git cat-file -t f6012ba` → fatal).
- Local `origin/main` ref is stale at `cb0128e`. `git status` therefore reports "ahead 25" and
  hides the divergence.
- **A plain `git push` will be REJECTED.** Requires `git pull --rebase` first. Expect a
  conflict on the metrics files — the owner has already hand-resolved one on 2026-08-17
  (`3958e87 merge: union the cron's 2026-08-17 snapshot with the local panel rewrite`).
- Last non-bot commit on GitHub `main`: `987e497`, 2026-07-27 — and that was a loop-config
  change, not product work. Everything since is `github-actions[bot]` metrics churn.
- Scale: GitHub's tree has 82 files under `backend/app`; local has 156.

### A3 detail — the loop on this repo has never meaningfully run
Zero issues ever created. Two PRs ever, both the 2026-07-14 installation PRs. Scout last ran
2026-08-02 and every run failed (missing `CLAUDE_CODE_OAUTH_TOKEN`).

---

## B — Architectural shortfalls (dashboard's model of reality)

There is no database and no persistent cache. GitHub *is* the database; every read is live
Octokit at request time. **Caching is NOT the problem** — `dynamic = "force-dynamic"` on ~69
files, zero `revalidate`/`unstable_cache`, internal fetches `cache: "no-store"`. The staleness
is semantic.

| # | Shortfall | Impact | Fix location |
|---|---|---|---|
| B1 | **Nothing ever reads the project's source tree.** Reality is modelled as GitHub issue labels + `claude/*` PRs. No `git.getTree`, no `recursive: true`, no `search.code`; every `getContent` targets a hardcoded path. | Structural — a pushed commit produces neither artifact, so it moves no number | Deep. Near-term proxy: let *agents* read code (Scout already can). Full fix deferred. |
| B2 | `loop-metrics.mjs:30` — `isAgentPr = pr.headRefName?.startsWith("claude/")` gates **every** PR metric. That report is, per its own line 11, *"the Scout's only prescribed learning input."* | High — feeds Scout a false picture of the repo | `config/loop-template/files/loop-metrics.mjs` |
| B3 | Local checkout never fetched (`lib/local-folders.ts:94` runs only `git remote get-url origin`) but `lib/process-chat.ts:114-115` tells the model it is *"this project's ACTUAL source code."* No branch / ahead-behind / dirty check. | Medium-high — chat and GitHub-backed views describe two different codebases, neither labelled | `lib/local-folders.ts`, `lib/process-chat.ts` |
| B4 | Process map is hardcoded TypeScript (`lib/map-agents.ts:23-153`); `onMain` is a literal `true` | Medium — map cannot reflect reality | Deferred, low return |
| B5 | `lib/projects.ts:99` — on read failure `registryCache` is served stale forever, no age ceiling | Low | Deferred |
| B6 | `lib/tools.ts:175-183` — falls back to the long-lived `claude/dashboard-support-workflows` branch and presents it as current | Low | Deferred |
| B7 | `lib/overview.ts:93` unpaginated at 100 — the same bug already fixed in `queues.ts:186-190` | Low-medium | Deferred |

---

## C — Agent prompt shortfalls (where the real damage happens)

Verified by reading the prompts directly, not secondhand.

| # | Shortfall | Consequence |
|---|---|---|
| C1 | **Builder has no "already implemented" abort.** Grep for `already implement / still needed / stand down` → **zero matches**. Only abort paths are "nothing to pick" (`:219`) and "tests fail" (`:250-254`). The prompt pushes the other way: *"Your job is done when `gh pr create` has actually run."* | **Deterministic rebuild.** Hand-build something an `approved` issue asked for → label never changes → `:217` *"The OLDEST open issue labeled `approved` … always wins"* selects it → duplicate/conflicting PR. |
| C2 | **Scout dedupes against the queue, not the code.** `:454-455` — *"not represented anywhere in: open proposals, open PRs, approved ideas, declined ideas, or redrafts."* All five are issue/PR objects; code on `main` is absent. `:406` directs it to find *weakness*, never to check whether the thing already exists. | Re-proposes shipped work |
| C3 | **No agent ever runs `git log` / `git diff` / `git blame`.** | The loop cannot perceive non-loop work even in principle |
| C4 | Approved issues never expire; nothing reconciles the queue against reality. `Closes #N` in a loop PR is the ONLY automatic "done" signal. The dashboard's `closeIssue(…, "completed")` path is dead code — its sole caller always passes `"not_planned"` (`app/api/ideas/[number]/route.ts:180`). | Stale approvals accumulate as live landmines |
| C5 | Scout's evidence floor (`:467-469`) accepts *"a dated external source"* as an alternative to a `path:line` — so a proposal claiming something is MISSING can be filed with zero lines of repo code read | Unverified proposals |

**Partial mitigation that already exists:** Scout *does* check out the repo (`:47`) and has
unrestricted `Bash,Read,Glob,Grep` (`:350`). Capability was never the constraint — instruction
was. But there is no pass over *already-filed* issues, so C1 stands regardless.

---

## D — Operational footguns

| # | Shortfall | Consequence |
|---|---|---|
| D1 | **Master Resume re-enables EVERY disabled loop workflow** (`lib/map-power.ts:77-84`), including ones switched off deliberately. Resume cannot distinguish "disabled by pause" from "disabled on purpose". | Silently undoes deliberate decisions — e.g. would switch Scout back on |
| D2 | **Crons fire regardless of whether the loop is configured to do anything.** Already specced and deferred in the 2026-07-28 handoff as *"don't run unconfigured loops"*. | Would have prevented this entire episode |

---

## Correction plan

**Owner-owned, blocking everything else:**
1. **A1** — `git pull --rebase && git push` in `Logisitics Project`.
2. **A2** — fill in `docs/loop-brief.md`; add a `scout` block to `.github/loop-config.json`.

**Code, in flight 2026-08-18:**
3. **C1** — Builder mandatory pre-build verification + abort with `path:line` evidence.
4. **C2 / C5** — Scout dedupe extended to code on `main`; tighten the evidence floor.
5. **C3** — `git log` piped into Scout's gate step, human vs loop authors tagged, inside an
   untrusted-data fence.
6. **D2** — unconfigured-loop guard in the Scout and Builder gate steps (placeholder
   `loop-brief.md` → exit early, no model tokens spent).
7. **B2** — all-repo metric counters alongside the loop-only ones.
8. **D1** — Resume restores pre-pause state instead of blanket-enabling.
9. **B3** — local checkout drift detection; chat context stops claiming unqualified truth.

**Deliberately deferred:** B1 (full data-model rebuild), B4, B5, B6, B7, C4.

---

## Gotchas worth carrying forward

- Template changes in `config/loop-template/` **must be pushed to take effect**, and rolling
  them out to target repos is a separate manual step.
- Dashboard changes go straight to `main` — the PR/ideas/build queue is only for the loop's
  target projects, never the dashboard itself.
- The local checkout for `supply-chain-optimizer` is the folder named **`Logisitics Project`**
  (not `Supply Chain Project`, which is not a git repo at all).
- When resuming this loop later, enable workflows individually rather than using master Resume
  — at least until D1 lands.

---

## Rollout log — 2026-08-18

### Dashboard repo (`ApagPlayz/loop-dashboard`, private)
Pushed to `main`:
- `dbedb6d` Security: gate the @mention agent behind a permission check
- `3c76b2d` Make the loop see hand-made work, not just its own paper trail

Verified before push: `tsc --noEmit` clean, `npm run build` succeeds, all 10 workflow YAMLs
parse, gate scripts pass `bash -n`, `node --check` on `loop-metrics.mjs`.

### SECURITY FINDING (found during rollout, now fixed)

**`ApagPlayz/content-generation-platform` is PUBLIC and its `claude-mention.yml` was
ungated and active.** The job's only condition was a bare substring match for `@claude` in a
comment or issue body. It carried `contents: write`, `actions: write`, `pull-requests: write`,
`issues: write` and `--allowedTools "Bash,BashOutput,KillShell,Read,Write,Edit,Glob,Grep,Task,
TodoWrite,WebSearch,WebFetch"`, following instructions taken straight from the comment.

Any GitHub account could have commented `@claude …` on any issue and obtained arbitrary code
execution with repo write access. `actions: write` compounds it — workflows could be rewritten.

The fix already existed as uncommitted work in the dashboard tree from a previous session and
had never been committed or rolled out. `supply-chain-optimizer` had already been hardened live
with an equivalent (differently-worded) gate; the content platform had not.

**Fixed 2026-08-18** — the fail-closed `authorize` job (separate `contents: read` job, accepts
only ADMIN or MAINTAIN, refuses identities that cannot be permission-checked) is now live on
content-generation-platform, byte-verified against the template.

### Target repos — what was rolled out

| Repo | File | Status |
|---|---|---|
| content-generation-platform | `.github/workflows/claude-mention.yml` | **Rolled out** — security gate |
| content-generation-platform | `scripts/loop-metrics.mjs` | Rolled out — reporting only, no behaviour change |
| content-generation-platform | `claude-scout.yml`, `claude-builder.yml` | **Held** — see below |
| supply-chain-optimizer | `claude-builder.yml`, `claude-scout.yml`, `scripts/loop-metrics.mjs` | Rolled out — loop paused, zero risk |
| supply-chain-optimizer | `claude-mention.yml` | **Deliberately NOT rolled out** — its live copy already has an equivalent gate PLUS repo-specific content (the "Re-check the PR" step) that the template lacks. Rolling out the template would have clobbered it. |

All five rolled-out files byte-verified against the template after push. `supply-chain-optimizer`
confirmed still fully paused afterwards; no workflow runs were triggered by the pushes.

**Why Scout/Builder were held on content-generation-platform:** its `docs/loop-brief.md` is also
100% placeholder, so the new stand-down guard would have halted a live, actively-shipping loop.
The owner chose to have the brief drafted first so the loop never stops. That draft is the
open item.

### Pre-rollout check worth repeating
Before overwriting any target-repo file, diff it against the template at the *previous* commit
first. Four of five files were byte-identical (safe to overwrite); the fifth had live
repo-specific work that a blind rollout would have destroyed. There is no automated
rollout-to-existing-repo path in the dashboard — `applyTemplateChanges` writes only to the
dashboard repo, and `computeTemplateDrift` is read-only — so rollout is manual and this check
is manual too.
