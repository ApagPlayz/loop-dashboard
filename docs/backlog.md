# Backlog

The agreed list of what to build next, in order, with the reasoning kept attached so it
survives a context reset. Updated 2026-09-01.

**Direction:** this is a personal project first — a tool the owner actually uses to build
their own projects autonomously on AWS, posted publicly as portfolio work. Selling it is a
later, separate question. Multi-tenancy is deferred (see `design-decisions.md` §7).

---

## 0. Fix the GitHub credential — IN PROGRESS, blocks nothing else but goes first

The `GITHUB_TOKEN` in `.env.local` is **the GitHub CLI's own OAuth token** (`gho_`),
confirmed by hash comparison — not a fine-grained PAT as `.env.example` and `README.md`
claim. It leaked into a local agent log on 2026-08-31. Its scopes are `repo`, `workflow`,
`read:org`, `gist` across the entire account.

**Steps, in this order:**
1. Create a fine-grained PAT at <https://github.com/settings/personal-access-tokens>,
   scoped to the target repo(s), with: Contents (r/w), Issues (r/w), Pull requests (r/w),
   Actions (r/w), **Secrets (read)**, **Workflows**.
   The last two are not documented in `.env.example` — they were found only by reading the
   code (`app/api/map/projects/checklist/route.ts` calls `listRepoSecrets`; writing into
   `.github/workflows/` needs the Workflows permission).
2. Put the new value in `.env.local`. No code changes needed — everything reads one variable.
3. Revoke the leaked token: <https://github.com/settings/applications> → "GitHub CLI" →
   Revoke access. `gh auth logout` does **not** revoke, per gh's own help text.
4. `gh auth login` again to restore the CLI (revoking signs `gh` out on all devices).

**Also:** update `.env.example` to document the two missing permissions. Check what
`GITHUB_TOKEN` is set to in Vercel's environment variables — if it starts with `gho_` it
also needs rotating; if `github_pat_`, it is a separate token and is probably fine.

**Not affected:** `secrets.GITHUB_TOKEN` in the loop workflow templates is GitHub Actions'
auto-issued per-run token. Nothing to rotate.

---

## 1. Add a test suite — highest value per hour

There is currently **no test framework, no test files, no `test` script**. This is the
first thing a reviewer notices, and manual `tsc` + smoke tests is a weak answer.

**Plan:** add Vitest, then 15–20 tests targeting the two areas where a bug is both likely
and expensive:
- **Auth crypto** (`lib/auth.ts`) — signature verification, tampered and expired cookies,
  `SESSION_KEY_VERSION` revocation, constant-time comparison under length mismatch.
- **AI schema validation** (`lib/map-ai.ts`) — `parseLoose` fence-stripping and
  first-object extraction, the retry-on-malformed-JSON path, `AiError` status mapping.

These are pure functions with no network calls, so they are cheap to test and the tests
prove the security claims rather than just asserting coverage. Rank above everything except
the credential fix.

---

## 2. Actually deploy to AWS

Nothing has ever run on AWS; there is no account. Until this happens, none of the AWS
material is honestly claimable on a resume.

1. Create an AWS account, `aws login`, and **request Bedrock model access immediately** —
   it is an approval on Amazon's side, so start that clock first.
2. Pilot Bedrock on **one** non-critical workflow per `docs/bedrock-setup.md`; confirm the
   call appears in CloudTrail. Leave the Scout on the subscription.
3. Stand the container up on ECS, then set five repo variables for
   `.github/workflows/deploy.yml`: `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `ECR_REPOSITORY`,
   `ECS_CLUSTER`, `ECS_SERVICE`. (`AWS_ACCOUNT_ID` is documented in that file's header but
   never actually consumed by it — it only appears inside the role ARN.)
4. Create the EventBridge Scheduler rule, then delete `vercel.json`.

---

## 3. Machine learning work

The owner wants genuine ML on this project — not more LLM API calls, which the project
already does extensively. A brainstorming pass ran 2026-09-01; conclusions to be recorded
here once reviewed. Key constraint to respect: this project has one active repo and ~51
commits of history, so any idea requiring a large training set is a fantasy today. Prefer
ideas whose training signal is **already being collected** (issue/PR outcomes, approval
and rejection decisions, loop-metrics scorecards, retro learnings, tool-fit scores).

---

## 4. Unblock the CGP loop — independent of everything above

CGP's loop is live and running against a **completely empty** `docs/loop-brief.md`
(untouched template, last modified 2026-07-27). Needs: the owner's yes/no on the five
drafted goals in `docs/drafts/cgp-loop-brief-draft-2026-08-18.md`, landing it as CGP's
`docs/loop-brief.md`, and adding a `scout` block to its `.github/loop-config.json`.
Then triage 13 open PRs / 42 open issues — the Scout stands down every run until that
queue moves (last merge 2026-07-28).

---

## Open questions

- Has `CRON_SECRET` been set in Vercel? The cron fails closed without it, by design.
- Was the CGP `@mention` security hole ever exploited? Offered 2026-08-19, never checked.
- The dashboard UI still has not been opened and looked at since the power-menu changes.

## Known gaps deliberately left alone

- Three pre-existing lint errors: `components/help-chat.tsx:55`,
  `components/tools/catalog-browser.tsx:231`, `components/map/power-menu.tsx:221`.
  They predate the AWS work and do not block the build.
