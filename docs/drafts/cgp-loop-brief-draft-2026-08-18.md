# Product brief for the loop

**Read this first.** Every agent in this repo's improvement loop — Scout, Builder,
Auditor, Retro, Redraft — reads this file before it does anything. It is the only place
that says what this product *is*, what the owner is currently trying to achieve, and what
must be left alone. Without it, agents fall back to generic engineering hygiene.

> **This file starts as a template and is worthless until it is filled in.**
> If you are an agent and you find the placeholder text below still in place, say so in
> your output (and, if you have write access, open a proposal to fill it in) rather than
> guessing.

## Keeping this current — instructions for agents

- **Read before you propose.** Ideas that contradict "Off-limits areas" or ignore
  "Current goals" should not be filed.
- **Keep it true.** If you learn something here is stale or wrong — a goal that has clearly
  been met, an "off-limits" area the owner has since asked you to change, a description
  that no longer matches the code — propose an update to this file in the same pull request
  as the work that revealed it. Say plainly what changed and why.
- **Keep it short.** Aim for under 100 lines. It is loaded into every agent's context on
  every run; length here is paid for on every single run.
- **Do not turn it into a changelog.** Mistakes and corrections go in `LEARNINGS.md`;
  metrics go in `LOOP-DASHBOARD.md`. This file describes the present, not the history.
- **Never delete a section.** If a section does not apply yet, write "Not decided yet"
  under it so the gap is visible instead of silent.

### This file vs the `scout` block in `.github/loop-config.json`

Both hold the owner's intent, and they are not rivals. This brief is the **long-form
context** every agent reads here in the repo. The `scout` block (`productSummary`,
`currentGoals`, `offLimits`, `lenses`, `maxPerRun`) is the **structured knob set** the
Scout's gate step injects straight into its prompt, edited from the dashboard.

**If the two conflict, the `scout` block wins for the Scout's behavior** — it is what the
owner most recently typed, and the Scout is told it is the owner speaking directly. Every other
agent only ever sees this file, so this file governs for them. A conflict is a bug, not a
setting: when you spot one, propose the fix to this file in your next PR. Full detail in
`docs/DASHBOARD-CONTRACT.md` § 6.

---

## What this product is

Content Engine is a local-first app for mass-producing short-form video. The owner describes a repeatable video
format once — a "factory" — and the system generates on-brand vertical videos for it, holds them for review,
auto-publishes to YouTube Shorts and TikTok on a schedule, pulls analytics back, and shows which formats and
topics actually win. It runs on the owner's own machine, for one operator. Not a SaaS.

- **One hub screen** at `/` — tabs Overview, Factories, Agents, Inbox, Queue, Schedule, Winners — plus
  `/factories`, `/agents`, `/settings`. Nearly everything the owner does happens there.
- **Three live factories:** F9 sports highlights, F10 true crime, F11 history & business mini-docs (seeded
  by `scripts/seed-*.mjs`). Other factory types are designed but not built.
- **The pipeline is the heart.** `src/lib/orchestrator.ts` drives a run stage by stage (source → script →
  transform → assemble → publish), each stage a Job row; per-factory logic sits in `src/lib/tools/`
  (sports/clips), `src/lib/truecrime/` and `src/lib/history/`.
- **The safety gate,** `src/lib/compliance/`, screens a script before it can publish — corroboration, legal status,
  defamation lint, visual licence, anti-repetition — and can block it or force human review.
- **Publishing & learning:** `src/lib/tools/publish.ts`, `src/lib/youtube.ts`, `src/lib/tiktok.ts`, plus
  `src/lib/tools/analytics.ts` + `winnerDigest.ts`, which feed the "Winners" view.
- **Stack:** Next.js 15 App Router, React 18, TypeScript, Tailwind, Prisma + SQLite, ffmpeg (optional Remotion renderer in `video/`), Vitest.

## Current goals

> **DRAFT — owner to confirm or replace.** Inferred from merge history, the approved/ignored idea record and the loop's own metrics — not stated by the owner.

1. **Make the loop's work visible in the product.** Most of what merges is plumbing the owner never sees;
   the standing complaint is "nothing looks different." Prefer changes visible on a screen or in a video.
2. **Keep the shipped "Warm Creator" look consistent** — light by default with a dark toggle, exactly one
   nav bar, fewer tabs. New UI matches it; it does not add a second nav row or a new palette.
3. **Shrink the review queue rather than grow it.** ~13 PRs sit open and unmerged, the oldest a month old;
   the loop produces faster than the owner merges. A change that ships beats one that sits.
4. **Nothing bad should ever auto-publish** — no half-rendered, silent, blurry, narration-cut or legally risky video reaching a live account. Most approvals to date are this.
5. **Keep spend bounded and honest** — caps that actually stop a run, costs the owner can see.

## Off-limits areas

- **Credentials, tokens, secrets, `.env*`.** Only the owner can set them; an agent cannot test a credential
  it edits, and a leaked one costs real money and real accounts.
- **Auth / OAuth flows** (`src/app/api/auth/`, connect state in `src/lib/youtube.ts`, `src/lib/tiktok.ts`). A broken token refresh disconnects a channel silently. Reporting a bad connection is welcome; rewriting the flow isn't.
- **The posting integrations** (`src/lib/tools/publish.ts`, the platform clients). Live accounts, real API
  quota, uploads that cannot be undone. Small tested fixes are fine; widening what auto-posts is not.
- **Design and branding decisions.** The owner picks these personally and slowly — the redesign sat weeks
  waiting on a two-word answer. Implement a chosen direction; never invent a palette, typeface or layout.
- *(Inferred, unconfirmed.)* **Anything that loosens a guardrail** — auto-publish defaults, budget caps,
  compliance thresholds. Owner decisions, not optimisations. Ask first.

## How the owner works

- **Non-technical.** Plain language, no jargon, no file paths. Say what changes *for the owner*, not in the code.
- **Reviews on a phone.** The title must carry the whole idea; a few short bullets, nothing more.
- **Extremely terse.** The entire redesign decision was the two words "warm creator." Never wait for a
  detailed spec — if you need a decision, ask one question with two or three concrete options.
- **Slow to merge; this is the binding constraint.** Over half the PRs ever opened here never merged. Ship
  the smallest useful slice, never bundle, and keep it mergeable — staleness and conflicts kill most of it.
- **Wants to see it, not read about it.** A screenshot, a short demo, a before/after of a real video convinces; prose does not. Include visual proof whenever the change is visible at all.
- **Says yes to** a specific thing that is broken, unsafe or losing reach/money, named in the owner's own words
  ("your spending cap doesn't actually stop spending"). **Ignores** new analytics, per-platform polish, speculative
  niches, and asks to expand the loop's own tooling. There is no "declined" label here: silence is the no.
