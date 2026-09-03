# Evidence: the LangGraph human-in-the-loop triage agent really runs

**Date:** 2026-09-02 evening local (timestamps in the log are UTC, so they read 2026-09-03).
**Machine:** owner's Mac, `node v26.0.0`, `vite 8.2.2`.
**Repo under triage:** [`ApagPlayz/content-generation-platform`](https://github.com/ApagPlayz/content-generation-platform).
**Mode:** DRY RUN on every single run. `--apply` was never passed. **Zero writes reached GitHub.**
**Raw output:** [`langgraph-run-2026-09-02.log`](./langgraph-run-2026-09-02.log) (443 lines) — everything quoted below is copied verbatim from it.

## Why this file exists

A previous session asserted the agent had been "verified live" but left behind only source
code and unit tests. Unit tests with injected fakes prove the wiring; they do not prove the
graph ever halted on a real backlog. This file is the receipt: real GitHub issues, a real
model call, and the five interrupt behaviours printed out of a live process.

---

## Verdict

**It ran.** Four live runs, all clean, all dry.

| # | Command | Backend | Wall clock | Outcome |
|---|---|---|---|---|
| 1 | `echo "" \| node scripts/triage-cli.mjs --repo=ApagPlayz/content-generation-platform --limit=8` | `cli` (claude-sonnet-5) | 33.3 s total, halted at the interrupt after **26.5 s** | 8 issues triaged, 8 dry-run actions |
| 2 | `echo "126=d 114=n 110=s" \| node scripts/triage-cli.mjs --limit=8` | `cli` | ~34 s | same 8 issues, **3 human overrides changed 3 actions** |
| 3 | `node scripts/triage-interrupt-proof.mjs --limit=8` | `cli` | **55.9 s** (two full graph runs) | all five interrupt proofs below |
| 4 | `DASHBOARD_AI_BACKEND=bedrock … node scripts/triage-cli.mjs --limit=4` | `bedrock` | 1.0 s | **failed — AWS account entitlement, see "Bedrock" below** |

All runs were prefixed with `DASHBOARD_AI_BACKEND=cli` except run 4.

**Real issues processed** (all eight, every run): `#132`, `#130`, `#129`, `#126`, `#118`,
`#115`, `#114`, `#110` — the live open backlog of `content-generation-platform`:

```
#132  decline    conf=0.65  [retro] Week of 2026-08-31
#130  decline    conf=0.65  [retro] Week of 2026-08-09
#129  decline    conf=0.65  [retro] Week of 2026-07-27
#126  approve    conf=0.92  Apply the picked redesign: Style 2 "Warm Creator", light default, single nav
#118  approve    conf=0.85  Teach the app to copy your videos people actually WATCH — not just the ones that got shown
#115  approve    conf=0.85  Stop re-buying the same AI images every video — cache & reuse atmospheric stills to cut the image bill
#114  approve    conf=0.88  TikTok auto-publish is silently broken whenever YouTube posts first — the second platform never goes live
#110  approve    conf=0.85  The crash-recovery safety net can wrongly kill a video that's still rendering — and make you pay to render it twice
```

---

## The five interrupt behaviours

All output below is from run 3, `scripts/triage-interrupt-proof.mjs`, which drives the
compiled graph directly so it can print `getState()` and the raw `__interrupt__`.

### 1. The first `invoke()` HALTS — `__interrupt__` present, no actions taken

```
==============================================================================
RUN A — first invoke(), thread_id = proof-A-1788396878109
==============================================================================
invoke() returned after 26.7s

==============================================================================
PROOF 1 — invoke() HALTED: top-level __interrupt__ present, no actions
==============================================================================
Object.keys(result)        : [
  "repo",
  "limit",
  "apply",
  "items",
  "assessments",
  "proposals",
  "decisions",
  "actions",
  "__interrupt__"
]
"__interrupt__" in result  : true
result.actions             : []   <- no actions taken
result.decisions           : []   <- no decisions yet
result.proposals.length    : 8
```

The `__interrupt__` payload itself (full 8-proposal version, including every issue body, is
in the log at the "full `__interrupt__` payload" marker). Its shape:

```json
[
  {
    "id": "36db0fdae242bee1b6b87720c42d4f13",
    "value": {
      "kind": "triage-review",
      "repo": { "owner": "ApagPlayz", "repo": "content-generation-platform" },
      "proposals": [
        {
          "number": 132,
          "title": "[retro] Week of 2026-08-31",
          "body": "## What the loop actually did this week (2026-08-24 → 2026-08-31)\n\n1. The robots woke up **175 times** …",
          "labels": [],
          "createdAt": "2026-08-31T00:16:11Z",
          "url": "https://github.com/ApagPlayz/content-generation-platform/issues/132",
          "recommendation": "decline",
          "reason": "Auto-generated weekly retro/status report, not a scoped build task — there is no defined deliverable to build.",
          "confidence": 0.65
        }
      ]
    }
  }
]
```

### 2. `getState()` while paused reports `next: ["apply_decisions"]`

```
==============================================================================
PROOF 2 — getState() while PAUSED
==============================================================================
next                       : [
  "apply_decisions"
]
tasks[0].name              : "apply_decisions"
tasks[0].interrupts        : [
  {
    "id": "36db0fdae242bee1b6b87720c42d4f13",
    "valueKind": "triage-review",
    "proposalCount": 8
  }
]
checkpoint id              : "1f1a7321-9d15-6a70-8003-82442b11f26b"
values.actions             : []
```

The checkpoint id is the proof the MemorySaver actually persisted the paused state — that
is what `Command({ resume })` has to reload.

### 3. Resume via `new Command({ resume })` on the SAME `thread_id`

```
==============================================================================
PROOF 3 — resume RUN A via new Command({ resume }) on the SAME thread_id
==============================================================================
thread_id                  : proof-A-1788396878109  (identical to the halted run)
decisions handed back      :
[
  { "number": 132, "action": "decline" },
  { "number": 130, "action": "decline" },
  { "number": 129, "action": "decline" },
  { "number": 126, "action": "approve" },
  { "number": 118, "action": "approve" },
  { "number": 115, "action": "approve" },
  { "number": 114, "action": "approve" },
  { "number": 110, "action": "approve" }
]

resume completed in 0.0s
"__interrupt__" in result  : false   <- gone: it ran through
```

Resume takes ~0 s because no model call happens on the second pass: `apply_decisions`
re-enters from its first line and `interrupt()` returns the resume value instead of
throwing. (That is exactly why `graph.ts` keeps all side effects *below* the `interrupt()`
call — anything above it would run twice.)

### 4. `getState()` after resume reports `next: []`

```
==============================================================================
PROOF 4 — getState() AFTER resume
==============================================================================
next                       : []   <- empty: graph is done
tasks                      : []
values.actions.length      : 8
values.decisions.length    : 8
```

### 5. Different human decisions produce different actions

Run B is a second full live run (fresh `thread_id`, fresh backlog fetch, fresh model call)
where every human decision is deliberately flipped away from the model's recommendation.

```
==============================================================================
RUN B — fresh thread_id = proof-B-1788396904862, human OVERRIDES every recommendation
==============================================================================
invoke() halted again after 29.1s
"__interrupt__" in result  : true
getState().next            : [
  "apply_decisions"
]
```

```
==============================================================================
PROOF 5 — SAME proposals, DIFFERENT human decisions → DIFFERENT actions
==============================================================================
ISSUE  HUMAN A     ACTION A                HUMAN B     ACTION B                DIFFERS
#132   decline     add-label(declined)     needs-info  comment                 YES
#130   decline     add-label(declined)     needs-info  comment                 YES
#129   decline     add-label(declined)     needs-info  comment                 YES
#126   approve     add-label(approved)     decline     add-label(declined)     YES
#118   approve     add-label(approved)     decline     add-label(declined)     YES
#115   approve     add-label(approved)     decline     add-label(declined)     YES
#114   approve     add-label(approved)     decline     add-label(declined)     YES
#110   approve     add-label(approved)     decline     add-label(declined)     YES

8/8 actions changed purely because the human decided differently.
```

Run 2 shows the same thing through the ergonomic CLI, with a *partial* override — the human
typed `126=d 114=n 110=s` and only those three lines moved, including a `skip` that produces
no action at all:

```
WOULD APPLY (8 action(s)):
  • #132 → add label "declined"   [dry-run]
  • #130 → add label "declined"   [dry-run]
  • #129 → add label "declined"   [dry-run]
  • #126 → add label "declined"   [dry-run]      <- human overrode an "approve"
  • #118 → add label "approved"   [dry-run]
  • #115 → add label "approved"   [dry-run]
  • #114 → comment: Triage agent needs more detail…   [dry-run]   <- human overrode an "approve"
  • #110 → skipped (no action)   [dry-run]       <- human skipped it entirely
```

The model recommended `approve` for #126, #114 and #110 in every run. The human's word is
what changed the outcome. That is the human genuinely being in the loop.

---

## Nothing was written to GitHub

- `apply` defaults to `false` in `TriageState` and neither driver script ever sets it true
  without `--apply`; `--apply` was never passed.
- Every action in every run printed `applied=false` / `[dry-run]`.
- `scripts/triage-interrupt-proof.mjs` has no `--apply` path at all — it hardcodes
  `apply: false`.
- The proof harness's own summary line: `writes to GitHub : 0 (apply=false on every run)`.

---

## One real bug found and fixed to get here

The agent itself needed no changes — it ran correctly on the first attempt. But the driver
script had a genuine defect that made one whole backend unreachable.

`scripts/triage-cli.mjs` loaded the TypeScript `lib/` tree with Vite's `runnerImport()`.
That helper **tears its module runner down as soon as the entry module finishes evaluating**.
`lib/map-ai.ts` imports the Bedrock SDK *lazily* (`await import("@anthropic-ai/bedrock-sdk")`,
deliberately, so the CLI and API backends don't pay to load the AWS signing stack). By the
time that lazy import fired, the runner was gone:

```
map-ai(bedrock): Bedrock error  Vite module runner has been closed.
triage-cli failed: Couldn't reach AWS Bedrock. Try again in a moment.
```

Note how badly this misreports itself — a script-lifetime bug surfacing as "Couldn't reach
AWS Bedrock", which would have sent the next person hunting through IAM.

**Fix:** new `scripts/lib/load-ts.mjs` holds a single Vite dev server open for the life of
the process (`createServer` + `ssrLoadModule`, closed in a `finally`), so deferred imports
still resolve. Both driver scripts now use it. After the fix the same command returns a real
AWS response instead of a runner error.

---

## Bedrock: blocked by AWS account entitlement, not by our code

Cross-checking the same graph on `DASHBOARD_AI_BACKEND=bedrock` did not succeed. This is a
hard AWS-side wall and it needs the owner:

```
map-ai(bedrock): Bedrock error 404 404 Model use case details have not been submitted for
this account. Fill out the Anthropic use case details form before using the model. If you
have already filled out the form, try again in 15 minutes.
```

What was tried against account `777164055831` in `us-east-1`:

| Path | Model id | Result |
|---|---|---|
| mantle (Messages endpoint) | `anthropic.claude-sonnet-5` | `permission_error` — not available for this account |
| mantle | `anthropic.claude-haiku-4-5` | `permission_error` |
| mantle | `anthropic.claude-sonnet-4-5`, `-4-6` | `not_found_error` |
| invoke (bedrock-runtime) | `global.anthropic.claude-sonnet-4-5-20250929-v1:0` | briefly succeeded via the AWS CLI, then 404 "use case details" |
| invoke | `global.anthropic.claude-sonnet-4-6`, `global.anthropic.claude-opus-4-6-v1` | briefly succeeded via the SDK, then 404 "use case details" on the next call |

`aws bedrock list-foundation-models --by-provider anthropic` *lists* these models, so the
region is right and the credentials are right — the account simply has not completed
Anthropic's use-case form, and access flickers between "briefly allowed" and 404 while that
is pending. Amazon Titan embeddings on the same account and region still work fine
(re-verified tonight), which confirms this is Anthropic-model entitlement specifically, not
Bedrock access in general.

**Owner action required:** submit the Anthropic use-case details form in the Bedrock console
for account 777164055831. Until then `DASHBOARD_AI_BACKEND=cli` is the working path locally,
and Bedrock stays the deployment story rather than a demonstrated one.

The `api` backend was not reachable either: `.env.local` contains `GITHUB_TOKEN`,
`DASHBOARD_PASSWORD`, `SESSION_SECRET` and `LOOP_DASHBOARD_LOCAL_MODE` — there is **no**
`ANTHROPIC_API_KEY` on this machine, so `aiBackend()` correctly reports `disabled` for it.

---

## Reproducing this

```bash
# the working path
DASHBOARD_AI_BACKEND=cli node scripts/triage-cli.mjs --repo=ApagPlayz/content-generation-platform --limit=8

# the full interrupt proof
DASHBOARD_AI_BACKEND=cli node scripts/triage-interrupt-proof.mjs --limit=8
```

Both are dry-run by default. `triage-cli.mjs` needs `--apply` to write anything;
`triage-interrupt-proof.mjs` cannot write at all.

## Verification run alongside this evidence

- `npx tsc --noEmit` — clean.
- `npm test` — 110 passing.
- `git status` — no changes to any GitHub state; the only new files are these evidence
  files and the loader fix.
- Evidence files grepped for `gho_`, `ghp_`, `sk-ant-`, `AKIA` — no matches. No secret
  values appear anywhere in this directory; only environment variable *names*.
