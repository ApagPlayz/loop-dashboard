/**
 * Demo fixtures for the Ideas queue, the Learnings page, the loop-config panel
 * and the Claude Code Reporter.
 *
 * (The Builds & Evidence station lives next door in
 * `lib/demo/fixtures-builds.ts` — twenty-three pull requests with their full
 * audit and demo comments is enough text to deserve its own file. The bulky
 * verbatim workflow YAML lives in `lib/demo/fixtures-workflows.ts`.)
 *
 * ## What this file is
 *
 * An unauthenticated visitor's `GET /api/*` requests never reach the real
 * route handlers in `app/api/**` — the proxy described in
 * `lib/public-access.ts` answers them straight out of the fixture list below
 * and refuses everything else. Every body here is shaped to match its real
 * route's success response field-for-field, so the UI components that consume
 * them render exactly as they would against a live repo.
 *
 * ## THE RULE: everything in this file is real, and copied, not written
 *
 * The ideas below are forty-four actual GitHub issues from
 * github.com/ApagPlayz/content-generation-platform — a public repo the owner's
 * nine-agent loop runs on — captured 4 September 2026. Titles, bodies, labels,
 * dates and comment threads are verbatim. The Waiting and Approved tabs are
 * COMPLETE: every open issue carrying the `proposal` label (23) and every open
 * issue carrying `approved` (11) is here, which is why the counts on the
 * Overview and Process Map agree with them. The Closed tab is the ten
 * most-recently-closed ideas, the same newest-first slice the live route
 * returns. The Learnings markdown is that
 * repo's committed `LEARNINGS.md`; the loop config is its committed
 * `.github/loop-config.json`; the reporter digest is a real pull from the same
 * feeds the live Reporter reads. See `lib/demo/world.ts` for why this is a
 * frozen snapshot rather than a live read.
 *
 * When you edit this file: copy from the repo, never paraphrase. If a real item
 * reads badly, LEAVE IT OUT — do not improve it. And re-run the credential grep
 * listed in world.ts over anything new.
 */

import type { DemoFixture } from "@/lib/demo/types";
import type { DuplicateReport } from "@/lib/dedup/queue-duplicates";
import { DEMO_IDEA_NUMBERS, DEMO_SHAS, DEMO_CAPTURED_AT } from "@/lib/demo/world";
import type { IdeasPayload, IdeaSummary, ThreadComment } from "@/lib/queues";
import { loopConfigFingerprint, type LoopConfig } from "@/lib/loop-config";
import type { LearningsPayload, RetroCommit } from "@/app/api/learnings/route";
import type { ServedDigest } from "@/lib/reporter";
import type { DigestItem, SourceStatus } from "@/lib/reporter-types";

/* ------------------------------------------------------------------ */
/* Ideas                                                               */
/* ------------------------------------------------------------------ */

const IDEAS: Record<number, IdeaSummary> = {
  118: {
    number: 118,
    title: "Teach the app to copy your videos people actually WATCH — not just the ones that got shown",
    body: `## The problem in one line
The app's "learn from your winners" feature copies whichever videos got the most **views** — but YouTube pays and promotes based on whether people actually **watch to the end**, and the app is throwing that watch data away even though it already collects it.

## What's happening today
Every so often the app looks at your published videos, picks the "winners," and writes a note back to each AI agent telling it "make more like these." The next video is nudged toward those winning styles. Good idea — but it ranks winners by **raw view count only**.

The catch: a video can get lots of views because YouTube *showed* it to lots of people, then most of them swiped away in 2 seconds. That's not a winner — that's a video the algorithm will quietly stop promoting. If the app keeps copying those, it's learning the wrong lesson and slowly steering every channel toward videos that get shown but not watched.

**The kicker:** the app is *already downloading* the "what % of the video people watched" number from YouTube on every refresh and saving it — it just never uses it when picking winners. The good data is sitting right there, unused.

- Evidence in our own code: \`src/lib/tools/analytics.ts:76\` fetches \`averageViewPercentage\` from YouTube and \`analytics.ts:85\` saves it as \`avgWatchPct\` (also stored on the database, \`prisma/schema.prisma:193\`).
- Where it gets ignored: \`src/lib/tools/winnerDigest.ts:19-23\` only keeps \`views\`, and \`winnerDigest.ts:43\` ranks winners purely by \`b.views - a.views\`. Watch percentage never enters the decision.

## Why this matters for getting monetized
YouTube's 2025–2026 Shorts system rewards **retention / engaged views**, not raw impressions — and only "engaged views" count toward the monetization threshold:
- "Retention is king in Shorts… new thresholds ~65% for sub-30s, 50% for 30–60s." — https://www.shortimize.com/blog/youtube-shorts-retention-rate
- "Only 'Engaged views' (meaningful watch time + interaction) count for YPP eligibility and ad revenue." — same source
- Average view duration is "what the algorithm actually cares about." — https://virvid.ai/blog/average-view-duration-vs-retention-youtube-2026

So the single fastest way to get the channel monetized is to make more of the videos people *finish* — which is exactly the signal we're currently ignoring.

## What to build
- Carry \`avgWatchPct\` through the winners loop (add it to \`VideoPerf\` and the query in \`refreshAgentMemories\`).
- Rank winners by a retention-aware score (e.g. weight watch % alongside views, or lead with watch % once there's enough data), and word the plain-English digest around it ("hooks that keep people watching to the end").
- Feed that into the same agent-memory note the script stage already reads, so future videos are biased toward the ones that *hold* viewers.
- Keep the current views-based behavior as a fallback for brand-new channels that don't have watch data yet.

This is a small, self-contained change to an existing feature — no new APIs, no new cost, and \`buildDigestText\` is already a pure, unit-tested function so it's easy to test.

## Effort
**S–M** — one file's logic plus the query that feeds it; data and plumbing already exist.

## How we'd know it worked
The winners digest written to each agent ranks/describes videos by how much of them people watched (not just view count), and a unit test proves a high-views/low-retention video no longer outranks a lower-views/high-retention one.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/118",
    createdAt: "2026-07-23T18:24:38Z",
    updatedAt: "2026-07-23T18:24:39Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  115: {
    number: 115,
    title: "Stop re-buying the same AI images every video — cache & reuse atmospheric stills to cut the image bill",
    body: `**Type:** Cost saving · **Effort: S/M**

## The opportunity
Every true-crime / history video pays to generate atmospheric AI still images (~$0.04 each on OpenAI's \`gpt-image-1\`). But those images are **thrown away after one video and re-bought from scratch on the next run** — even when the prompt is identical. Stock video clips already avoid this with a reuse cache; AI stills don't. Adding the same cache would cut a recurring bill on repeated imagery to near-zero, with zero change to the finished videos.

## Why the images repeat (verified in code)
The still prompt is built from a small, generic vocabulary, so the same handful of images recur across many videos:
- \`src/lib/truecrime/aiStill.ts:76-79\` — the prompt is just \`"<visual cue>. <fixed style>. <fixed negative constraints>"\`.
- \`src/lib/truecrime/aiStill.ts:41-44\` — a **fixed** \`SAFE_STYLE\` and \`NEGATIVE_CONSTRAINT\` are appended to *every* prompt.
- The visual cues collapse into ~15 generic themes ("empty courtroom", "dark foggy forest", etc.), so the effective set of distinct prompts is tiny and highly repeatable across episodes.

## Why it's not cached today (verified in code)
- AI stills write to a **videoId-scoped** path and re-bill on every run:
  \`src/lib/truecrime/aiStill.ts:238-247\` → \`media/<videoId>/ai-NN.jpg\`, then \`logCost(..., 0.04)\` on every generation. Nothing looks for an existing image with the same prompt.
- Stock clips, by contrast, **do** have a cross-run reuse cache keyed by source+id:
  \`src/lib/truecrime/stockFootage.ts:243-263\` → \`findCachedClip(...)\` returns the existing file instead of re-downloading, otherwise \`recordStockClip(...)\` saves it for next time.

So the pattern to copy already exists in the same folder — this is bringing AI stills up to parity with stock footage.

## What to build
Cache generated stills by a **prompt-hash** (prompt + style + provider/model), storing them outside the per-video folder (e.g. \`media/ai-cache/<hash>.jpg\`) plus a small DB table mirroring \`StockClip\`. On generate: hash → if a cached file exists, copy/symlink it into \`media/<videoId>/ai-NN.jpg\` and skip the paid call; otherwise generate, then record it. Keep the existing keyless local-gradient fallback untouched.

## How we'd know it worked
After the first few videos, the \`CostLedger\` \`gpt-image-1\` rows per video drop toward zero for recurring themes, and a cache-hit counter climbs above zero — with no change to the images that appear in the finished videos.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/115",
    createdAt: "2026-07-23T16:48:10Z",
    updatedAt: "2026-07-23T16:48:10Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  114: {
    number: 114,
    title: "TikTok auto-publish is silently broken whenever YouTube posts first — the second platform never goes live",
    body: `**Type:** Bug — headline feature broken · **Effort: S**

## What's wrong
When a video auto-publishes and **both YouTube and TikTok are switched on**, TikTok never posts. The dashboard shows a red TikTok failure with a nonsensical reason: *"This video is 'published' — only approved videos can be published."* Auto-publishing to both platforms is a headline feature, and it's silently dead for every run where YouTube goes first (which is always — YouTube is first in the list).

## Why it happens (verified in code)
The auto-publish loop runs the platforms in order **YouTube → TikTok**, one after the other, on the *same* video (\`src/lib/tools/publish.ts:531-533\`).

1. YouTube publishes first and, on success, flips the **shared** \`Video.status\` to \`'published'\`:
   \`src/lib/tools/publish.ts:262\` → \`prisma.video.update({ ... data: { status: 'published' } })\`
2. TikTok runs next, re-reads the same video (now \`'published'\`), finds no existing TikTok post so the idempotency check passes through, then hits the guard:
   \`src/lib/tools/publish.ts:331\` → \`assertPublishable(video.status)\`
   \`src/lib/tools/publish.ts:120\` → \`const PUBLISHABLE_STATUS = 'approved'\`
3. \`'published' !== 'approved'\`, so it throws. \`computeAdapter\` catches it and \`runAdapter\` records a **failed** TikTok Post with that confusing message.

The code even has a comment (line 118) claiming *"an already-live video returns earlier via the idempotency check, so 'published' never reaches here"* — but that's only true once a TikTok post already exists. On the **first** TikTok attempt there is no TikTok post, so it does reach the guard. The reasoning is wrong, which is why the bug slipped in.

## Evidence it's real
- No test covers \`maybeAutoPublish\` in \`auto\` mode with two platforms enabled. The only publish test (\`src/lib/tools/publish.test.ts\`) exercises review-gating, which returns early before this path.
- Trace the three files above and the throw is unavoidable whenever YouTube publishes before TikTok in the same run.

## What to build
Don't gate a not-yet-posted platform on the video already being \`'published'\` by a *sibling* platform. Options: capture the pre-publish status once at the top of \`maybeAutoPublish\` and pass it to each adapter, or treat \`'published'\` as publishable for a platform that has no live post yet (the per-platform idempotency check already prevents double-posting). Add a test: auto mode, both platforms on → both get a live Post.

## How we'd know it worked
An \`autonomy=auto\` run with YouTube + TikTok both enabled produces a **live** TikTok Post (not a failed one), and the new two-platform test passes.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/114",
    createdAt: "2026-07-23T16:47:50Z",
    updatedAt: "2026-07-23T16:47:51Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  110: {
    number: 110,
    title: "The crash-recovery safety net can wrongly kill a video that's still rendering — and make you pay to render it twice",
    body: `## What to build
Give the crash-recovery sweeper a safety margin so it can't kill a video that is *legitimately still rendering*. Right now the sweeper's "this run is dead, mark it failed" timeout is set to the **exact same 30 minutes** that a render is *allowed* to take — so a slow-but-healthy render can be declared "failed" at the very moment it's about to finish.

## Why it matters to the product's success
The recovery sweeper exists to rescue runs orphaned by a crash. But its cutoff and the render budget are identical:

- \`src/lib/recovery.ts:19\` — \`DEFAULT_STUCK_TIMEOUT_MS = 30 * 60_000\` (mark anything in flight >30 min as "failed").
- \`src/lib/truecrime/orchestrator.ts:388\` — \`STAGE_TIMEOUT_MS = { assemble: 30 * 60_000 }\` (a render is *allowed* 30 min; the code comment says assemble "gets extra headroom … incl. the one-time Chromium download"). The sports pipeline grants the same headroom (\`src/lib/orchestrator.ts:241\`).

With **zero margin** between "allowed to take 30 min" and "killed at 30 min," a genuine long render — plausible on the first Remotion render (one-time Chromium download) or a slower machine — gets swept to \`failed\` while ffmpeg/Remotion is still actively encoding. The video row only stamps its timestamp when rendering *starts* (\`src/lib/recovery.ts:88-94\` sweeps on \`updatedAt\`), so the sweeper can't tell "still working" from "actually dead."

Two harms:
1. The owner sees a **false "failed"** on a video that was about to succeed.
2. If he re-triggers it (the whole point of the "interrupted — re-run?" UX), he pays for a **second full render + TTS + image generation** on a video that would have finished on its own — real, avoidable spend.

This is distinct from proposal #102 (which *relies on* this same 30-min sweeper as its safety net for a hung sports fetch). This proposal fixes the sweeper itself so it doesn't misfire on healthy renders.

## Evidence (from this repo)
- \`src/lib/recovery.ts:19\` and \`src/lib/truecrime/orchestrator.ts:388\` — the two 30-minute values that must not be equal.
- \`src/lib/recovery.ts:14-16\` — the code's own comment admits a too-tight timeout causes a false-positive and hopes it "self-heals," which still surfaces a wrong "failed" and invites a double-spend re-run in the meantime.

## Effort
**S** — raise the recovery cutoff comfortably above the longest stage budget (e.g. 45–60 min), and/or "heartbeat" the video's \`updatedAt\` periodically during assemble so recovery can distinguish a live render from a dead one.

## How we'd know it worked
A test with a 29-minute-old \`rendering\` video (assemble budget 30 min) confirms the sweeper leaves it alone; a real ~25–30 min first render completes and publishes without ever flipping to "failed" mid-render.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/110",
    createdAt: "2026-07-23T03:25:15Z",
    updatedAt: "2026-07-23T03:25:15Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  109: {
    number: 109,
    title: "Your sports videos skip the 'will this get demonetized?' safety check that true-crime and history already run",
    body: `## What to build
Run the same advertiser-friendliness / demonetization safety check on **sports** videos that the true-crime and history factories already run. Right now sports videos are only checked for **copyright** (which league clip, whose music) — nothing checks whether the *content itself* is the kind YouTube quietly strips ads from: fight/injury-focused highlights, gambling/betting odds overlays, or graphic content. Those videos can auto-publish and silently earn **$0**.

## Why it matters to the product's success
YouTube's "limited ads" state (the yellow dollar icon) zeroes out ad revenue on a video **even after your channel is monetized** — a 100% loss on views you were counting on. Two of the three factories are already protected from this; sports, one of your highest-volume factories, is not. Sports content is exactly where this bites: "hardest hits" / injury highlights and betting-odds overlays are staple sports-shorts formats, and YouTube **tightened its gambling-content rules in Nov 2025**, so betting-adjacent sports content is a live, current demonetization risk.

The good news: **the gate already exists in your code** — it just isn't wired to sports. So this is porting existing, tested logic to one more factory, not building something new.

## Evidence (from this repo)
- \`src/lib/compliance/gate.ts:39\` — \`gateVideoScript\` runs \`evaluateCaseSelection\`, which blocks/warns on gore and permanently-demonetized subject matter. True-crime and history both call this: \`src/lib/truecrime/orchestrator.ts:2\` and \`src/lib/history/orchestrator.ts:12\` (\`import { gateVideoScript ... }\`).
- \`src/lib/compliance/caseSelection.ts:8-20\` — the existing advertiser-friendly rules (permanent-demonetize list + gore heuristics), with a comment noting "gore is not advertiser-friendly on any topic."
- \`src/lib/orchestrator.ts:8\` — the **sports** orchestrator imports only \`gateSportsCopyright\` (a copyright gate). It never calls \`gateVideoScript\` / \`evaluateCaseSelection\`. There is **no** advertiser-friendly, injury, or gambling check anywhere in the sports path (confirmed: a repo-wide search for \`advertiser\`/\`gambling\`/\`injury\` outside \`src/lib/compliance\` returns nothing).

## Effort
**S–M** — reuse the existing \`evaluateCaseSelection\` pattern (or a small sports profile of it: injury/fight + gambling/betting terms) at the sports script/topic stage, and add a sports-specific term list. No new subsystem.

## How we'd know it worked
A test sports script that focuses on a fight/injury or shows betting odds gets flagged for review (or blocked) instead of auto-publishing; in normal operation the rate of sports videos landing in YouTube "limited ads" trends toward zero.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/109",
    createdAt: "2026-07-23T03:24:54Z",
    updatedAt: "2026-07-23T03:24:55Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  103: {
    number: 103,
    title: "Add a high-paying niche (money/business explainers) — same effort per video, 2-4x the ad rate",
    body: `## What to build
Stand up one new "factory" in a **high-RPM niche** — personal finance / business / tech explainers — reusing the exact same pipeline (source → script → assemble → publish). It's a new topic seed plus turning on the existing claims/compliance safeguards; no new video technology.

## Why it matters
The current niches (sports, true crime, history) sit in the low-to-mid advertiser tier. Finance/business content earns **2-4x more per identical view**: reported finance Shorts CPM ~\\$4.50 vs ~\\$1.20-\\$2.00 for entertainment, and finance long-form RPM \\$12-\\$45. Same production cost, multiples of the ad revenue — plus far more valuable affiliate/sponsor categories (brokerages, cards, SaaS). YouTube confirmed (May 2025) that US Shorts revenue-per-watch-hour now matches long-form, so *which niche you're in* matters more than ever.

This is different from the "earnings-by-niche dashboard" proposal (#72, which only *measures* niches) — this *adds* a structurally higher-earning one. Skeptic's note: finance is "your money/your life" content, so it must run with the existing claims-safety layer on (\\\`src/lib/compliance/claims.ts\\\` already exists) and should not be the only niche.

## Evidence
- RPM by niche (finance top tier): https://vidiq.com/blog/post/most-profitable-youtube-niches/
- Finance-niche RPM data: https://outlierkit.com/blog/youtube-rpm-finance-niche
- Codebase: the pipeline is niche-agnostic (see \\\`src/lib/history/\\\` added as a niche the same way) and \\\`src/lib/compliance/claims.ts\\\` already handles factual-claim safety.

## Effort
**M** — a new topic-seed/factory config wired to the existing pipeline and compliance/claims module.

## How we'd know it worked
The new factory produces publishable finance/business shorts through the normal pipeline, with the claims safeguard active, and (once measured) shows a higher RPM than the entertainment niches.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/103",
    createdAt: "2026-07-22T15:14:19Z",
    updatedAt: "2026-07-22T15:14:20Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  102: {
    number: 102,
    title: "A stalled sports data fetch can freeze a video run for 30 minutes — add the same timeout the true-crime pipeline already has",
    body: `## What to build
Wrap each stage of the **sports** pipeline in a wall-clock timeout, and give the Ball Don't Lie sports-data fetch a hard timeout — the same protection the true-crime pipeline already has but the sports one is missing. If a stage hangs, it should fail fast and retry instead of sitting frozen.

## Why it matters
The true-crime pipeline wraps every stage attempt in \\\`withTimeout\\\` (\\\`src/lib/truecrime/orchestrator.ts:338\\\`) precisely to stop the "round-6 hang" — but that fix was never applied to sports. The sports orchestrator's \\\`stage()\\\` (\\\`src/lib/orchestrator.ts:236\\\`) has **no timeout**, and its data call \\\`bdlFetch\\\` (\\\`src/lib/balldontlie.ts:40-43\\\`) does a plain \\\`fetch\\\` with **no AbortController/timeout** (compare \\\`src/lib/truecrime/archiveFootage.ts:53\\\`, which sets \\\`METADATA_TIMEOUT_MS\\\`). So if the sports API stalls, a run sits stuck in "running" until the 30-minute stuck-run sweeper (\\\`src/lib/recovery.ts:19\\\`) eventually kills it — half an hour of nothing happening, which for a solo owner looks like "the app is broken."

This fits the reliability work already merged (recover stuck runs, queued-videos-no-longer-stuck) and is not covered by any open proposal.

## Evidence
- \\\`src/lib/orchestrator.ts:236\\\` — sports \\\`stage()\\\`, no timeout wrapper.
- \\\`src/lib/balldontlie.ts:40-43\\\` — \\\`fetch\\\` with no timeout/AbortController.
- \\\`src/lib/truecrime/orchestrator.ts:338\\\` and \\\`src/lib/truecrime/archiveFootage.ts:53\\\` — the timeout pattern that sports is missing.

## Effort
**S** — reuse the existing \\\`withTimeout\\\` helper and add an AbortController to \\\`bdlFetch\\\`.

## How we'd know it worked
A deliberately slow/hung sports-data response makes the run fail and retry within seconds, instead of hanging until the 30-minute recovery sweep.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/102",
    createdAt: "2026-07-22T15:14:06Z",
    updatedAt: "2026-07-22T15:14:07Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  101: {
    number: 101,
    title: "Auto-make a click-worthy thumbnail for each video — right now there isn't one",
    body: `## What to build
Generate a proper, click-optimized **thumbnail** as part of the pipeline: a high-contrast image with a short bold text overlay pulled from the video's hook/title, sized correctly for YouTube. Today the app only keeps a raw still frame (\\\`Video.thumbnailPath\\\` exists in the schema, and \\\`src/lib/truecrime/visuals.ts\\\` makes slideshow stills), but nothing produces a *designed, click-worthy* thumbnail — and a non-technical owner has no way to make one by hand.

## Why it matters
On YouTube the thumbnail is the **single biggest lever on click-through rate** — a good one can multiply views on identical content. This matters even more because there's already a filed proposal (#87) to compile each week's shorts into a **long-form YouTube video** for real monetization: a long-form upload with no compelling thumbnail is dead on arrival. Competitors (faceless.video, Crayo) generate thumbnails automatically as a standard pipeline step; this app doesn't, which is a visible gap.

This is distinct from the hook-score work (#89, which grades the first 3 seconds of the *video*) — this is about the still image people click *before* they watch.

## Evidence
- Competitor auto-thumbnail feature: https://facelessclip.ai/
- Codebase: \\\`grep -rn "thumbnail" src\\\` shows only raw stills / byte-size checks — no designed-thumbnail generation exists.

## Effort
**M** — reuse an existing still or AI image, add a bold text overlay (ffmpeg/Remotion, both already in the stack), save to \\\`thumbnailPath\\\`, and pass it to the YouTube upload.

## How we'd know it worked
Every finished video has a generated thumbnail with readable overlaid text, and the YouTube upload uses it instead of an auto-picked frame.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/101",
    createdAt: "2026-07-22T15:13:55Z",
    updatedAt: "2026-07-22T15:13:56Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  100: {
    number: 100,
    title: "Give YouTube and TikTok their own copy of each video, so they stop burying it as 'reused content'",
    body: `## What to build
When the app posts the same short to both YouTube Shorts and TikTok, it currently uploads the **same rendered file** to both. Platforms detect a re-used/downloaded file (by its embedded metadata fingerprint, and by any baked-in platform watermark) and quietly show it to far fewer people. We should give each platform its **own uniquely-encoded copy**: strip/refresh the file's metadata, make sure no foreign watermark is baked in, and re-encode a clean per-platform master before upload. A quick pre-publish check should also confirm the file we're about to post has no other platform's watermark on it.

## Why it matters
This is one of the most-cited reasons creators' cross-posts "flop." A widely-shared comparison: a watermarked TikTok re-posted to Shorts averaged **~450 views**, vs **~12,000 views** for a clean native master of the *same* video — a ~25x difference. YouTube itself says non-original-looking uploads get suppressed: *"Uploading content with visible watermarks signals to YouTube that this isn't original… even if it's your own content."* Because this app auto-publishes to **both** platforms, it's walking straight into this penalty on every video.

This is **not** the same as the existing "duplicate video" proposal (#71, which stops the *same* video going out *twice*) or the "blurry export" proposal (#76, which is about resolution/quality). This is about each platform seeing a distinct, clean, native-looking file.

## Evidence
- Watermark/metadata reach penalty: https://joyspace.ai/stop-reposting-tiktoks-watermark-detection
- YouTube reused-content policy: https://vidiq.com/blog/post/youtube-reused-content-policy-guide/
- Codebase: no metadata-stripping or per-platform re-encode exists — grep for \\\`map_metadata\\\`/\\\`watermark\\\` across \\\`src/\\\` returns nothing; both platforms are handed the same output path.

## Effort
**M** — a per-platform export step (ffmpeg metadata strip + light re-encode) plus a pre-publish watermark sanity check.

## How we'd know it worked
The same short posted to YouTube and TikTok arrives as two byte-different files with clean metadata and no foreign watermark, and cross-posted videos stop showing the tell-tale ~20x view gap versus a fresh upload.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/100",
    createdAt: "2026-07-22T15:13:44Z",
    updatedAt: "2026-07-22T15:13:45Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  89: {
    number: 89,
    title: "You already score each video's hook — use it to skip publishing the ones likely to flop",
    body: `## What to build
Use the **hook strength score the app already computes** to hold back likely-dud videos *before* spending money to render and publish them. If a video's best available opening line scores below a threshold, either regenerate the hook or flag the video for review instead of auto-posting it.

## Why it matters
The opening 3 seconds is the single biggest driver of whether a short gets views. The app already predicts a 0-100 hook score for every video but currently just **stores it and does nothing with it** — so weak-hook videos still get fully rendered and published, burning AI/footage/quota cost on content that was predictably going to flop. Competitors (Opus Clip, Vizard) gate auto-posting on exactly this kind of score.

## Evidence
- The score already exists and is saved per video: \`src/lib/tools/hookScore.ts\` (\`scoreHook\`, \`pickBestHook\`), stored via \`src/lib/orchestrator.ts:100\` (\`hookScore\`).
- The code even says so: \`hookScore.ts:15\` — *"the foundation (hookScore + hookStyle per video) so that loop can close later."* This proposal is closing that loop.
- Industry: "clips scoring above 70 outperform those below 50 by an average of 3x." — https://www.podposted.com/resources/opus-clip ; Vizard lets you "set a minimum viral score for clips to be posted" — https://help.vizard.ai/en/articles/10848181-auto-schedule-post-ai-clips

## Effort
**S** — add a configurable minimum-hook-score gate in the publish/auto-publish path using the value that's already computed.

## How we'd know it worked
A video whose best hook scores below the threshold is regenerated or held for review instead of being auto-published, and the owner can set the threshold.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/89",
    createdAt: "2026-07-20T16:35:42Z",
    updatedAt: "2026-07-20T16:35:42Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  87: {
    number: 87,
    title: "Turn each week's shorts into one long YouTube video — 50-200x the pay, and the only real path to getting monetized",
    body: `## What to build
Automatically stitch each week's short videos (per niche) into **one long-form YouTube upload** — an 8-12 minute "Top true-crime cases this week" / "This week in history" compilation with a simple intro and outro — from clips the app already rendered.

## Why it matters (this changes the money ceiling by an order of magnitude)
- Long-form YouTube pays roughly **50-200× the RPM of Shorts** on the same true-crime content ($4-$10 per 1,000 views vs $0.03-$0.12 for Shorts).
- It's also the **realistic path to actually getting monetized**: YouTube's easier eligibility route is 1,000 subs + **4,000 long-form watch hours** — and Shorts views do *not* count toward those watch hours. A single weekly 8-10 minute compilation compounds watch hours in a way the current Shorts-only output never will.
- Marginal cost ≈ **$0**: the narration, clips, and captions are already produced per Short. This is a stitch-and-upload stage, not new generation.

## Evidence
- "True crime Shorts earn $0.03-$0.12 RPM versus $4-$10 for long-form." — https://fluxnote.io/guides/youtube-shorts-rpm-true-crime-niche
- "Shorts RPM is 3-14% of long-form." — https://fluxnote.io/guides/youtube-long-form-vs-shorts-revenue
- YouTube Partner Program: 1,000 subs + 4,000 *long-form* watch hours (Shorts excluded) is the standard route to monetization.

## Effort
**M** — group the week's finished videos by niche, concatenate with a title card/outro, generate a long-form title/description, and upload.

## How we'd know it worked
Once a week the app produces and uploads a single long-form compilation per active niche, and YouTube Studio starts accruing long-form watch hours toward the 4,000-hour threshold.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/87",
    createdAt: "2026-07-20T16:35:33Z",
    updatedAt: "2026-07-20T16:35:34Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  86: {
    number: 86,
    title: "Check every video against YouTube's 2026 'AI slop' demonetization rules BEFORE it posts",
    body: `## What to build
A pre-publish **"will YouTube consider this original enough to monetize?"** check, mapped to YouTube's July 2025 *inauthentic / mass-produced content* rules. Before a video goes out, score it against the specific things YouTube now demonetizes — near-identical templates video-to-video, AI narration over loosely-related stock with no added insight, minimal variation between uploads — and warn/hold the ones most likely to be flagged.

## Why it matters
This is an **existential** risk, not a nice-to-have. In July 2025 YouTube renamed its rule to "inauthentic content" and began demonetizing exactly the profile of an automated faceless channel: AI voiceover + stock footage + repeated templates. Creators are getting kicked out of the Partner Program overnight. The owner isn't monetized yet, so shipping straight into this policy could mean he never gets approved at all.

## Evidence
- "The 'inauthentic content' rule demonetizes videos that are mass-produced, repetitive, or lack original insight, especially those relying on AI narration without human context… targets: AI voiceovers with no commentary, slideshow compilations, Shorts with minimal variation." — https://www.startsmartcounsel.com/resource-center/youtubes-july-2025-demonetization-policy-update-a-scholarly-analysis-of-authenticity-in-platform-governance
- "Relying solely on generic stock footage compilations with an AI voiceover is a common reason channels are rejected from the YPP for 'reused content.'" — https://vidiq.com/blog/post/youtube-reused-content-policy-guide/
- The app already has variation logic (\`src/lib/compliance/variation.ts\`, \`src/lib/truecrime/styleVariation.ts\`) but it isn't mapped to YouTube's monetization buckets or surfaced as a go/no-go readiness signal.

## Effort
**M** — a scoring gate that compares a new video against recent ones (script/structure/visual similarity) and checks for the specific policy triggers, surfaced as a readiness score with reasons.

## How we'd know it worked
Before publishing, the owner sees a clear "monetization-risk" score with the reasons (e.g. "94% structurally identical to your last 5 videos"), and near-duplicate uploads get held instead of auto-posted.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/86",
    createdAt: "2026-07-20T16:35:31Z",
    updatedAt: "2026-07-20T16:35:32Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  85: {
    number: 85,
    title: "The dashboard's \"$ cost\" isn't real money — label it as an estimate and fix the blank sports figure",
    body: `## First — your question answered (no real money is being taken)

You asked: *"what money is being spent, what have I linked up account-wise, and where is the money being taken from?"* Straight answer:

- **Nothing is charged per video, and no payment account is linked inside this app.** There is no card, no bank, no Anthropic billing account wired into the platform. It can't take money from anywhere.
- The **"$" figures on the dashboard are estimates, not bills.** Every time the app calls Claude to write or narrate a video, it records how many words (tokens) that used, then multiplies by Anthropic's *public list price* to show "if you were paying per use, this is what it'd cost."
- Because you're on the **Claude Max 20× flat plan**, that usage is already covered by your monthly subscription. The estimate is a *yardstick to compare niches*, not money leaving your pocket.

So the honest fix here isn't just "make sports show a number" — it's **stop the number from looking like a live bill**, and make all niches consistent.

## What to build

Two small things, together:

1. **Label the figure honestly.** Rename the dashboard metric from a bare "$ cost" to something like **"Est. usage (at list price)"** with a one-line tooltip: *"Estimated token cost at Anthropic's public rates — covered by your Max plan, not a charge."* So you're never alarmed by it again.
2. **Fix the sports blank.** Sports videos currently show nothing at all, while true-crime and history show an estimate — an inconsistent, misleading gap. Roll the sports ledger rows up onto the video the same way the other niches already do, so every niche reports the same honest estimate.

## Why it matters

The spend tracker only earns its place if you trust it. Right now it does the opposite of building trust: it shows scary dollar signs that read like real charges, **and** it's blank for sports so you can't even compare niches. Fixing both turns it into what it was meant to be — a simple "which niche uses the most AI" gauge you can glance at without worry.

## Evidence

- The figures are **computed estimates, not charges**: \`claudeCallCost()\` multiplies token counts by list price (\`src/lib/settings.ts:83-108\`, comment: *"USD per input/output token"*). Nothing in the app connects to a payment provider.
- True-crime/history roll ledger rows into \`Video.costEstimate\` (\`src/lib/truecrime/orchestrator.ts:295-304\`); the **sports** orchestrator (\`src/lib/orchestrator.ts\`) has no equivalent step, so its \`costEstimate\` stays null.
- The dashboard only renders the figure when non-null (\`inbox-card.tsx:222\`, \`page.tsx:486\`) — hence sports shows blank — with no wording that says "estimate."

## Effort

**S–M** — the sports roll-up reuses the existing pattern (S); the honest re-label + tooltip is a small UI copy change (S).

## How we'd know it worked

A new sports video shows the same estimated figure the other niches do, **and** that figure is clearly labelled as an estimate covered by your plan — so glancing at the dashboard tells you which niche uses the most AI, with zero worry that money is being taken.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/85",
    createdAt: "2026-07-20T16:35:29Z",
    updatedAt: "2026-07-21T18:46:09Z",
    commentCount: 2,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  84: {
    number: 84,
    title: "A blank BLACK video with just narration can auto-publish to YouTube — catch it before it goes live",
    body: `## What's wrong
If the app can't find or render **any** imagery for a true-crime/history video (network hiccup, missing API key, all footage sources fail), it doesn't stop — it falls back to a **solid black screen** with the narration playing over it, marks the render "successful," and for an auto-posting factory it can **publish that black video to YouTube**. Nobody is told the imagery was missing.

## Why it matters
A black video with a voice over it is the single most embarrassing thing that can go public on the owner's channel, and it's exactly the kind of "AI slop" that gets channels demonetized. Worse, it happens *silently* — the run looks green, so the owner never knows to pull it.

## Evidence
- \`src/lib/truecrime/assemble.ts\` (\`renderColorClip\`, ~lines 99-111 / 227-233) produces a solid dark 1080×1920 clip and returns \`rendered: true\` when all image sourcing fails.
- The "is this an empty render?" guard (\`src/lib/pipeline/finalize.ts:23\`) only checks for a missing/empty file — a valid black MP4 passes it — so the compliance and silent-voice gates all pass and the video is eligible for auto-publish.
- No Job/error row is written, so there's no signal to the owner that the visuals were missing.

## Effort
**S/M** — detect the "all imagery failed → color fallback" case and either block auto-publish + flag for review, or record a visible error.

## How we'd know it worked
When every image source fails, the video is held for review with a clear "no visuals — needs attention" flag instead of silently publishing a black screen.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/84",
    createdAt: "2026-07-20T16:35:22Z",
    updatedAt: "2026-07-20T16:35:22Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  83: {
    number: 83,
    title: "You're posting to TikTok but never measuring it — pull TikTok view counts so it can win too",
    body: `## What to build
Pull view/like counts for videos posted to **TikTok**, the same way the app already does for YouTube, so TikTok videos actually get performance numbers.

## Why it matters
Right now the app publishes to TikTok but **never measures it**. Every TikTok video shows 0 views forever, can never appear on the Winners leaderboard, and the owner has no way to tell what's working on TikTok. Since half the strategy is TikTok, the owner is flying blind on half his output — and every future "double down on what wins" or "revenue by niche" feature is only seeing YouTube.

## Evidence
- \`src/lib/tools/analytics.ts\` is entirely YouTube — it calls \`google.youtube\` / \`google.youtubeAnalytics\` and the platform is effectively hard-wired to \`'youtube'\` (lines ~69, 125). There is no TikTok metrics path anywhere.
- TikTok publishing already exists (\`src/lib/tiktok.ts\`, \`src/lib/tools/publish.ts\`), so we're posting but not reading back.
- Two independent research passes flagged this as the foundational gap that makes the Winners board and any performance feedback loop "half-blind."

## Effort
**M** — add a TikTok metrics fetch (Display/Data API) and write \`Metric\` rows for TikTok posts on the existing refresh cycle.

## How we'd know it worked
A video published to TikTok shows real view counts in the app within a day of posting and becomes eligible for the Winners leaderboard.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/83",
    createdAt: "2026-07-20T16:35:20Z",
    updatedAt: "2026-07-20T16:35:20Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  79: {
    number: 79,
    title: "Auto-add your links (affiliate/product) to every video's description — earn before you're monetized",
    body: `## What to build
Add a per-factory template for the video **description and pinned comment** — with your affiliate/product links, a disclosure line, and automatic tracking tags (UTMs) — filled in automatically on every post. Add a small tab that ties link clicks back to the video/niche that drove them.

## Why it matters
For faceless channels, ad revenue is only 30–50% of income; the rest is affiliate and product links. Crucially, description links **earn regardless of monetization status** — they make money *before* you've hit YouTube's or TikTok's payout thresholds, which is exactly the phase a growing channel is in. A single affiliate link on a channel doing 100k views/mo is commonly cited at $500–$2,000/mo. This is the best dollar-per-effort revenue lever available and is distinct from the on-screen CTA overlay already in flight (that's the visual overlay; this is the link/description/attribution layer).

## Evidence
[Faceless monetization breakdown — ads are 30–50% of income](https://www.overseeros.com/blog/faceless-youtube-monetization); [affiliate $500–2,000/mo per link](https://fluxnote.io/guides/how-much-do-faceless-youtube-channels-make-guide-2026). We currently auto-fill no description/link block.

## Effort
**S**

## How we'd know it worked
Every published video carries the right description + pinned-comment block with working, UTM-tagged links, and you can see which niche drove the most clicks.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/79",
    createdAt: "2026-07-20T14:22:11Z",
    updatedAt: "2026-07-20T14:22:12Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  78: {
    number: 78,
    title: "Write titles & hashtags tuned to each platform, not one identical set for all three",
    body: `## What to build
Generate the title, description, and hashtags **separately for each platform** instead of reusing one identical set everywhere. YouTube Shorts rank on keyword-rich descriptions; TikTok wants a few niche hashtags with the hook in the caption; Reels wants a shorter caption with different tags.

## Why it matters
Free discovery. The same words that help you get found on YouTube actively work against you on TikTok/Reels. Shipping one identical blob to all three leaves impressions on the table on two of the three platforms — at zero extra cost per video.

## Evidence (this is real, in our own code)
The script tool produces a single \`title\`/\`description\`/\`hashtags\` set (\`ScriptResult\` in \`src/lib/tools/script.ts\`) that publish reuses for every platform. Opus Clip's paid product generates "platform-specific captions, hashtags, and titles for each" destination — it's a standard, valued feature.

## Effort
**S / M**

## How we'd know it worked
One generated video ships with distinct, platform-appropriate titles/descriptions/hashtags to YouTube, TikTok, and Reels.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/78",
    createdAt: "2026-07-20T14:22:09Z",
    updatedAt: "2026-07-20T14:22:10Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  76: {
    number: 76,
    title: "Videos look blurry after upload — add clean per-platform export settings",
    body: `## What to build
Add clean per-platform export settings so videos don't look blurry or washed-out after uploading. Force 1080×1920, 30/60fps, a sensible bitrate (~12 Mbps), standard (non-HDR) colour, and the right pixel format — one clean encode per destination.

## Why it matters
Soft, grainy, or washed-out footage reads as low-effort in the feed, depresses watch time and click-through, and creators almost always blame "the algorithm" when it's actually a bad export the platform then re-compresses even harder. This is one of the most-searched creator frustrations and it's a cheap, pure-pipeline fix.

## Evidence
Creators repeatedly report AI-tool exports (odd HDR, oversized, wrong bitrate) getting crushed by TikTok/IG re-compression: "If you upload a 4K file, TikTok's servers down-size it heavily… artifacts and blur"; the converged fix is "export at 1080p, 30/60fps, ~10–15 Mbps." (TikTok "why is my quality bad after posting" discovery pages.) Our assemble step outputs a single generic MP4 with no per-platform encode profile.

## Effort
**S**

## How we'd know it worked
A rendered video uploaded to each platform looks as sharp on-platform as it does locally (no visible softening/washout).
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/76",
    createdAt: "2026-07-20T14:21:59Z",
    updatedAt: "2026-07-20T14:22:00Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  75: {
    number: 75,
    title: "Your captions & call-to-action can be hidden behind TikTok/Reels/Shorts buttons",
    body: `## What to build
Keep your on-screen captions and call-to-action text out of the areas that each platform covers with its own buttons. TikTok, Reels, and Shorts each overlay their like/comment/share buttons and caption bars over different parts of a vertical video — so text sitting in the "wrong" third gets hidden. Add per-platform "safe zones" so the important text is always visible, plus a preview that shows the reserved regions.

## Why it matters
Your hook text and CTA are what stop the scroll and earn the follow/click. If they're hidden behind the platform's UI, retention and conversions silently drop and there's no error to tell you why — you just underperform.

## Evidence (two independent research passes flagged this as a top gap)
Competitors (Opus Clip, Repurpose.io) reframe text into each platform's safe zone as a core paid feature. Documented reserved regions: TikTok ~130px top / ~250px bottom / ~60px sides; Reels ~108 / ~320 / ~60; Shorts avoid the bottom 10–15%. Sources: [Kreatli safe-zone guide](https://kreatli.com/blog/safe-zone-guide-instagram-reels-youtube-shorts-tiktok), [getKoro Shorts dimensions](https://getkoro.app/blog/youtube-shorts-dimensions). Our pipeline renders one 9:16 file for all destinations, so text position can't be right for all three at once.

## Effort
**M**

## How we'd know it worked
Render the same video for each platform and the captions/CTA always land inside that platform's visible area (verified against an on-screen safe-zone overlay).
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/75",
    createdAt: "2026-07-20T14:21:57Z",
    updatedAt: "2026-07-20T14:21:58Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  74: {
    number: 74,
    title: "A TikTok video can show 'Posted' when it never actually went live — and never retries",
    body: `## What to build
Stop marking a TikTok video as "Posted" when it was only *accepted for processing* and may still fail on TikTok's side. Only show "Posted" once TikTok confirms it's actually live, and keep it retryable until then.

## Why it matters
Today a video can show a green "Published" in your dashboard while nothing is actually on your TikTok profile — and because the app thinks it succeeded, it will **never retry it**. It's a permanent phantom success: you believe you posted, your audience sees nothing, and the app won't fix it.

## Evidence (this is real, in our own code)
\`src/lib/tiktok.ts\` \`pollStatus\` (lines 294–317) polls only 5 times over ~10 seconds, then returns \`undefined\` (a comment calls this "accepted"). \`src/lib/tools/publish.ts\` \`publishToTikTok\` (lines 277–303) then sets \`platformPostId = postId || publishId\` and flips both the Post and Video to \`status: 'published'\`. If TikTok rejects the video during its later async encode (aspect ratio, audio, policy), nothing notices — and \`isAlreadyPublished\` (publish.ts:77) now blocks any re-publish. This is separate from the TikTok login-expiry warning already in flight.

## Effort
**M**

## How we'd know it worked
A TikTok upload that isn't confirmed live shows a "processing/submitted" state (not a fake "Posted"), and can be retried or reconciled later.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/74",
    createdAt: "2026-07-20T14:21:55Z",
    updatedAt: "2026-07-20T14:21:56Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  73: {
    number: 73,
    title: "Your spend numbers can be inflated (and providers billed twice) when a step retries",
    body: `## What to build
Fix the spend tracker so a single video is never charged twice. When a generation step retries after a hiccup, it currently re-runs the paid work (voice, images) and logs the cost **again**.

## Why it matters
Two things break: (1) your spend numbers get inflated, which trips the budget cap early and cuts off production before you've actually hit your limit; (2) paid providers (premium TTS, AI image generation) can be billed twice for the same video — real money out the door.

## Evidence (this is real, in our own code)
\`src/lib/retry.ts:5\` explicitly says stage callbacks must be safe to re-run (idempotent) — but the cost writes are plain \`costLedger.create\` (not upsert) at \`src/lib/truecrime/tts.ts:292\`, \`truecrime/script.ts:205\`, \`truecrime/aiStill.ts:216\`, and stages also \`asset.create\`. SQLite is single-writer, so a "database is locked" error on the \`asset.create\` right after a successful paid TTS call (\`src/lib/truecrime/orchestrator.ts\` ~line 192) forces the whole stage to retry — re-charging the voice and writing a second ledger row.

## Effort
**M**

## How we'd know it worked
Force a mid-stage retry in a test and the video ends up with exactly one cost row per paid step (no double charge).
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/73",
    createdAt: "2026-07-20T14:21:52Z",
    updatedAt: "2026-07-20T14:21:54Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  72: {
    number: 72,
    title: "Show me which videos and niches actually EARN money, not just what they cost",
    body: `## What to build
Show which videos and which niches actually **earn money**. Pull real earnings from YouTube (the \`estimatedRevenue\` figure), store it per video, subtract what each video cost to make, and show profit + earnings-per-1000-views per factory (true-crime vs history vs sports).

## Why it matters
This is the core promise in your own PRD: *"tells me which formats and topics are actually earning — so I can double down on what works."* Right now the app tracks what every video **costs** (the CostLedger) and how many **views** it gets — but it never pulls a single dollar of actual **revenue**, so it can't tell you whether true-crime or history is the one worth scaling. You're flying blind on the one number the whole product exists to give you.

## Evidence (this is real, in our own code + a real API)
\`src/lib/tools/analytics.ts:76\` pulls \`views, estimatedMinutesWatched, averageViewPercentage, subscribersGained\` — but **not** \`estimatedRevenue\`, which the YouTube Analytics API exposes on the monetary scope. Cost is already tracked (\`CostLedger\`, \`prisma/schema.prisma:219\`; per-video \`costEstimate\` shown at \`src/app/page.tsx:463\`). Profit = revenue − cost is one join away and currently impossible to see.

## Effort
**M**

## How we'd know it worked
The dashboard shows, per factory, real earnings, cost, and profit-per-video — and you can point to the higher-earning niche and say "make more of that."
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/72",
    createdAt: "2026-07-20T14:21:43Z",
    updatedAt: "2026-07-20T14:21:44Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  71: {
    number: 71,
    title: "The app sometimes makes (and posts) the same video twice when two timers overlap",
    body: `## What to build
Stop the scheduler from occasionally making the same video twice (and auto-posting it twice) when two "ticks" overlap. Add an atomic "claim" so each due schedule can only be picked up once.

## Why it matters
A duplicate run wastes generation cost, burns ~1,600 units of your limited daily YouTube upload quota per extra video, and — with auto-publish on — posts the *same* video twice to your channel, which platforms treat as duplicate/spam behaviour and can penalise.

## Evidence (this is real, in our own code)
\`src/lib/scheduler.ts\` \`runDueSchedules\` (lines 95–128) finds due schedules, then inside the loop does an **unconditional** \`schedule.update\` to advance \`nextRunAt\` and calls \`executeRun\` — there is no \`where nextRunAt <= now\` guard, so it isn't an atomic claim. The app deliberately runs three overlapping tick sources: the 60-second in-process tick (\`src/instrumentation-node.ts:39\`), the external cron route (\`/api/scheduler/tick\`), and the dashboard "Run due now" button (\`src/components/schedule-manager.tsx:113\`). Click "Run due now" while the 60s tick fires and both see the same schedule before either commits → two identical videos. The code comment claiming it "won't double-run" only holds for sequential ticks.

## Effort
**M**

## How we'd know it worked
Fire two ticks at the same instant against one due schedule and exactly one run is created (proven by a test).
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/71",
    createdAt: "2026-07-20T14:21:41Z",
    updatedAt: "2026-07-20T14:21:42Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  126: {
    number: 126,
    title: "Apply the picked redesign: Style 2 \"Warm Creator\", light default, single nav",
    body: `Follow-up to #49. The three draft looks shipped in #52 as \`public/design-drafts.html\`, and the owner has now picked one. This issue is the actual rebuild — apply the chosen look to the real app.

## The pick

**Style 2 — "Warm Creator"**, with **light as the default theme** and a working dark toggle.

Use these exact tokens (copy them from the \`[data-style="2"]\` block in \`public/design-drafts.html\` — that file is the source of truth for the values, this list is a convenience copy):

**Light (default)**
- background \`#faf9f7\`
- surface \`#ffffff\`
- surface-2 \`#f5f3ef\`
- border \`#eae7e1\`
- text \`#1c1917\`
- muted text \`#78716c\`
- accent \`#6d28d9\`, accent text \`#ffffff\`, accent-soft \`#f3f0ff\`
- corner radius \`18px\`

**Dark (via toggle)**
- background \`#191614\`
- surface \`#241f1c\`
- text \`#f5f3ef\`
- accent \`#a78bfa\`

The warm cream/stone base and the soft rounded corners are the point of this look — please don't flatten them back toward neutral grey.

## Owner feedback from reviewing the drafts

The drafts page showed **two identical navigation rows** stacked on top of each other, which was genuinely confusing to look at: the top row was the preview's own style-switcher chrome, and the second row was the static mockup's nav. In the real app there must be **exactly one navigation bar**. While you are in there, honour the "fewer tabs" ask from #49 — consolidate the navigation down to the smallest set of top-level destinations that still makes sense, rather than carrying every current tab across.

## Scope

In scope:
- Apply the Warm Creator tokens to the real application shell and pages — not to the mockup file.
- Define the palette once as CSS custom properties (or the project's existing theming mechanism) so it is themeable, rather than hardcoding hex values at each call site.
- Light default, dark available via a persisted user toggle.
- Single nav bar; reduce the number of top-level tabs.
- Keep every existing feature reachable. Do not drop functionality in the name of fewer tabs — regroup it.

Out of scope (do not touch in this PR):
- The TikTok silent-posting failure that was also mentioned in #49. That is being handled separately.
- \`public/design-drafts.html\` — leave it in place as reference.

## Done means

- The running app visibly uses the warm cream/stone palette with the violet accent in light mode.
- Toggling to dark gives the warm brown-black palette, and the choice survives a reload.
- Exactly one nav bar is visible on every page, with fewer top-level tabs than today.
- No feature that worked before is now unreachable.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/126",
    createdAt: "2026-08-02T22:28:44Z",
    updatedAt: "2026-08-25T15:41:14Z",
    commentCount: 4,
    labels: ["approved"],
    author: "ApagPlayz",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  90: {
    number: 90,
    title: "Cut your AI writing bill by ~90% with prompt caching — same videos, lower cost",
    body: `## What to build
Cut the AI writing cost per video by turning on **prompt caching** (and, where possible, cheaper-model routing) on the Claude script-generation step.

## Why it matters
Every video calls Claude with a big shared system prompt (style rules, compliance instructions, format). That large block is re-sent and re-billed on every single video. Prompt caching bills the repeated part at roughly **90% less**. Since the app already defaults to free TTS (Kokoro), the Claude script call is the biggest controllable cost line — so this is the highest-leverage way to make the spend tracker's numbers go down without changing output quality at all.

## Evidence
- Anthropic prompt caching bills cached input at ~$0.30/M vs ~$3/M standard — up to 90% off the repeated portion. Stacking caching + batching + model routing is documented at 70-85% total LLM cost reduction. — https://www.morphllm.com/llm-cost-optimization
- The per-video Claude call with a shared system prompt lives in the script stage (\`src/lib/truecrime/script.ts\`, \`src/lib/tools/script.ts\`), and costs are already tracked in the \`CostLedger\` so before/after is measurable.

## Effort
**S** — mark the stable system-prompt block as cacheable in the Anthropic API call; optionally route very simple scripts to a cheaper model.

## How we'd know it worked
The Claude cost per video in the spend tracker drops materially (target: 50%+ on the input cost) with no change to script quality.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/90",
    createdAt: "2026-07-20T16:35:43Z",
    updatedAt: "2026-07-23T22:33:37Z",
    commentCount: 4,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  88: {
    number: 88,
    title: "Stop TikTok from silently shadowbanning you — human-like posting + a 'your reach just died' alert",
    body: `## What to build
Two guardrails against TikTok quietly throttling the account for looking like a bot: (1) **humanized posting** — stagger posts on believable, slightly varied times instead of bulk/identical drops, and never cross-post a byte-identical file+caption to TikTok that already went to YouTube; (2) a **reach-drop alert** — if TikTok views suddenly collapse to near-zero across posts, warn the owner that he may be shadowbanned.

## Why it matters
Shadowbans are the #1 TikTok creator complaint, and automated bulk posting + reused metadata + robotic TTS are exactly what triggers them. When it happens, reach silently drops to ~zero for **14-30 days** with **no notification** — the owner would keep posting into a void and never know. For a channel that isn't monetized yet, a month of dead reach is devastating.

## Evidence
- "Unoriginal content is a massive trigger for TikTok shadowbans… reduced reach to zero if the metadata matches an existing video." — https://later.com/blog/tiktok-shadowban/
- "Using third-party automation tools can make TikTok's system think you're a bot and trigger restrictions fast." Typical shadowban 14-30 days. — https://litcommerce.com/blog/tiktok-shadow-ban/
- "Posting identical videos on multiple accounts/platforms will result in shadowbans and low reach… rebuild a staggered calendar with different hooks, captions, sounds, and local timing." — https://www.tokportal.com/learn/tiktok-shadowban-multiple-accounts
- This pairs with the TikTok-metrics work (needed to detect the reach drop) and the scheduler already exists (\`src/lib/scheduler.ts\`).

## Effort
**M** — add jitter/spacing to the scheduler for TikTok, ensure per-platform metadata differs, and flag sudden reach collapse.

## How we'd know it worked
TikTok posts go out on staggered, human-looking times with platform-specific captions, and if views crater across recent posts the owner gets a clear "possible shadowban — pause posting" warning.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/88",
    createdAt: "2026-07-20T16:35:40Z",
    updatedAt: "2026-07-23T21:14:34Z",
    commentCount: 3,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  82: {
    number: 82,
    title: "Some sports videos silently fail to render when the AI hook has a comma or % — fix the text escaping",
    body: `## What's wrong
Some sports videos fail to render for a reason that has nothing to do with the video — it's the wording of the on-screen hook text. If the AI writes a hook containing a **comma** or a **percent sign** (e.g. *"Down 3, ice in his veins"* or *"Shot 60% from three"*), the final render step crashes and the whole video is marked failed. It retries, but every retry fails identically because the text never changes.

## Why it matters
Curiosity-gap hooks routinely use commas — they're some of the best-performing openers. So this quietly kills a chunk of good videos before they're ever made, wasting the AI + footage cost that already went into them, and the owner just sees "failed" with a cryptic error.

## Evidence (this is a real, provable bug)
- \`src/lib/tools/assemble.ts:57\` escapes the hook with only: strip \`\\\`, strip \`'\`, escape \`:\`. It does **not** handle \`,\` \`%\` \`[\` \`]\`. That text is then dropped into a comma-separated ffmpeg filter chain, so a comma inside the hook is read as a new filter and ffmpeg errors out.
- The codebase already has the correct fix sitting right next door: \`src/lib/tools/transform.ts:60\` (\`escapeText\`) strips \`,\` \`[\` \`]\` \`%\` properly. The sports assemble step just doesn't call it.

## Effort
**S** — reuse the existing \`escapeText\` helper in the sports assemble path.

## How we'd know it worked
A sports video whose hook contains a comma and a \`%\` renders successfully instead of failing, and a quick test feeding such a hook to the assemble step passes.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/82",
    createdAt: "2026-07-20T16:35:18Z",
    updatedAt: "2026-07-28T20:12:12Z",
    commentCount: 1,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  77: {
    number: 77,
    title: "Your TikTok videos are too short to ever earn — make a 60s+ cut for TikTok only",
    body: `## What to build
Add an option to render a slightly longer (~65–70 second) version specifically for TikTok, so your TikTok posts qualify for TikTok's payout program. Keep the tight 30–45s cut for YouTube Shorts and Reels where short is fine.

## Why it matters
TikTok's Creator Rewards Program **only pays on original videos longer than 1 minute.** Our pipeline targets ~30–45s outputs, which means every TikTok video you post is **structurally locked out of earning** — regardless of how well it does. This isn't a new revenue channel to build; it's removing a hard eligibility blocker on a program you're already posting into.

## Evidence
[TikTok Creator Rewards eligibility](https://www.tiktok.com/creator-academy/article/creator-rewards-program/) — "original videos longer than 1 minute." Our target length is documented as ~30–45s in \`docs/Decision-and-Cost-Guide.md\`.

## Effort
**M**

## How we'd know it worked
The TikTok-bound render comes out at 60s+ (padding/pacing, not filler) while Shorts/Reels stay short — making each TikTok post a payout candidate.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/77",
    createdAt: "2026-07-20T14:22:07Z",
    updatedAt: "2026-07-28T18:14:13Z",
    commentCount: 1,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  70: {
    number: 70,
    title: "Video preview won't play on Mac/iPhone — you can't reliably review before it auto-posts",
    body: `## What to build
The video preview in your Review Inbox does not play on Safari or iPhone. Fix the app so the built-in preview streams properly and can be scrubbed on Mac and mobile.

## Why it matters
Reviewing videos before they auto-post is your single most important daily action — it's the one human gate in the whole factory. If the preview won't play on your Mac/iPhone, you either can't review at all or you approve blind. That's the difference between catching a bad video and auto-posting it to three platforms.

## Evidence (this is real, in our own code)
\`src/app/api/media/[videoId]/route.ts\` (lines 12–19) always returns the whole file as a plain HTTP 200 and never honors the browser's \`Range\` request or sends \`Accept-Ranges\`/206. Safari and iOS **require** byte-range (206) responses to play a \`<video>\` — they send \`Range: bytes=0-\` and refuse a full-body 200. The inbox consumes this at \`src/components/inbox-card.tsx:154\` (\`<video src="/api/media/\${id}">\`).

## Effort
**S / M**

## How we'd know it worked
Open the Review Inbox in Safari on your Mac (and on your iPhone) and the preview plays and scrubs without a workaround.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/70",
    createdAt: "2026-07-20T14:21:39Z",
    updatedAt: "2026-07-23T19:37:50Z",
    commentCount: 1,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  58: {
    number: 58,
    title: "Auto-post every video to Instagram & Facebook too, not just YouTube + TikTok — the biggest free revenue bump on content you already make",
    body: `## What to build
The app already renders every video once as a vertical 9:16 master and then auto-posts it to **YouTube Shorts** and **TikTok**. This proposal adds two more auto-post destinations for that *same finished video* — **Instagram Reels** and **Facebook Reels** — using Meta's Graph API, plus a "Connect Instagram/Facebook" button in Settings (same flow the app already has for YouTube and TikTok).

Nothing about how videos are made changes. We take the file we already produced and send it to two more places. In the code this is a near-copy of the existing per-platform publisher: \`publishToYouTube\` / \`publishToTikTok\` in \`src/lib/tools/publish.ts\` already share one clean, idempotent "post once per (video, platform)" pattern — we add \`publishToInstagram\` / \`publishToFacebook\` alongside them and a Meta OAuth connection like \`src/lib/tiktok.ts\`.

## Why it matters (this is the money one)
Every extra platform is basically free ad revenue on content you've **already produced and paid for** — same script, same voiceover, same render. The research is consistent that this is the single biggest revenue jump available to a solo faceless creator:

- Facebook Reels RPM runs **$0.50–$5.00** vs. YouTube Shorts' **~$0.01–$0.20 per 1,000 views** — Shorts ad revenue alone is tiny, so more surfaces is how the math works. — https://fluxnote.io/guides/facebook-reels-monetization-earnings-2026 , https://influencermarketinghub.com/youtube-shorts-rpm/
- "Cross-posting the same faceless Reel across YouTube Shorts, TikTok, and Instagram can triple earnings." — https://flowshorts.app/blog/monetize-faceless-reels
- Meta is actively running guaranteed-pay/reach-boost onboarding bonuses for creators who post Reels consistently, and AI-generated content is explicitly allowed. — https://www.cnbc.com/2026/03/18/meta-creator-pay-instagram-tiktok-youtube-facebook.html

Note: posting the **same** clip to **different** platforms is safe and encouraged — the "reused/inauthentic content" penalty is about repetition *within one platform*, not cross-posting.

## Why it's buildable on what we already have
- We already produce the exact asset needed: \`src/lib/tools/assemble.ts:59\` renders a 1080×1920 (9:16) master to \`Video.localPath\`.
- We already have the publisher pattern to copy: \`src/lib/tools/publish.ts\` — \`publishToYouTube\`, \`publishToTikTok\`, and the shared \`isAlreadyPublished\` idempotency guard keyed on \`(videoId, platform)\`.
- We already have the connection/Settings pattern to copy: \`src/lib/tiktok.ts\` + \`src/app/api/auth/tiktok/*\`.
- The \`Post\` model is already keyed by \`platform\`, so Instagram/Facebook slot in with no schema redesign.

## Owner action required
Like YouTube today, this needs the owner to create a free Meta developer app and connect the Instagram/Facebook account once (the PR should include a short plain-English setup note in \`Updates/\`). Until connected, the rest of the app is unaffected.

## Effort
**M** — two new publisher functions + one Meta OAuth connection + two Settings buttons, all mirroring code that already exists.

## How we'd know it worked
A single generated video appears live on **four** platforms (YouTube, TikTok, Instagram, Facebook) from one run, with four rows in the dashboard's publish status — and re-running the pipeline does **not** double-post any of them.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/58",
    createdAt: "2026-07-17T22:01:51Z",
    updatedAt: "2026-07-23T17:40:08Z",
    commentCount: 4,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  57: {
    number: 57,
    title: "Your paid premium voice can quietly break — the app swaps in the free robot voice and never tells you",
    body: `## What's wrong

If you pick a paid premium voice (ElevenLabs or OpenAI) and it stops working, the app quietly swaps in the free robot voice instead — and never tells you. You keep paying for a voice you're not getting, and your videos ship with an inconsistent sound.

The voice step tries your premium provider first, then silently falls back to the free local voice (Kokoro) if anything goes wrong. The problem is *how* it fails: if your ElevenLabs key expires, your credits run out, or the service rate-limits you, the code just gives up on that provider **without a single log line, error, or note** and moves on to the free voice. Because a voice *did* get produced, the video passes all the "is it silent?" checks and auto-publishes normally.

So the failure is invisible on two fronts: (1) every video quietly ships in the *wrong* voice, breaking your channel's brand sound, and (2) you keep paying an ElevenLabs/OpenAI subscription for something that isn't actually being used — with nothing in the app telling you it broke.

This is the same "stop silent failures — tell me why" pattern you've approved before (broken-video detection, "why a video didn't post").

## Evidence (in our own code)

- \`src/lib/truecrime/tts.ts:104-108\` — ElevenLabs: on any bad response it just \`return false\`. No log, no record.
- \`src/lib/truecrime/tts.ts:125-129\` — OpenAI voice: identical silent \`return false\`.
- The provider chain then falls through to the free Kokoro voice, and the video is treated as a success — so nothing surfaces the downgrade.

## What to build

When a **paid** voice provider fails (not just "no key set" — an actual expired-key / out-of-credits / rate-limit failure), record it and surface it to the owner: a log/notification and a visible flag on the affected video ("shipped with fallback voice — check your ElevenLabs account"), the same way we flag other silent failures. Optionally hold the video for review instead of auto-publishing in the wrong voice.

## Effort
**S–M** — small change to two functions plus one surfacing hook.

## How we'd know it worked
Set an invalid ElevenLabs key, run a true-crime video, and the app warns you the paid voice failed and the video fell back to the free voice — instead of silently publishing it.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/57",
    createdAt: "2026-07-17T16:24:00Z",
    updatedAt: "2026-07-23T17:12:48Z",
    commentCount: 3,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  51: {
    number: 51,
    title: "The AI voice mispronounces names, places & acronyms — add a pronunciation step before every voiceover",
    body: `## The problem in one line
The AI voice reads your scripts as-is, so it **mispronounces exactly the words your niches are built on** — athlete and team names, victims' and criminals' names, historical figures, places, acronyms (it says "fibby" for FBI), and numbers/dates — and one butchered name in the first few seconds makes a video sound careless and kills trust in the comments.

## Why this matters to the product's success
- All four of your factories are **dense with proper nouns**: Sports (players, teams), True Crime (names, places), History (figures, dates), Reddit (names, brands). These are precisely the words neural TTS gets wrong most often — and precisely the words that carry the story.
- Wrong pronunciations are one of the most-cited complaints about faceless AI videos, because viewers instantly read them as "no human checked this." That's both a credibility problem and part of the "AI slop" signal platforms are now penalising.
- It compounds the feedback you already gave — that the videos felt flat/low-effort. Getting names right is one of the cheapest ways to sound like a real channel.
- Evidence this is a known, structural TTS problem (not solvable by "pick a better voice"): https://www.planetlanguages.com/ai-voiceover-problems/ and ElevenLabs' own guidance on pronunciation dictionaries: https://help.elevenlabs.io/hc/en-us/articles/19448694780177

## What's actually happening in our code
- The script's narration is handed to the voice engine **completely unprocessed** — there is no pronunciation step anywhere. A repo-wide search for \`pronun\` / \`phonem\` / \`lexicon\` / \`ssml\` / \`ipa\` across \`src/\` returns **nothing**.
- All three orchestrators call the same one function with raw text: \`synthesizeNarration(ctx.videoId, ctx.script.narration, ctx.config.voice)\` (e.g. \`src/lib/history/orchestrator.ts:198\`; True Crime and Sports use the same \`src/lib/truecrime/tts.ts\`). So a **single normalization pass added before that call fixes all four factories at once.**

## What to build
1. A **pronunciation-normalization stage** that runs on the narration just before TTS: expand acronyms to spaced letters ("FBI" → "F B I"), speak number/date strings the intended way, and apply phonetic respelling / SSML phoneme hints for known tricky names.
2. A small, editable **per-niche lexicon** (common team/player names, frequent historical and true-crime figures, place names) the owner can add to over time.
3. For a proper noun the system doesn't recognise, optionally **flag it in the Review Inbox** ("confirm pronunciation of 'Gaddafi'?") before render, so unknown names get a quick human check instead of a silent guess.

## Effort
**M** — one new pre-TTS text pass shared by all factories, a seed lexicon, and (optional) a review-inbox flag. No new pipeline stages, no change to how audio is rendered.

## How we'd know it worked
Generate a video whose script contains a tricky name and an acronym (e.g. a specific athlete plus "FBI"): the voiceover pronounces both correctly, and any name the system didn't recognise shows up as a quick confirm-pronunciation prompt in the Review Inbox instead of being guessed wrong on the published video.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/51",
    createdAt: "2026-07-16T17:27:19Z",
    updatedAt: "2026-07-28T17:51:08Z",
    commentCount: 3,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  27: {
    number: 27,
    title: "Let the channel earn money before it's monetized: put links & CTAs on every video",
    body: `## The problem in one line
**Every video we publish leaves the description empty of any link or call-to-action — so the channel can't earn a cent until it clears YouTube's high monetization bar, when it could be earning *now*.**

## Why this is the fastest money lever
Ad revenue (YouTube's Partner Program) requires **1,000 subscribers + 10M Shorts views in 90 days** before it pays anything — until then the RPM is literally $0. **Affiliate links and description CTAs have no subscriber requirement — they earn from view #1.** For well-run faceless channels, non-ad income (affiliate/sponsors) is routinely **40–60% of total earnings**, and a single well-placed link on a modest channel can do **$500–$2,000/month**.
- Evidence: https://virvid.ai/blog/how-to-monetize-faceless-youtube-channel-2026 , https://easyviral.ai/blog/how-much-do-faceless-youtube-channels-make-2026
- YPP thresholds: https://support.google.com/youtube/answer/72851

## What's actually happening in our code
- The publish step builds the YouTube description from only \`video.description\` + hashtags + \`#Shorts\` (\`src/lib/tools/publish.ts:103\`). There is **no** affiliate link, no CTA, no pinned first comment, no per-factory description template — a repo-wide search for \`affiliate\` / \`commentThreads\` / \`descriptionTemplate\` finds nothing.
- We're already 80% there: the script stage **already generates a \`description\`** for every video (\`src/lib/tools/script.ts:71\`, and the true-crime/history builders). We just never attach the money part.

## What to build
1. **Per-factory description template** — a reusable block (affiliate links, "follow for more", channel CTA) stored on the Factory config and appended to every upload's description automatically.
2. **Auto-pinned first comment** — post + pin a comment with the main link on each upload (\`commentThreads.insert\`); pinned comments get far more clicks than buried description links.
3. **Link tracking** — wrap links with a UTM/short-link so the owner can see which factory's videos actually drive clicks, and double down on the earners.

## Effort
**S–M** — mostly templating the description we already generate + one extra YouTube API call for the pinned comment. No new pipeline stages.

## How we'd know it worked
Every published video carries the factory's link/CTA in its description and a pinned comment — verifiable on the live YouTube upload — and the dashboard can show clicks per factory, so the channel starts earning affiliate income before it ever hits the ad-revenue threshold.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/27",
    createdAt: "2026-07-14T17:22:38Z",
    updatedAt: "2026-07-23T16:06:22Z",
    commentCount: 4,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  17: {
    number: 17,
    title: "Protect the channel from demonetization: extend the anti-repetition gate to every factory",
    body: `## The problem (in plain terms)
YouTube's 2025–2026 "inauthentic / mass-produced content" crackdown is the biggest existential risk to a faceless-automation channel. The platform now demonetizes — and has **terminated** — channels whose videos are repetitive and template-identical. One enforcement wave wiped 16 channels (~4.7B lifetime views, 35M subscribers); one creator reported losing $250K/month overnight.
- Evidence: https://www.bottlerocketcontent.com/youtube-ai-slop-crackdown-faceless-creators-2026/ (quotes YouTube's own policy wording), and creators report the algorithm throttles reach after just 5–7 near-identical uploads: https://easyviral.ai/blog/youtube-shorts-getting-0-views-7-fixes-2026

## The good news: we already own the fix — for one factory only
This repo already ships a real anti-repetition system: \`checkVariation()\` in \`src/lib/compliance/variation.ts\` (hook-pattern + section-sequence + narration-shingle similarity, routes to human review over a threshold) plus footage de-dup in \`src/lib/compliance/visualSignature.ts\`. **But it's wired into the True Crime pipeline only.** The Reddit, Sports, and History factories mass-produce with **no** template-similarity brake.

## What to build
- Extend the existing variation + visual-signature gate to run for **every** factory before a video is approved/published, comparing each new video's hook, structure, voice, music bed, and footage set against that agent's recent uploads.
- When overlap crosses the threshold, route to review (or auto-vary hook/template/voice) instead of publishing another near-duplicate.
- Maintain small rotating pools (hook templates, intros, music beds, voices) so variation is automatic.

## Effort
**M** — mostly generalizing already-tested code (\`variation.ts\` has coverage) from one orchestrator to the shared path.

## How we'd know it worked
Generate 10 videos from the same factory back-to-back: the gate flags/forces variation on the near-duplicates instead of letting a wall of identical uploads go out.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/17",
    createdAt: "2026-07-14T15:08:39Z",
    updatedAt: "2026-07-23T15:39:13Z",
    commentCount: 3,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "open",
    closedAt: null,
    stateReason: null,
  },
  45: {
    number: 45,
    title: "Stop an auto-posted true-crime video from calling a real, living person guilty — the legal safety check has holes and zero tests",
    body: `## The risk in plain English

Your true-crime factory can run on autopilot: it writes a script, narrates it, renders it, and posts it — no human in the loop when an agent is set to fully-automatic. The one thing standing between that pipeline and a **defamation lawsuit** is a single safety check that reads the narration and blocks any sentence that flatly states a *living, not-convicted* real person committed the crime.

That check has two problems, and right now **nothing tests it at all**, so a future change could quietly break it and no alarm would go off.

## What's actually wrong

**1. It only catches a name if the script writes it exactly the way it's stored.**
The guard skips any sentence unless the person's *full stored name* appears as a literal substring:

- \`src/lib/compliance/defamationLint.ts:59\` — \`if (!sentence.toLowerCase().includes(subj.name.toLowerCase())) continue\`

So if the case subject is stored as **\\"John Smith\\"** but the narration says **\\"Smith pulled the trigger\\"** or **\\"John did it\\"**, the sentence is never checked → the gate returns **pass** → an auto agent can publish it. Worse: if the AI script names a person who **isn't in the case's subject list at all** (easy to happen — the LLM adds a boyfriend, a neighbor, a suspect), that name is invisible to the guard and gets zero protection.

**2. The entire legal-safety module has no tests.**
Confirmed: \`find src/lib/compliance -name '*.test.ts'\` returns nothing. The decision engine (\`gate.ts\`) and every check it calls (\`defamationLint.ts\`, \`corroboration.ts\`, \`legalStatus.ts\`, \`claims.ts\`, \`caseSelection.ts\`) are untested. This is the highest-stakes code in the repo — the part that keeps you out of court — and it's the least protected. A refactor or a change in the AI's output shape could disable it silently, with a green build and no failing test.

## What to build

- Tighten name matching in \`defamationLint.ts\` so it also catches **last-name-only / first-name-only / alias** mentions of a stored subject.
- Treat **\\"a person is named in the narration with a guilt verb but isn't in the subject list\\"** as an automatic **route-to-review** (don't auto-publish), instead of silently passing.
- Add a real unit-test suite around \`gate.ts\` and \`defamationLint.ts\` covering: full name, partial name, unknown name, convicted vs. living-unconvicted, hedged vs. unhedged — so this protection can never be broken without a test going red.

## Evidence
- \`src/lib/compliance/defamationLint.ts:59\` (substring-only match) and \`:67\` (living + no-hedge → \`block\`)
- \`src/lib/compliance/gate.ts\` header: \\"block → do not produce … defamation 'block' flag … lands here\\" — this is the sole gate on autonomous true-crime output
- \`src/lib/compliance/\` has **no** \`*.test.ts\` files (verified)
- Category context — 2026 platform + legal pressure on faceless true-crime naming real people: https://virvid.ai/blog/youtube-copyright-mistakes-faceless-creators-2026

## Effort
**M** — mostly test-writing plus a tightening of the name-matching and one new review trigger. No schema or UI change required.

## How we'd know it worked
A test suite exists for the compliance gate, and a script that says **\\"Smith killed her\\"** (subject stored as \\"John Smith\\", living, not convicted) — or names a person not in the subject list at all — is held for review instead of auto-published.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/45",
    createdAt: "2026-07-15T20:20:34Z",
    updatedAt: "2026-07-28T17:49:38Z",
    commentCount: 4,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-28T17:49:38Z",
    stateReason: "completed",
  },
  26: {
    number: 26,
    title: "Your spending cap doesn't actually stop spending — make the budget limit real",
    body: `## The problem in one line
The app **promises to stop spending your money at a limit you set — but that limit does nothing.** The "budget cap" and "monthly ceiling" boxes are collected, saved, and then read by no part of the system.

## What's actually happening in our code
- When you create an agent, the form says, word for word: *"Orchestrator will abort the run if Claude + media costs exceed this amount."* (\`src/app/agents/new/page.tsx:285\`)
- Settings says: *"Alerts when monthly spend approaches the ceiling."* (\`src/app/settings/page.tsx:197\`)
- Both values are stored (\`budget\` on the agent in \`prisma/schema.prisma:39\`; \`monthly_budget\` in Settings).
- **But no code ever reads them.** A repo-wide search for any budget check in the engine (\`src/lib/**\`) returns **zero** results — the orchestrator that runs a factory (\`src/lib/orchestrator.ts\`) never looks at \`agent.budget\`, and nothing anywhere reads \`monthly_budget\`. There is no abort, no alert, no counter.

## Why this matters to the owner
Every video spends real money — paid TTS, image generation, and Claude calls. A factory that gets stuck in a retry loop, or an over-eager overnight batch, can bill **unbounded** with no brake and no warning. The owner is a non-technical operator who set a cap *specifically so this couldn't happen* — and the interface told him it was handled. That is the worst kind of gap: a safety control that looks real and isn't. It is also a straightforward trust problem — the UI states a guarantee the code doesn't keep.

## Evidence
- UI promise: \`src/app/agents/new/page.tsx:285\` and \`src/app/settings/page.tsx:197\`
- Field exists but is never consumed: \`budget Float?\` at \`prisma/schema.prisma:39\`; grep for \`budget\` / \`monthly_budget\` across \`src/lib\` finds no reader.
- The cost data needed to enforce it **already exists** — the per-run cost is already summed today (e.g. \`src/lib/truecrime/orchestrator.ts\` rolls Claude + media spend into a per-video figure), so the enforcement just needs to compare that running total against the cap.

## What to build
1. **Per-run hard stop:** before/while a factory run spends, track the running cost and abort the run (mark it failed with a clear reason) the moment it would exceed the agent's \`budget\`. Make the promise on the button true.
2. **Monthly ceiling alert:** sum this month's spend from the cost ledger and, when it nears/crosses \`monthly_budget\`, surface a plain-language warning in the dashboard (and stop auto-runs if over).
3. If we decide *not* to build enforcement now, at minimum change the UI text so it stops promising a guarantee that doesn't exist.

## Effort
**S–M** — the cost is already being tallied per run; this is a comparison + an abort path + one dashboard warning. Monthly rollup is the M part.

## How we'd know it worked
Set an agent's budget to a tiny number and start a run: it stops itself and shows *"Stopped: run hit your $X budget cap"* instead of billing past it. Set a low monthly ceiling and the dashboard warns as spend approaches it.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/26",
    createdAt: "2026-07-14T17:22:18Z",
    updatedAt: "2026-07-23T14:58:12Z",
    commentCount: 3,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-23T14:58:12Z",
    stateReason: "completed",
  },
  96: {
    number: 96,
    title: "A sports video can hang for up to 30 minutes with no error — give it the same stall-timeout the other two video types already have",
    body: `### The problem in plain English

When the app makes a **sports** video, each step of the process is supposed to give up and fail fast if it gets stuck (for example, if the AI writing service stops responding mid-request). Your **true-crime** and **history** video types already do this — but the **sports** pipeline was never given the same safety net.

The result: if a sports step stalls, the video just sits there showing "running" with **no error and no time limit**. The owner sees a spinner that never resolves, and it only gets cleaned up when a separate background sweep happens to run — which can be up to **30 minutes later**. During that half hour the slot is occupied, nothing tells you anything is wrong, and it looks like the app froze.

### Why it matters

- Reliability is the #1 thing that makes an unattended, auto-posting product trustworthy. A silent 30-minute hang looks like a crash.
- This is the exact failure the team already fixed once. The other two pipelines carry a comment calling \`withTimeout\` the fix for "the round-6 stuck-run failure mode… a run can never sit in 'running' forever again." Sports was simply left out of that fix.
- The fix already exists in the codebase — it just needs to be applied in one more place. Very low risk.

### What to build

Wrap each sports pipeline stage in the same \`withTimeout(...)\` guard the other two pipelines use, with a sensible per-stage time budget, so a stalled stage rejects and the run is marked **failed** promptly instead of hanging.

### Evidence (from our own code)

- **Missing timeout (sports):** \`src/lib/orchestrator.ts:232\` — the stage runner does a bare \`await fn()\` with no timeout.
- **Has timeout (true crime):** \`src/lib/truecrime/orchestrator.ts:324\` — \`await withTimeout(fn(), timeoutMs, ...)\`.
- **Has timeout (history):** \`src/lib/history/orchestrator.ts:331\` — same guard.
- **The helper already exists:** \`withTimeout\` is defined in \`src/lib/truecrime/budget.ts:94\` and is imported by both other orchestrators.
- Contributing factor: the sports script step (\`src/lib/tools/script.ts:23\`) calls the Anthropic API with no request-level timeout of its own, so a hung connection has nothing to stop it.

### Effort

**S** — apply an existing helper to one function, plus a per-stage timeout table mirroring the other pipelines, plus a unit test.

### How we'd know it worked

A sports stage that never returns (simulate a hanging step) causes the run to be marked **failed with a clear "exceeded its Nmin budget" error within its time budget**, instead of sitting in "running" until the recovery sweep — matched by a unit test like the true-crime/history ones.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/96",
    createdAt: "2026-07-21T19:40:58Z",
    updatedAt: "2026-07-23T03:06:03Z",
    commentCount: 1,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-23T03:06:03Z",
    stateReason: "completed",
  },
  56: {
    number: 56,
    title: "Your TikTok can silently stop posting while Settings still says 'Connected' — give it the same expiry warning YouTube already has",
    body: `## What's wrong

Your TikTok channel can silently go dark, and the app will keep telling you TikTok is "Connected."

We already fixed this exact problem for **YouTube** (you merged it — "Warn when your YouTube login expires"). When a YouTube login goes stale, the app flips it to **"Reconnect needed"** and shows a banner in Settings. **TikTok has none of that.**

Right now, when your TikTok login expires or gets revoked (TikTok refresh tokens expire on a fixed schedule, so this *will* happen), the code just throws an error deep in the publishing step and gives up. Nothing ever changes TikTok's status. Settings keeps showing TikTok as connected/green. So every auto-post to TikTok quietly fails, one of your two channels stops receiving videos, and you get no warning and no obvious way to fix it.

## Evidence (in our own code)

- \`src/lib/tiktok.ts:177-190\` — when the token is expired and can't be refreshed, \`accessToken()\` just \`throw\`s "TikTok session expired." Nothing updates the saved connection status.
- \`src/lib/tiktok.ts:164-169\` — the app considers TikTok "connected" as long as a row is marked \`active\`; the throw above never changes it away from \`active\`.
- Compare to YouTube, which already does the right thing: \`src/lib/youtube.ts\` has \`markNeedsReconnect()\`, and Settings shows a reconnect banner (\`src/app/settings/page.tsx\`). This proposal is simply giving TikTok the same treatment.

## What to build

Mirror the YouTube reconnect flow for TikTok: when a TikTok token refresh fails because the session is dead, flip that connection's status to \`needs_reconnect\`, and show the same "Reconnect needed" banner for TikTok in Settings that YouTube already gets.

## Effort
**M** — the YouTube version already exists as a template to copy.

## How we'd know it worked
Revoke/expire the TikTok login, run a publish, and Settings shows a "TikTok — reconnect needed" banner instead of a green "Connected," matching YouTube's behavior.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/56",
    createdAt: "2026-07-17T16:23:42Z",
    updatedAt: "2026-07-23T03:05:57Z",
    commentCount: 1,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-23T03:05:57Z",
    stateReason: "completed",
  },
  50: {
    number: 50,
    title: "Your 'Winners' leaderboard only updates when you click Refresh — make it learn on its own",
    body: `## The problem in one line
Your "Winners" leaderboard and view/watch-time numbers **only update when you personally open the analytics page and click "Refresh"** — so the system that's supposed to learn what's working and help you double down is sitting frozen on stale (often zero) numbers whenever you're not looking.

## Why this matters to the product's success
The whole promise of an autonomous channel factory is: *it publishes, it watches what wins, and it steers toward more of that.* Right now the "watches what wins" half never runs on its own.
- Every "double down on your best videos" strategy — re-cutting top performers, favouring the niches that actually earn, ranking the Winners view — depends on fresh performance data. If the data only refreshes on a manual click, none of that can ever happen unattended.
- The owner is a non-technical operator who won't be opening an analytics API page and clicking a button on a schedule. So in normal use the numbers are effectively always out of date, and any decision made from them is made on old information.
- This is the same class of gap as the budget-cap and crash-recovery issues already on the shelf: a feature that looks live in the UI but is never actually driven by the running system.

## Evidence (verified in this repo)
- The refresh function exists and works, but its **only caller is the manual analytics route** (the "Refresh metrics" button): \`refreshAllMetrics()\` is defined at \`src/lib/tools/analytics.ts:103\` and imported/called **only** from \`src/app/api/youtube/analytics/route.ts:4,9\` — which is hit by the button in \`src/components/refresh-metrics-button.tsx\`.
- The app already runs an in-process background tick every 60 seconds (\`src/instrumentation-node.ts:16-42\`) that drives the scheduler and crash recovery — but it **never** calls \`refreshAllMetrics()\`. A repo-wide search finds no automatic caller and no cron for it.
- So metrics update on a human click and at no other time.

## What to build
- Call \`refreshAllMetrics()\` from the existing 60-second background tick (in \`instrumentation-node.ts\`), **throttled** to something sensible like once per hour so it doesn't hammer the YouTube Analytics API quota.
- Store a "last refreshed" timestamp and show it on the dashboard/Winners view so the owner can see the data is live (and how fresh it is).
- Keep the manual button as a "refresh now" override.

## Effort
**S** — one throttled call added to a tick that already exists, plus a last-updated timestamp in the UI. Same pattern as the scheduler/recovery already wired into that tick.

## How we'd know it worked
Publish a video, then walk away without touching the app: within the hour the Winners leaderboard and view/watch-time numbers update on their own, and the dashboard shows a recent "last refreshed" time — no button click required.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/50",
    createdAt: "2026-07-16T17:27:17Z",
    updatedAt: "2026-07-23T03:05:25Z",
    commentCount: 1,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-23T03:05:25Z",
    stateReason: "completed",
  },
  43: {
    number: 43,
    title: "Make the system learn from its own wins — 'make more of what's working' instead of a fixed calendar",
    body: `## The one-line version

Right now the app **can see** which videos win, but it **never uses that** to decide what to make next. It picks topics off a fixed rotation and ignores your analytics entirely. This proposal wires up the "learn from winners" loop — the single feature the whole product was pitched on.

## Why this matters

Your own product document calls this the headline feature and the real proof the system works:

- **PRD goal #5 (\`docs/PRD.md\`):** *"Closed feedback loop. Use analytics to inform what to make next (which formats/topics/hooks win → feed the ideation step)"* — described as *"the real proof the system works."*
- **\`docs/Decision-and-Cost-Guide.md\`:** *"the analytics feedback loop… is the most important revenue feature in the whole product."*

In plain terms: the pitch was *"double down on what works, cut what doesn't."* Today the system does neither. It generates on autopilot forever regardless of what actually earns views — which means real API money keeps flowing into formats and topics that flop.

## The proof it's genuinely missing (verified in code)

- **Topics are chosen by the calendar, not by performance.** Every factory picks its next subject with \`new Date().getDate() % watchlist.length\` — a day-of-month rotation (\`src/lib/tools/source.ts:68\` & \`:85\` for sports; \`src/lib/truecrime/caseDiscovery.ts:251\` for true-crime/history). Nothing about past results influences the pick.
- **There is a "memory" slot for each agent that is never filled.** The database has an \`Agent.memory\` field (\`prisma/schema.prisma:40\`) meant to hold what's worked — but a full search of the code shows **nothing ever writes to it.** The feature was scaffolded and never built.
- **Analytics are display-only.** The view/subscriber numbers pulled from YouTube (\`src/lib/tools/analytics.ts\`) are read by exactly one thing: the Winners leaderboard screen. No part of the generation pipeline ever reads them back to make a decision.

## What to build (a bounded first version — not a giant rewrite)

Ship the smallest thing that closes the loop, then iterate:

1. After metrics refresh, rank each agent's recent videos by views (and watch-% once available) and write a short plain-text "what's winning" digest into that agent's existing \`Agent.memory\` field — e.g. *"Top performers: [topic A], [topic B]; best hooks: [style]. Weakest: [topic C]."*
2. At the start of each run, read that digest and feed it into the topic-picking / script stage so the agent **biases toward proven topics and hooks and away from duds**, instead of blind calendar rotation.
3. Show the digest on the dashboard so you can see *why* it chose what it chose.

This uses data already in the database and a field that already exists — it's wiring, not new infrastructure.

## Effort

**M** — scoped to the first version above. (Full "one-click clone a winner" and cross-factory learning can follow as separate, smaller steps.)

## How we'd know it worked

Videos made **after** a winner-digest exists beat the pre-loop baseline on median views per factory — which is the PRD's own stated success test ("do 'make more like this' videos outperform baseline?"). Minimum bar for v1: each agent's \`memory\` field visibly fills with a real winners summary, and the next run's chosen topic can be traced back to it.

---
*Filed by the Scout. Evidence verified against the codebase (\`source.ts:68\`, \`schema.prisma:40\`, \`analytics.ts\`). Independently surfaced by three separate research passes (codebase-fragility, revenue, and competitor) as the highest-leverage missing capability.*`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/43",
    createdAt: "2026-07-15T12:24:06Z",
    updatedAt: "2026-07-22T14:25:18Z",
    commentCount: 1,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-22T14:25:18Z",
    stateReason: "completed",
  },
  49: {
    number: 49,
    title: "Give the app a full visual redesign (with drafts to pick from), fewer tabs, and fix TikTok's silent posting failure",
    body: `## The idea in one line
Give the whole app a top-to-bottom visual redesign — a premium, "storybook-beautiful" look — and while we're in there, squeeze the seven scattered tabs down to a few clear ones **and** finally fix the TikTok bug that quietly stops your posts (below). You'd get to pick the new look from several drafts before a single line of code is written.

## Why this matters to the business
- The app works, but it looks like a tool, not a product. A clean, confident design makes it faster to use every day and makes it something you'd be proud to show or sell.
- **Too many tabs.** Right now the top bar has **seven** tabs — Overview, Factories, Agents, Inbox, Queue, Schedule, Winners (\`src/components/hub-nav.tsx\`) — plus a separate Settings page. That's a lot to scan. Several of them belong together.
- **You get to choose the look.** The first thing this delivers is *multiple full design drafts* of every main screen — different styles side by side — so you approve a direction from your phone before we build anything. No surprises.
- It folds in a real, revenue-losing bug (TikTok silently stops posting) as part of the redesign of the connection/status screens, so we fix it once, properly, inside the new look.

## What to build

**Deliver in this order so nothing is built before you approve it:**

**Phase 0 — Drafts for you to pick from (no code, just pictures).**
Send you **3 distinct visual directions** (e.g. clean & light / dark "studio" / bold editorial) as mockups of each key screen: the home dashboard, the create/build screen, the publishing pipeline, and Settings. You reply with the one you like (or mix-and-match). This is the "send me multiple drafts" step.

**Phase 1 — Condense the tabs.** Group the seven into a handful that make sense:
- **Home** ← Overview + Winners (what's live, what's winning, at a glance)
- **Studio** ← Factories + Agents (everything that *creates* content in one place)
- **Pipeline** ← Inbox + Queue + Schedule (everything moving *toward* being posted)
- **Settings** stays its own place, with a small always-visible "connections healthy / needs attention" chip in the top bar.

Seven tabs → three, plus Settings. (Exact grouping is yours to tweak when you see the drafts.)

**Phase 2 — Apply the chosen look** across those screens in the approved style.

**Phase 3 — Fix TikTok inside the new Settings/connection design (the bug below).**

## The bug we fix along the way (this is real, not hypothetical)
When your TikTok login quietly expires, the app keeps showing a green **Connected @handle** badge while *every* auto-post to TikTok silently fails — TikTok is labelled in your own Settings as the **"highest revenue-per-view target,"** so this is pure lost income with a dashboard that lies.

YouTube already handles this correctly and it's merged (\`Updates/2026-07-15-youtube-reconnect-warning.md\`):
- \`src/lib/youtube.ts:128\` \`isAuthError(...)\`, \`:165\` \`markNeedsReconnect()\`, \`:181\` \`connectionState()\` → \`needs_reconnect\`
- \`src/lib/tools/publish.ts:214\` — on an auth error it calls \`markNeedsReconnect()\`

TikTok has **none** of it:
- \`src/lib/tiktok.ts:189\` — on a dead login it just throws and **never updates the stored status**
- \`src/lib/tiktok.ts:167\` — \`connection()\` still finds the \`status: 'active'\` row, so it keeps returning "connected"
- \`src/app/api/auth/tiktok/route.ts:6\` — Settings therefore keeps replying \`connected: true\`, badge stays green forever

The fix mirrors YouTube: add a TikTok \`isAuthError\` + \`markNeedsReconnect()\` that flips \`PlatformAuth.status\` to \`needs_reconnect\`, call it from the TikTok publish path, and show a **"Reconnect TikTok"** prompt in the redesigned Settings card.

## Effort
**L** — this is a real project: a full visual redesign, multiple mockup rounds, a navigation restructure, and the TikTok fix. The TikTok fix on its own is still an **S** (it's a copy of the merged YouTube pattern), so if you ever want just that shipped fast, we can pull it out and do it in a day.

## How we'd know it worked
1. You've picked a design direction from the drafts and the main screens now match it.
2. The top bar shows a small number of grouped tabs (Home / Studio / Pipeline / Settings) instead of seven.
3. Revoke/expire the TikTok token → Settings shows **"Reconnect"** (not green), and auto-posting resumes once you reconnect.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/49",
    createdAt: "2026-07-16T15:10:30Z",
    updatedAt: "2026-07-22T14:25:13Z",
    commentCount: 3,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-22T14:25:13Z",
    stateReason: "completed",
  },
  35: {
    number: 35,
    title: "Your true-crime & history videos play over silence — turn on the background music the system already plans",
    body: `## What to build
Add a **background music bed** to the true-crime and history videos. Right now these videos play narration **over total silence** — there is no music at all. A moody music bed that rises toward the dramatic moment is one of the biggest things that makes a faceless video *feel* like a real video instead of someone reading over nothing.

The remarkable part: **the system already plans the music, it just never plays it.** For every video, the pipeline already builds a beat-by-beat 'music intensity' curve that ramps from calm (0.3) up to a peak (0.95) at the climax of the story — it's computed, stored, and then thrown away because nothing ever adds an audio track. This is roughly 80% done; what's missing is wiring an actual music track to the curve that already exists.

## Why it matters to the product's success
- You told me before the videos 'looked the same and looked bad.' Silent narration is a huge part of that flat feeling — every successful true-crime / history channel runs a music bed underneath.
- Competitor tools (Submagic, SendShort) treat auto sound design as a headline feature because it's a top driver of watch-through — and watch-through is what the platforms use to decide who gets pushed.
- It costs you nothing per video and applies to every future video automatically.

## Evidence this is real (specific files)
- The music curve is built but never used: \`src/lib/truecrime/script.ts\` and \`src/lib/history/script.ts\` compute \`musicIntensity\` per beat (0.3 → 0.95 at the climax).
- Nothing plays it — the ffmpeg mux maps only the narration stream (\`src/lib/truecrime/assemble.ts\` around lines 273-277, single \`-map 1:a:0\`, no music input / no mix).
- The Remotion path is the same: \`video/TrueCrime.tsx:105\` renders only \`{audioSrc ? <Audio src={audioSrc} /> : null}\` — a single narration bed, no music \`<Audio>\`.

## Effort
**M** — a curated royalty-free (monetization-safe) music track per mood, mixed under the narration at the levels the existing curve already specifies, on both the ffmpeg and Remotion render paths.

## How we'd know it worked
Play a newly generated true-crime video from the Review Inbox: you hear music underneath the narration that swells at the dramatic peak, at a level that never drowns out the voice.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/35",
    createdAt: "2026-07-14T21:08:05Z",
    updatedAt: "2026-07-22T14:25:09Z",
    commentCount: 2,
    labels: ["proposal"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-22T14:25:09Z",
    stateReason: "completed",
  },
  94: {
    number: 94,
    title: "Some true-crime/history videos get their narration cut off halfway — and still auto-publish",
    body: `## The problem in plain English

Some true-crime and history videos get their **narration cut off partway through** — the voice is telling the story and the video just ends early — and the app still treats them as finished and **auto-publishes them**. The owner never gets warned.

This happens on the most common footage path (the free Wikimedia still-image slideshow that true-crime and history videos fall back to when no video clips are available), so it is not a rare edge case.

## Why it happens (one specific spot)

In \`src/lib/truecrime/assemble.ts\` (used by BOTH true-crime and history), the app builds the picture track two ways:

- **The video-clip path** already protects itself: if any segment fails to render, it throws the whole thing away so the pictures always cover the full narration. There's even a comment explaining exactly this danger:
  > "A partial timeline (some segment failed to render) would sum to LESS than the narration, and the final \`-shortest\` mux would then cut the voice off mid-story." (\`assemble.ts:212-216\`)

- **The slideshow fallback path right below it does NOT have that protection** (\`assemble.ts:220-226\`). It renders each still image and only keeps the ones that succeed. If, say, 3 of 6 images fail to render (a corrupt download, a timeout), you get a picture track half the length of the narration. The final step stitches audio + picture with \`-shortest\` (\`assemble.ts:280\`), so the **finished video is cut to the short picture track — the second half of the story is gone.**

The final safety check (\`isEmptyRender\` in \`src/lib/pipeline/finalize.ts:23\`) only asks "does a video file exist?" — a half-length video answers yes, so it passes and gets marked approved/published. This is the exact failure the same file says it exists to prevent (it cites issue #14, "stop marking broken or silent videos as done").

## What to build

- In the slideshow fallback, apply the **same guard the video path already uses**: if not every still rendered, either stretch the survivors to cover the full audio duration or discard-and-fall-back — never ship a picture track shorter than the narration.
- Add a belt-and-braces **duration check** to the finalize gate: if the finished video is meaningfully shorter than the narration audio (e.g. >1s short), treat it as a broken render and hold for review instead of publishing.

## Evidence

- \`src/lib/truecrime/assemble.ts:212-216\` — the guard that protects the video path (and the comment naming this exact bug).
- \`src/lib/truecrime/assemble.ts:220-226\` — the slideshow path that is missing that guard.
- \`src/lib/truecrime/assemble.ts:280\` — the \`-shortest\` mux that does the truncating.
- \`src/lib/pipeline/finalize.ts:23\` — \`isEmptyRender\` only checks a file exists, not that it's complete.

## Effort
**S** — the fix mirrors a guard the codebase already has a few lines above, plus a short duration check in the finalize gate.

## How we'd know it worked
A test where some (but not all) slideshow stills fail to render no longer produces a published video shorter than its narration — it's held for review instead. In real runs, no true-crime/history video ends before its voiceover finishes.
`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/94",
    createdAt: "2026-07-21T15:55:40Z",
    updatedAt: "2026-07-22T14:25:05Z",
    commentCount: 1,
    labels: ["approved"],
    author: "claude[bot]",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-22T14:25:05Z",
    stateReason: "completed",
  },
  92: {
    number: 92,
    title: "Auto-pull the latest code every time I start the app locally",
    body: `My laptop can silently fall behind what's merged on GitHub — nobody remembers to \`git pull\` before starting the app. I want \`npm run go\` (\`scripts/dev-start.sh\`) to pull the latest \`main\` automatically every time I start it, with no manual step.

**Requirements:**
- Only pull when safe: current branch is \`main\` AND the working tree is clean (no uncommitted local edits). Otherwise skip the pull and just launch with what's there — never overwrite local work.
- Use \`git pull --ff-only origin main\` — fast-forward only, so it can never create a merge conflict on my machine.
- Non-blocking: if the pull fails (offline, diverged history, etc.), print one warning line and continue starting the app anyway. Never abort the launch over this.
- Print one line either way: "✓ Up to date with main" or a short warning why it skipped.

**Why it matters:** the autonomous loop merges fixes to main constantly, but nothing brings those changes down to my laptop — I was running week-old code without knowing it, missing real bug fixes.

**Effort:** S

**How we'd know it worked:** push a commit to main from somewhere else, then run \`npm run go\` locally — it pulls that commit automatically before building, no manual git pull needed.`,
    htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/92",
    createdAt: "2026-07-20T18:02:47Z",
    updatedAt: "2026-07-21T14:00:22Z",
    commentCount: 0,
    labels: ["proposal"],
    author: "ApagPlayz",
    authorAvatar: "",
    state: "closed",
    closedAt: "2026-07-21T14:00:22Z",
    stateReason: "completed",
  },
};

const IDEA_COMMENTS: Record<number, ThreadComment[]> = {
  85: [
    {
      id: 5037769878,
      author: "ApagPlayz",
      authorAvatar: "",
      body: `**Owner feedback for redraft:**

wait what money is being spent, what have i linked up account wise and where is the money being taken from?`,
      createdAt: "2026-07-21T18:44:30Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/85#issuecomment-5037769878",
      isBot: false,
    },
    {
      id: 5037786503,
      author: "claude[bot]",
      authorAvatar: "",
      body: `Good question — and the answer should calm you down: **no real money is being taken anywhere.** Nothing is linked to a card or bank in this app, and you're not billed per video. Those "$" figures are just *estimates* — the app counts the words Claude writes and prices them at Anthropic's public list rate to show "what this would cost if you paid per use." On your Max 20× flat plan, that's already covered by your monthly subscription.

So I've reshaped this: instead of only making sports show a number, the fix now also **re-labels the figure as an estimate** (with a plain tooltip) so it never looks like a live bill again — and still fixes sports showing blank so all niches compare fairly. Sending it back for your approval.`,
      createdAt: "2026-07-21T18:46:08Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/85#issuecomment-5037786503",
      isBot: true,
    },
  ],
  126: [
    {
      id: 5160648090,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run started — implementing the Warm Creator redesign (light default, dark toggle, single consolidated nav). Will open one PR against this issue.",
      createdAt: "2026-08-02T22:29:39Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/126#issuecomment-5160648090",
      isBot: true,
    },
    {
      id: 5412588451,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-08-25T15:16:24Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/126#issuecomment-5412588451",
      isBot: false,
    },
    {
      id: 5412599982,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run started — recreating the Warm Creator redesign (light default, dark toggle, single consolidated nav) cleanly against current `main`. Will open one PR against this issue.",
      createdAt: "2026-08-25T15:17:17Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/126#issuecomment-5412599982",
      isBot: true,
    },
    {
      id: 5412912469,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run started — rebuilding the Warm Creator redesign (light default, dark toggle, one consolidated nav bar) cleanly against current `main`. One PR will follow against this issue.",
      createdAt: "2026-08-25T15:41:14Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/126#issuecomment-5412912469",
      isBot: true,
    },
  ],
  90: [
    {
      id: 5047039530,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder loop starting on this now — turning on Anthropic prompt caching for the script-generation step. Will open one PR shortly.",
      createdAt: "2026-07-22T14:04:45Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/90#issuecomment-5047039530",
      isBot: true,
    },
    {
      id: 5047298483,
      author: "claude[bot]",
      authorAvatar: "",
      body: "✅ Opened PR #98 with the fix. The caching was already switched on but was being thrown away every video because the rotating editorial angle sat inside the reusable block — I moved it just outside so the big instruction block is genuinely reused (~90% off the repeated part). Same videos, lower bill. Full test suite, lint, and build all pass. It's assigned to you for review.",
      createdAt: "2026-07-22T14:19:24Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/90#issuecomment-5047298483",
      isBot: true,
    },
    {
      id: 5060367784,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-07-23T15:38:41Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/90#issuecomment-5060367784",
      isBot: false,
    },
    {
      id: 5064190900,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder loop starting on this again — recreating the prompt-caching fix cleanly against current main (the previous PR #98 conflicted and was closed). Will open one PR shortly.",
      createdAt: "2026-07-23T22:33:37Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/90#issuecomment-5064190900",
      isBot: true,
    },
  ],
  88: [
    {
      id: 5046911300,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this issue. Scoping to the **smallest honest, highest-value slice**: per-platform caption differentiation so a TikTok post is never byte-identical to the YouTube metadata (the #1 named shadowban trigger), with a humanized/varied opener + a native `#fyp`-style tag. The posting-time jitter and the reach-drop alert are being deliberately deferred to follow-up PRs to keep this change small and safe — I'll note that in the PR.",
      createdAt: "2026-07-22T13:57:34Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/88#issuecomment-5046911300",
      isBot: true,
    },
    {
      id: 5060366635,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-07-23T15:38:34Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/88#issuecomment-5060366635",
      isBot: false,
    },
    {
      id: 5063496846,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting (clean rebuild after the prior PR was closed for conflicting with main). Scoping to the **smallest honest, highest-value slice**: guarantee a TikTok post is never byte-identical to the YouTube metadata — per-platform caption/hook differentiation with a humanized varied opener and a native `#fyp`-style tag (the #1 named shadowban trigger: reused metadata). Posting-time jitter and the reach-drop alert are deliberately deferred to follow-up PRs to keep this change small and safe — noted in the PR.",
      createdAt: "2026-07-23T21:14:33Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/88#issuecomment-5063496846",
      isBot: true,
    },
  ],
  82: [
    {
      id: 5109156580,
      author: "claude[bot]",
      authorAvatar: "",
      body: `🤖 **Builder run started** — I've picked this up and am working on it now.

One thing worth flagging up front: I tested the exact failure against real ffmpeg before writing any code, and **the issue body's diagnosis is partly wrong** — but the underlying bug is real and actually *worse* than described. Details will be in the PR.`,
      createdAt: "2026-07-28T20:12:12Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/82#issuecomment-5109156580",
      isBot: true,
    },
  ],
  77: [
    {
      id: 5107998961,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run started — I've picked this up and am working on it now. I'll open a pull request against this issue shortly.",
      createdAt: "2026-07-28T18:14:13Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/77#issuecomment-5107998961",
      isBot: true,
    },
  ],
  70: [
    {
      id: 5062576050,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder starting on this now — fixing the media preview route to support HTTP Range requests so Safari/iPhone can play and scrub previews. Will open one PR shortly.",
      createdAt: "2026-07-23T19:37:50Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/70#issuecomment-5062576050",
      isBot: true,
    },
  ],
  58: [
    {
      id: 5010913815,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run started — I'm implementing this now (auto-post to Meta as an addition to YouTube + TikTok). Will open one PR shortly.",
      createdAt: "2026-07-18T10:26:26Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/58#issuecomment-5010913815",
      isBot: true,
    },
    {
      id: 5010942331,
      author: "claude[bot]",
      authorAvatar: "",
      body: "✅ Opened PR #68 — auto-post to Facebook Reels (YouTube + TikTok + Facebook now). Instagram is deferred there with an explanation. Ready for your review.",
      createdAt: "2026-07-18T10:37:04Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/58#issuecomment-5010942331",
      isBot: true,
    },
    {
      id: 5060364845,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-07-23T15:38:24Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/58#issuecomment-5060364845",
      isBot: false,
    },
    {
      id: 5061512641,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run started — recreating the Meta auto-post cleanly (the earlier PR #68 was closed for conflicting with main). Will open one PR shortly. Facebook Reels ships now; Instagram is deferred with an explanation (its Graph API requires a public video URL this local app can't provide).",
      createdAt: "2026-07-23T17:40:08Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/58#issuecomment-5061512641",
      isBot: true,
    },
  ],
  57: [
    {
      id: 5010659929,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this now — I'll open a PR shortly. Picking this over #58 (Instagram/Facebook auto-post) because it's a small, self-contained safety fix that fits the silent-failure-surfacing pattern the owner has already approved, and it can be verified without external OAuth setup.",
      createdAt: "2026-07-18T08:54:44Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/57#issuecomment-5010659929",
      isBot: true,
    },
    {
      id: 5060363682,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-07-23T15:38:17Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/57#issuecomment-5060363682",
      isBot: false,
    },
    {
      id: 5061262121,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this now — I'll open a PR shortly. Building the smallest honest slice: when a **paid** voice provider (ElevenLabs/OpenAI) actually fails mid-run, record it, log it, and put a visible flag on the affected video so you know it shipped in the free fallback voice instead of silently swapping.",
      createdAt: "2026-07-23T17:12:48Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/57#issuecomment-5061262121",
      isBot: true,
    },
  ],
  51: [
    {
      id: 5000836889,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this now — adding a pronunciation-normalization pass before TTS (shared by the True Crime + History narration pipelines), plus a seed per-niche lexicon and unit tests. Will open a PR shortly.",
      createdAt: "2026-07-17T08:39:52Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/51#issuecomment-5000836889",
      isBot: true,
    },
    {
      id: 5107353211,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-07-28T17:12:53Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/51#issuecomment-5107353211",
      isBot: false,
    },
    {
      id: 5107748445,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this now (clean rebuild after the previous PR was closed for conflicts). Scope: a shared pronunciation-normalization pass that runs on the narration just before TTS — acronym spelling-out, natural year/decade reading, and an editable respelling lexicon — with on-screen captions keeping the original spelling. Will open a PR shortly.",
      createdAt: "2026-07-28T17:51:08Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/51#issuecomment-5107748445",
      isBot: true,
    },
  ],
  27: [
    {
      id: 4990019640,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this now — scoping the **smallest honest slice**: a per-factory link/CTA block automatically appended to every video's description (the description is already generated today; we just never attach the money part). I'll deliberately leave the pinned-first-comment and UTM click-tracking dashboard for a follow-up (both need extra YouTube API scopes / a new analytics surface) and note that in the PR. One PR incoming.",
      createdAt: "2026-07-16T08:59:09Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/27#issuecomment-4990019640",
      isBot: true,
    },
    {
      id: 5060361183,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-07-23T15:38:04Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/27#issuecomment-5060361183",
      isBot: false,
    },
    {
      id: 5060547500,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting now. Rebuilding cleanly per your note. Scoping the **smallest honest slice**: a per-factory link/CTA block automatically appended to every video's description (the description is already generated today — we just never attach the money part). I'll deliberately leave the pinned-first-comment and UTM click-tracking dashboard for a follow-up (both need extra YouTube API scopes / a new analytics surface) and note that in the PR. One PR incoming.",
      createdAt: "2026-07-23T15:56:40Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/27#issuecomment-5060547500",
      isBot: true,
    },
    {
      id: 5060650338,
      author: "claude[bot]",
      authorAvatar: "",
      body: "✅ Opened PR #113 with the smallest honest slice: a per-factory **Links / call-to-action** box (set on the New Factory screen) that's automatically appended to every video's YouTube description, plus a 🔗 badge on the factory card so you can verify it saved at a glance. Build, lint, and all 492 tests pass. Deferred to follow-ups (noted in the PR): editing links after creation, pinned first comment, click tracking, and TikTok.",
      createdAt: "2026-07-23T16:06:22Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/27#issuecomment-5060650338",
      isBot: true,
    },
  ],
  17: [
    {
      id: 5009921875,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder loop: starting on this now — extending the existing anti-repetition (variation + same-clip) gate to the generic sports/reddit pipeline, which today has no template-similarity brake. Will open a PR shortly.",
      createdAt: "2026-07-18T04:36:12Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/17#issuecomment-5009921875",
      isBot: true,
    },
    {
      id: 5060362315,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-07-23T15:38:11Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/17#issuecomment-5060362315",
      isBot: false,
    },
    {
      id: 5060373317,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder loop: starting on this now — extending the existing anti-repetition (variation + visual-signature) gate from the True Crime pipeline to the other factories' shared publish path, so every factory gets a template-similarity brake before publish. Will open a PR shortly.",
      createdAt: "2026-07-23T15:39:13Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/17#issuecomment-5060373317",
      isBot: true,
    },
  ],
  45: [
    {
      id: 4988875224,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🛠️ Builder starting on this now — hardening the defamation safety check (last-name/first-name/alias matching, and routing any un-listed named person with a guilt verb to review instead of auto-publishing) and adding a real unit-test suite around `gate.ts` and `defamationLint.ts`. Will open one PR shortly.",
      createdAt: "2026-07-16T06:27:38Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/45#issuecomment-4988875224",
      isBot: true,
    },
    {
      id: 4988994100,
      author: "claude[bot]",
      authorAvatar: "",
      body: "✅ Opened PR #47 for this. It hardens the defamation guard (surname/first-name matching + routing an un-listed named person to review instead of auto-publishing) and adds the compliance module's first test suites — 28 new checks. Full suite (244 tests) and the production build pass.",
      createdAt: "2026-07-16T06:46:27Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/45#issuecomment-4988994100",
      isBot: true,
    },
    {
      id: 5096273036,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-07-27T20:09:41Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/45#issuecomment-5096273036",
      isBot: false,
    },
    {
      id: 5096426212,
      author: "claude[bot]",
      authorAvatar: "",
      body: `🛠️ Builder starting on this now (clean rebuild after the earlier PR conflicted with main).

Scope, as approved:
1. Tighten name matching in \`defamationLint.ts\` so last-name-only / first-name-only / alias mentions of a stored subject are checked, not skipped.
2. Route "a name appears with a guilt verb but isn't in the case subject list" to human review instead of silently passing.
3. Add the compliance module's first real unit-test suite around \`gate.ts\` and \`defamationLint.ts\`.

Will open one PR shortly.`,
      createdAt: "2026-07-27T20:25:35Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/45#issuecomment-5096426212",
      isBot: true,
    },
  ],
  26: [
    {
      id: 4978954856,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this issue. I'm implementing the **per-run hard stop** first — the promise on the \"create agent\" button (\"Orchestrator will abort the run if Claude + media costs exceed this amount\"). The monthly-ceiling dashboard alert (item #2, the larger \"M\" part) will be a follow-up so this PR stays small and easy to review. Will open a PR shortly.",
      createdAt: "2026-07-15T09:19:29Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/26#issuecomment-4978954856",
      isBot: true,
    },
    {
      id: 5053878532,
      author: "ApagPlayz",
      authorAvatar: "",
      body: "Rebuilding: the previous PR conflicted with main and was closed; re-approved so the Builder recreates it cleanly.",
      createdAt: "2026-07-23T03:09:31Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/26#issuecomment-5053878532",
      isBot: false,
    },
    {
      id: 5054158271,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this issue (clean rebuild). Scope for this PR: the **per-run hard stop** (item #1) — track a run's Claude + media cost and abort with a clear \"hit your $X budget cap\" reason before it bills past the agent's cap. The monthly-ceiling dashboard alert (item #2) stays a follow-up so this PR is small and easy to review. Will open a PR shortly.",
      createdAt: "2026-07-23T03:57:05Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/26#issuecomment-5054158271",
      isBot: true,
    },
  ],
  96: [
    {
      id: 5047529037,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this now — applying the same `withTimeout` stall-guard the true-crime and history pipelines already use to the sports pipeline. Will open a PR shortly.",
      createdAt: "2026-07-22T14:36:53Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/96#issuecomment-5047529037",
      isBot: true,
    },
  ],
  56: [
    {
      id: 5010250220,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder loop starting on this now — mirroring the YouTube 'reconnect needed' flow for TikTok. Will open a PR against it shortly.",
      createdAt: "2026-07-18T06:33:10Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/56#issuecomment-5010250220",
      isBot: true,
    },
  ],
  50: [
    {
      id: 4999672856,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this issue now — wiring the existing `refreshAllMetrics()` into the 60-second background tick (throttled to hourly) and surfacing a 'last refreshed' time on the Winners view. Opening a PR shortly.",
      createdAt: "2026-07-17T06:25:43Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/50#issuecomment-4999672856",
      isBot: true,
    },
  ],
  43: [
    {
      id: 4987964650,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🛠️ Builder starting on this now — wiring the analytics 'learn from winners' feedback loop (write a per-agent winners digest into `Agent.memory` after each metrics refresh, feed it into the script/ideation stage, and surface it on the dashboard). Will open one PR shortly.",
      createdAt: "2026-07-16T03:50:48Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/43#issuecomment-4987964650",
      isBot: true,
    },
  ],
  49: [
    {
      id: 4993547288,
      author: "ApagPlayz",
      authorAvatar: "",
      body: `**Owner feedback for redraft:**

package this with a huge fable level rehaul of the ui/ux desing sending me multiple drafts of what the screens can look like, condense tabs that can be grouped together.`,
      createdAt: "2026-07-16T15:15:12Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/49#issuecomment-4993547288",
      isBot: false,
    },
    {
      id: 4993570625,
      author: "claude[bot]",
      authorAvatar: "",
      body: `Got your note — I've grown this from "just fix TikTok" into the bigger redesign you asked for. A few things:

- **You'll see the look before we build it.** The first step sends you 3 different design drafts of each main screen so you pick the style you like — nothing gets built until you approve one.
- **Fewer tabs.** The seven tabs up top get grouped into three — Home, Studio, Pipeline — plus Settings.
- **TikTok fix rides along** inside the new Settings/connection screens, so it's done properly as part of the fresh look.

It's a bigger job now (L). If you ever want just the TikTok fix shipped fast on its own, say the word — that part alone is a day's work.
`,
      createdAt: "2026-07-16T15:17:34Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/49#issuecomment-4993570625",
      isBot: true,
    },
    {
      id: 4998795868,
      author: "claude[bot]",
      authorAvatar: "",
      body: "Starting on this now (Builder run). Per your redraft note, the first shippable slice is exactly what you asked to see first: **the design drafts to pick from** — 3 different visual styles of each main screen, with the 7 tabs condensed into 3 (Home / Studio / Pipeline) + Settings, and the new TikTok connection screen shown in each. You'll be able to open them in your browser and click around before anything in the live app changes. The actual rebuild and the TikTok-posting code fix come in follow-up PRs once you pick a style — this keeps the change small and reversible.",
      createdAt: "2026-07-17T03:50:51Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/49#issuecomment-4998795868",
      isBot: true,
    },
  ],
  35: [
    {
      id: 5002437788,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder run starting on this now. I'm implementing the background-music bed so true-crime & history narration no longer plays over silence — wiring an actual audio track to the `musicIntensity` curve the pipeline already computes, on both the ffmpeg and Remotion render paths. Will open one PR shortly.",
      createdAt: "2026-07-17T10:55:32Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/35#issuecomment-5002437788",
      isBot: true,
    },
    {
      id: 5002616975,
      author: "claude[bot]",
      authorAvatar: "",
      body: "✅ Done — opened PR #55. It plays a generated, monetization-safe music bed under the narration on both render paths, swelling to the dramatic peak using the musicIntensity curve the pipeline already computes. Fully fail-soft (any error → today's narration-only). All 237 tests pass, build + lint clean, and I verified the audio end-to-end (bed synthesises, mixes under the voice, louder at the climax). Caught & fixed one real bug along the way (a tremolo speed just under ffmpeg's allowed minimum that would've silently skipped the music).",
      createdAt: "2026-07-17T11:13:07Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/35#issuecomment-5002616975",
      isBot: true,
    },
  ],
  94: [
    {
      id: 5037789788,
      author: "claude[bot]",
      authorAvatar: "",
      body: "🤖 Builder loop has started on this issue. Opening a PR shortly that (1) makes the slideshow fallback always cover the full narration and (2) adds a duration safety-check to the finalize gate so half-length videos are held for review instead of auto-published.",
      createdAt: "2026-07-21T18:46:27Z",
      htmlUrl: "https://github.com/ApagPlayz/content-generation-platform/issues/94#issuecomment-5037789788",
      isBot: true,
    },
  ],
};

/**
 * The near-duplicate report, computed for real.
 *
 * These are not illustrative numbers. The pair below was produced by scoring
 * all forty-four ideas above against the committed Titan index
 * (`data/embeddings-titan.json`, built 2026-09-02 from the same repository)
 * with the same cosine + threshold logic `findQueueDuplicates` uses at
 * runtime. #79 and #27 come out at 0.8616, over the 0.842 precision-first
 * operating point swept in `metrics/dedup-eval.json` — and they are a genuine
 * restatement: the Scout proposed "put your links & CTAs on every video" on
 * 14 July, then proposed "auto-add your links to every video's description"
 * again on 20 July, because nothing made it re-read its own queue. That is
 * exactly the failure this strip exists to catch.
 *
 * No other pair among the forty-four clears the threshold, so no other pair is
 * listed. All forty-four have a vector in the index, so `unindexed` is empty.
 */
const IDEAS_DUPLICATES: DuplicateReport = {
  threshold: 0.842,
  thresholdSource: "metrics",
  method: "dense_titan",
  model: "amazon.titan-embed-text-v2:0",
  indexBuiltAt: "2026-09-02T21:02:58.070Z",
  // "local": the committed copy of the index, which is what a deployment with
  // no AWS credentials would fall back to — and what this snapshot was scored
  // against.
  indexSource: "local",
  scored: 44,
  unindexed: [],
  pairs: {
    [DEMO_IDEA_NUMBERS.affiliateLinks]: [
      {
        number: DEMO_IDEA_NUMBERS.ctaLinks,
        title: IDEAS[DEMO_IDEA_NUMBERS.ctaLinks]!.title,
        htmlUrl: IDEAS[DEMO_IDEA_NUMBERS.ctaLinks]!.htmlUrl,
        score: 0.8616,
      },
    ],
    [DEMO_IDEA_NUMBERS.ctaLinks]: [
      {
        number: DEMO_IDEA_NUMBERS.affiliateLinks,
        title: IDEAS[DEMO_IDEA_NUMBERS.affiliateLinks]!.title,
        htmlUrl: IDEAS[DEMO_IDEA_NUMBERS.affiliateLinks]!.htmlUrl,
        score: 0.8616,
      },
    ],
  },
};

const IDEAS_PAYLOAD: IdeasPayload = {
  // Newest first, matching loadIdeas' `byNewest` sort.
  waiting: [
    IDEAS[118]!,
    IDEAS[115]!,
    IDEAS[114]!,
    IDEAS[110]!,
    IDEAS[109]!,
    IDEAS[103]!,
    IDEAS[102]!,
    IDEAS[101]!,
    IDEAS[100]!,
    IDEAS[89]!,
    IDEAS[87]!,
    IDEAS[86]!,
    IDEAS[85]!,
    IDEAS[84]!,
    IDEAS[83]!,
    IDEAS[79]!,
    IDEAS[78]!,
    IDEAS[76]!,
    IDEAS[75]!,
    IDEAS[74]!,
    IDEAS[73]!,
    IDEAS[72]!,
    IDEAS[71]!,
  ],
  approved: [
    IDEAS[126]!,
    IDEAS[90]!,
    IDEAS[88]!,
    IDEAS[82]!,
    IDEAS[77]!,
    IDEAS[70]!,
    IDEAS[58]!,
    IDEAS[57]!,
    IDEAS[51]!,
    IDEAS[27]!,
    IDEAS[17]!,
  ],
  // Empty for real: no issue in the repo carries the `redraft` label right
  // now. The tab renders its own empty state, which is the honest answer.
  redraft: [],
  // Newest-closed first, matching loadIdeas' `byClosed` sort.
  closed: [
    IDEAS[45]!,
    IDEAS[26]!,
    IDEAS[96]!,
    IDEAS[56]!,
    IDEAS[50]!,
    IDEAS[43]!,
    IDEAS[49]!,
    IDEAS[35]!,
    IDEAS[94]!,
    IDEAS[92]!,
  ],
  duplicates: IDEAS_DUPLICATES,
};

/* ------------------------------------------------------------------ */
/* Learnings                                                           */
/* ------------------------------------------------------------------ */

/** `LEARNINGS.md` from the repo, byte for byte. */
const LEARNINGS_MARKDOWN = `# Learnings

Every agent working on this repo reads this file before it starts.

It records **mistakes the loop has already made**, so it stops making them. Only failures
and corrections go here — never successes. A file of self-congratulation would just dilute
the context that every future agent has to load.

Rules: max 50 lines. Dated entries. The weekly retro proposes additions via pull request;
nothing is added here without the owner merging it.

---

- *2026-07-13* — **A green Actions run does not mean the agent did its job.** \`claude-code-action\`
  disables Bash by default; job-level \`permissions:\` grants GitHub rights, not tool-side ones, so
  every \`gh\` call was silently denied (\`permission_denials_count: 20\`, the only place it surfaces).
  Always verify the *outcome* on GitHub (issue/PR/comment exists) — never trust the green tick.
- *2026-07-13* — **\`--allowedTools\` REPLACES the default toolset; it does not extend it.** An allowlist
  must name EVERY tool the agent needs (Read/Grep/Task/WebSearch…), not just the new one. And
  \`Bash(gh:*)\` prefix patterns do NOT match \`$(...)\`, heredocs or pipes — which these agents write
  constantly. In an ephemeral CI container on a private repo, plain \`Bash\` is the right call.
- *2026-07-14* — **A CI agent has ONE turn; backgrounded subagents die with it.** Every Task call in a
  workflow agent MUST set \`run_in_background: false\` so the agent blocks on the result. "I'll wait for
  their findings / report back" = failure: there is no later turn. The job is done only when the
  artifact (issue/PR/comment) actually exists on GitHub, not when the agent decided what to do.
- *2026-07-14* — **A verification step must \`exit 1\`, never \`::warning\`.** Scout detected "0 proposals
  before → 0 after" and only warned, leaving the run green. A red run is information; a green run that
  did nothing is a lie.
- *2026-07-14* — **An unassigned issue never reaches the owner.** GitHub's Inbox only notifies you about
  things you authored / are assigned to / @mentioned in. Scout must pass \`--assignee <owner>\`; Builder
  \`--assignee <owner> --reviewer <owner>\`. Producing the artifact is not the same as delivering it.
- *2026-07-14* — **The Auditor aborts on bot-authored PRs unless allow-listed.** \`claude-code-action\`
  refuses non-human actors before turn 1. Set \`allowed_bots: "claude"\` on the auditor — scope to
  \`claude\`, never \`*\`, or another bot's PR (Dependabot etc.) burns a five-agent audit.
- *2026-07-14* — **GitHub cron is best-effort and silently drops runs** (a 2-hour gap was observed).
  Never rely on a schedule for anything a human waits on: trigger on the event
  (\`issues: types: [labeled]\`) and keep cron as a backstop only.
- *2026-07-14* — **Don't rebuild an issue already being built.** A prompt convention ("comment that you
  started") is not a lock — the next run never reads it. The gate must compute which issues an open
  \`claude/\` PR already claims (\`Closes #N\` in the body) and hand the agent an explicit off-limits list.
- *2026-07-14* — **Agents read the issue BODY, not the thread.** \`gh issue view\` omits comments unless
  you pass \`--comments\`. The owner's clarifications live there and OVERRIDE the body. When he asks
  @claude to change scope, @claude must edit the body so later runs see it.
- *2026-07-17* — **Volume is not progress; an unreviewed PR is WIP, not output.** The Builder's overnight
  review-queue cap was set to 99 (effectively off), so it kept opening large PRs all night regardless of
  whether the owner had merged the last batch — the queue reached 13 open PRs with the last merge 32h
  earlier, median size climbing. A WIP cap that lifts every night isn't a cap. Keep it bounded, and
  prefer the smallest useful slice: big diffs are exactly the ones that never get reviewed.
`;

/** The five most recent commits that touched LEARNINGS.md. */
const LEARNINGS_RETROS: RetroCommit[] = [
  {
    sha: DEMO_SHAS.retroPruneLearnings,
    shortSha: DEMO_SHAS.retroPruneLearnings.slice(0, 7),
    message: "[retro] Record the 07-17 lesson; prune LEARNINGS under its 50-line limit (#64)",
    author: "claude[bot]",
    date: "2026-07-23T03:05:37Z",
    url: `https://github.com/ApagPlayz/content-generation-platform/commit/${DEMO_SHAS.retroPruneLearnings}`,
  },
  {
    sha: DEMO_SHAS.builderOnApproval,
    shortSha: DEMO_SHAS.builderOnApproval.slice(0, 7),
    message: "Builder: start on approval, never build the same issue twice, read the comments (#33)",
    author: "ApagPlayz",
    date: "2026-07-14T20:08:42Z",
    url: `https://github.com/ApagPlayz/content-generation-platform/commit/${DEMO_SHAS.builderOnApproval}`,
  },
  {
    sha: DEMO_SHAS.auditorAllowBots,
    shortSha: DEMO_SHAS.auditorAllowBots.slice(0, 7),
    message: "Let the Auditor review the Builder's PRs (allowed_bots) (#24)",
    author: "ApagPlayz",
    date: "2026-07-14T16:15:40Z",
    url: `https://github.com/ApagPlayz/content-generation-platform/commit/${DEMO_SHAS.auditorAllowBots}`,
  },
  {
    sha: DEMO_SHAS.subagentTurn,
    shortSha: DEMO_SHAS.subagentTurn.slice(0, 7),
    message: "Agents were ending their turn while their subagents were still running (#13)",
    author: "ApagPlayz",
    date: "2026-07-14T15:00:52Z",
    url: `https://github.com/ApagPlayz/content-generation-platform/commit/${DEMO_SHAS.subagentTurn}`,
  },
  {
    sha: DEMO_SHAS.loopRunsContinuously,
    shortSha: DEMO_SHAS.loopRunsContinuously.slice(0, 7),
    message: "Make the loop actually run — fix the silent no-op, then run it continuously (#11)",
    author: "ApagPlayz",
    date: "2026-07-14T11:48:45Z",
    url: `https://github.com/ApagPlayz/content-generation-platform/commit/${DEMO_SHAS.loopRunsContinuously}`,
  },
];

const LEARNINGS_PAYLOAD: LearningsPayload = {
  markdown: LEARNINGS_MARKDOWN,
  lineCount: LEARNINGS_MARKDOWN.split("\n").length,
  retros: LEARNINGS_RETROS,
};

/* ------------------------------------------------------------------ */
/* Loop config                                                         */
/* ------------------------------------------------------------------ */

/**
 * `.github/loop-config.json` as committed in the repo:
 *
 *     { "version": 1, "autonomousBuildEnabled": false,
 *       "prCap": "unlimited", "ideaQueueCap": 25 }
 *
 * There is no `scout` block in the file, so the empty `DEFAULT_SCOUT_CONFIG`
 * below is what `lib/loop-config.ts` really normalises it to — the Scout on
 * this repo runs with no extra steer. Filling the brief in here to make the
 * panel look better would be inventing the owner's product strategy.
 */
const LOOP_CONFIG: LoopConfig = {
  autonomousBuildEnabled: false,
  prCap: "unlimited",
  ideaQueueCap: 25,
  scout: {
    productSummary: "",
    currentGoals: [],
    offLimits: [],
    lenses: [],
    maxPerRun: 3,
  },
  extra: { version: 1 },
};

/* ------------------------------------------------------------------ */
/* Reporter digest                                                     */
/* ------------------------------------------------------------------ */

/**
 * A real pull from the Reporter's own sources, taken with the same
 * `pullAllSources()` the live feature calls, then trimmed to the three feeds
 * whose items stand on their own without the AI enrichment pass (which needs a
 * model call this deployment cannot make). Titles, URLs, dates and summaries
 * are exactly what those feeds returned on 4 September 2026; the source counts
 * below are counts of what is actually in this snapshot, not of the larger pull
 * it came from.
 */
const DIGEST_ITEMS: DigestItem[] = [
  {
    id: "hn:bbcdd2ab6c69",
    source: "Hacker News",
    sourceKey: "hn",
    title: "Claude Code Release Pulse",
    url: "https://bonsai.io/blog/claude-code-pulse/",
    date: "2026-09-04T18:41:24Z",
    category: "community",
    summary: "3 points · 0 comments on Hacker News",
    sortTs: 1788547284000,
    discussionUrl: "https://news.ycombinator.com/item?id=49568496",
  },
  {
    id: "hn:e15885dd733a",
    source: "Hacker News",
    sourceKey: "hn",
    title: "Show HN: Gage – Rust based tool to scan Claude sessions for bugs, other issues",
    url: "https://github.com/gageml/gage",
    date: "2026-09-04T16:13:22Z",
    category: "community",
    summary: "2 points · 2 comments on Hacker News",
    sortTs: 1788538402000,
    discussionUrl: "https://news.ycombinator.com/item?id=49566640",
  },
  {
    id: "hn:bf52c50ce3e8",
    source: "Hacker News",
    sourceKey: "hn",
    title: "Tell HN: Check your Claude settings, it may have silently enabled remote access",
    url: "https://news.ycombinator.com/item?id=49565799",
    date: "2026-09-04T15:09:47Z",
    category: "community",
    summary: "5 points · 4 comments on Hacker News",
    sortTs: 1788534587000,
    discussionUrl: "https://news.ycombinator.com/item?id=49565799",
  },
  {
    id: "hn:acc9b9209285",
    source: "Hacker News",
    sourceKey: "hn",
    title: "Show HN: SiteTweak – a browser extension to modify any website",
    url: "https://chromewebstore.google.com/detail/sitetweak-edit-any-site-w/jnhmhgddbeljneddgcpglgchbdheakbk",
    date: "2026-09-04T13:32:39Z",
    category: "community",
    summary: "5 points · 0 comments on Hacker News",
    sortTs: 1788528759000,
    discussionUrl: "https://news.ycombinator.com/item?id=49564393",
  },
  {
    id: "releases:4c7024aa5b77",
    source: "Claude Code releases",
    sourceKey: "releases",
    title: "Claude Code v2.1.260",
    url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.260",
    date: "2026-09-03T23:48:12Z",
    category: "code-release",
    summary: "Added a diff panel that opens beside the conversation in fullscreen mode and shows your uncommitted changes as Claude edits; toggle it with `/diff` · Added a likely cause for prompt-cache misses (e.g. tool definitions or system prompt changed, idle past the T…",
    sortTs: 1788479292000,
  },
  {
    id: "hn:c62cb22718c8",
    source: "Hacker News",
    sourceKey: "hn",
    title: "Which tools do Claude, Codex and Cursor choose? We measured 17k runs to find out",
    url: "https://armature.tech/blog/which-tools-coding-agents-install",
    date: "2026-09-03T21:20:34Z",
    category: "community",
    summary: "286 points · 140 comments on Hacker News",
    sortTs: 1788470434000,
    discussionUrl: "https://news.ycombinator.com/item?id=49557206",
  },
  {
    id: "releases:9749eb8b3fa7",
    source: "Claude Code releases",
    sourceKey: "releases",
    title: "Claude Code v2.1.259",
    url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.259",
    date: "2026-09-02T22:33:51Z",
    category: "code-release",
    summary: "Added `managedMcpServers` managed setting: organizations can provide HTTP/SSE MCP servers to every user (same entry shape as `.mcp.json`); entries that name a command to run are skipped · Added `--permission-prompts none` for unattended headless hosts: anythi…",
    sortTs: 1788388431000,
  },
  {
    id: "releases:4decb45e87e1",
    source: "Claude Code releases",
    sourceKey: "releases",
    title: "Claude Code v2.1.258",
    url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.258",
    date: "2026-09-01T22:33:20Z",
    category: "code-release",
    summary: "Fixed Claude Code failing to launch on macOS 12 (Monterey), a regression introduced in 2.1.255 · Fixed remote and scheduled sessions failing with \"user messages must have non-empty content\" after a re-sent permission approval could not be applied",
    sortTs: 1788302000000,
  },
  {
    id: "releases:cd1af5b2802b",
    source: "Claude Code releases",
    sourceKey: "releases",
    title: "Claude Code v2.1.257",
    url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.257",
    date: "2026-09-01T17:53:52Z",
    category: "code-release",
    summary: "Added Claude Fable 5.1 (`claude-fable-5-1`), now the default Fable model — 1M context, $10/$50 per Mtok with $0.25/Mtok cache reads · Added \"Time format\" (`timeFormat`) and `timeZone` settings: 12-hour, 24-hour, 24-hour UTC, or a strftime pattern for the turn…",
    sortTs: 1788285232000,
  },
  {
    id: "news:0ed65fdc863b",
    source: "Anthropic news",
    sourceKey: "news",
    title: "Developing Enterprise Frontier Safeguards with our customers",
    url: "https://www.anthropic.com/news/enterprise-frontier-safeguards",
    date: "2026-09-01T00:00:00.000Z",
    category: "news",
    summary: "Developing Enterprise Frontier Safeguards with our customers",
    sortTs: 1788220800000,
  },
  {
    id: "news:8f688693dd47",
    source: "Anthropic news",
    sourceKey: "news",
    title: "Introducing Claude Fable 5.1 and Claude Mythos 5.1",
    url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    date: "2026-09-01T00:00:00.000Z",
    category: "news",
    summary: "Introducing Claude Fable 5.1 and Claude Mythos 5.1",
    sortTs: 1788220800000,
  },
  {
    id: "releases:919a611e986c",
    source: "Claude Code releases",
    sourceKey: "releases",
    title: "Claude Code v2.1.252",
    url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.252",
    date: "2026-08-31T19:46:55Z",
    category: "code-release",
    summary: "Fixed Bash commands failing with \"task output swap refused (tasks dir moved or linked)\" on some Macs · Fixed \"always allow\" not saving in a project that has no .claude/settings.local.json yet · Fixed Remote Control sessions hosted by Claude Desktop or VS Code…",
    sortTs: 1788205615000,
  },
  {
    id: "news:b20d6a332ee0",
    source: "Anthropic news",
    sourceKey: "news",
    title: "Improving our alignment and security efforts",
    url: "https://www.anthropic.com/news/improving-alignment-security-efforts",
    date: "2026-08-31T00:00:00.000Z",
    category: "news",
    summary: "Improving our alignment and security efforts",
    sortTs: 1788134400000,
  },
  {
    id: "news:3dd3e2952e74",
    source: "Anthropic news",
    sourceKey: "news",
    title: "Expanding our support for scientists",
    url: "https://www.anthropic.com/news/expanding-support-for-scientists",
    date: "2026-08-27T00:00:00.000Z",
    category: "news",
    summary: "Expanding our support for scientists",
    sortTs: 1787788800000,
  },
];

const DIGEST_SOURCES: SourceStatus[] = [
  { key: "releases", label: "Claude Code releases", ok: true, count: 5 },
  { key: "hn", label: "Hacker News", ok: true, count: 5 },
  { key: "news", label: "Anthropic news", ok: true, count: 4 },
];

const DIGEST: ServedDigest = {
  items: DIGEST_ITEMS,
  lastUpdated: DEMO_CAPTURED_AT,
  sources: DIGEST_SOURCES,
  // false: this snapshot is all there is. `true` would make the client
  // immediately re-fetch /api/reporter hoping for an enriched build, and get
  // this same object back.
  partial: false,
};

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

/** Read the trailing `/:number` segment off a matched, anchored path. */
function trailingNumber(url: URL): number {
  const segment = url.pathname.split("/").pop() ?? "";
  return Number(segment);
}

export const QUEUE_FIXTURES: DemoFixture[] = [
  {
    match: "/api/ideas",
    methods: ["GET"],
    body: (): IdeasPayload => IDEAS_PAYLOAD,
  },
  {
    // Anchored so this never answers /api/ideas/[number]/chat or
    // /api/ideas/custom — and GET-only, so the POST action route on the same
    // path falls through to a 403 rather than being answered here.
    match: /^\/api\/ideas\/\d+$/,
    methods: ["GET"],
    body: (url): { comments: ThreadComment[] } => {
      const number = trailingNumber(url);
      // An idea number outside the snapshot (nothing a visitor following the
      // UI would ever request) just gets an empty thread rather than a crash.
      return { comments: IDEA_COMMENTS[number] ?? [] };
    },
  },
  {
    match: "/api/learnings",
    methods: ["GET"],
    body: (): LearningsPayload => LEARNINGS_PAYLOAD,
  },
  {
    // GET only — the PATCH that saves config must fall through to a 403, so
    // an anonymous visitor can look at automation settings but never change
    // them.
    match: "/api/loop-config",
    methods: ["GET"],
    body: (): { config: LoopConfig; fingerprint: string } => ({
      config: LOOP_CONFIG,
      fingerprint: loopConfigFingerprint(LOOP_CONFIG),
    }),
  },
  {
    match: "/api/reporter",
    methods: ["GET"],
    body: (): { digest: ServedDigest } => ({ digest: DIGEST }),
  },
];
