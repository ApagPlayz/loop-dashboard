# Design decisions

A running record of the architectural choices made in this project, why they were made,
and what was rejected. Each entry is short on purpose. The point is to be able to explain
the system — to a collaborator, to an interviewer, or to yourself in six months.

Format: **what was decided**, **why**, **what was rejected**, **when**. Newest last.
Add an entry whenever a decision shapes the system rather than just the code.

---

## 1. Hosting: ECS Fargate, not Amplify or App Runner

**Decided:** run the dashboard as a container on AWS ECS Fargate.

**Why:** Fargate runs any container, so the app is not constrained by a platform's
framework support, and it is the standard target for a containerised web app.

**Rejected:**
- **AWS Amplify** — caps at Next.js 15. This repo is on Next.js 16.2.10, so it simply
  cannot run there.
- **App Runner** — stops accepting new customers on 30 Apr 2026. Building on a service
  that is closing to newcomers is a dead end.

**Tradeoff accepted:** Fargate needs more setup than a platform-as-a-service (cluster,
service, task definition, load balancer) in exchange for not being boxed in.

**When:** 2026-08-31.

---

## 2. Deployment auth: GitHub OIDC, not stored AWS keys

**Decided:** GitHub Actions authenticates to AWS by federated identity (OIDC), assuming
an IAM role per run.

**Why:** no long-lived AWS access keys are ever stored as GitHub secrets. Each run gets
short-lived credentials that expire on their own. A leaked log cannot leak a permanent key.

**Rejected:** storing `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` as repo secrets — the
common approach, but a permanent credential sitting in a settings page forever.

**When:** 2026-08-31. **Exercised 2026-09-02**: the OIDC provider, the deploy
role, and the trust policy (pinned to `repo:<owner>/loop-dashboard:ref:refs/heads/main`
— one repo, one branch, so a PR or fork run cannot assume it) are live, and a
`Deploy to ECS` run has completed successfully end to end using them.

---

## 3. Model inference: Bedrock, with the Scout kept on the subscription

**Decided:** AI calls can run on Amazon Bedrock in the user's own AWS account, except the
Scout, which stays on the Claude subscription by default.

**Why:** Bedrock keeps model calls, billing, and the audit trail inside one AWS account.
But **the WebSearch tool is not available on Bedrock** (Anthropic's own documentation).
The Scout's job requires citing dated external sources, so moving it to Bedrock would
quietly gut its evidence base without any visible error.

**Consequence:** two independent switches — `aiProvider` for most agents, `scout.aiProvider`
separately, defaulting to subscription.

**When:** 2026-08-31.

---

## 4. Bedrock wiring: two separate workflow steps, not one conditional step

**Decided:** each loop workflow template contains two fully separate `claude-code-action`
invocations gated by `if:`, rather than one step with conditional inputs.

**Why:** combining `use_bedrock` with `claude_code_oauth_token` silently lets the static
credential win, defeating Bedrock entirely with no error to tell you.

**Related gotcha:** the prompts are large (Scout's is 11 KB). Duplicating them across both
branches was avoided with YAML anchors/aliases, supported by GitHub Actions since Sept 2025.

**When:** 2026-08-31.

---

## 5. Storage: no database — JSON files via the GitHub Contents API

**Decided:** application state (project registry, loop config, metrics) lives in JSON and
Markdown files in GitHub repos, read and written through the GitHub API.

**Why:** the data is small, naturally versioned, human-readable, and already lives where
the work happens. Git provides history and rollback for free. No database to run, pay for,
back up, or secure.

**Rejected:** Postgres/SQLite from the start — real infrastructure cost for data that fits
comfortably in a few files.

**Limits to watch:** no transactions, no concurrent-write safety, no querying, and GitHub
API rate limits. This choice stops working the moment there are multiple users or real
query needs — which is exactly what the deferred multi-tenancy phase would force.

**When:** project inception (July 2026), reaffirmed 2026-08-31.

---

## 6. Auth: hand-rolled sessions, single shared password

**Decided:** one password, HMAC-SHA256 signed cookies built on the Web Crypto API, no auth
library.

**Why:** a single-owner dashboard does not need user accounts. Web Crypto works on the Edge
runtime, where Node's `crypto` does not. The signing secret is kept separate from the login
password, and a `SESSION_KEY_VERSION` env var revokes every outstanding session without
changing the password.

**Rejected:** NextAuth/Auth.js/Clerk — designed around multiple users and identity providers,
which is most of their complexity and none of the need here.

**Tradeoff accepted:** hand-rolled auth means hand-rolled mistakes are possible. This is why
constant-time comparison is implemented deliberately in three places, and why these functions
are first in line for the test suite.

**When:** project inception, hardened 2026-08-31.

---

## 7. Product direction: personal project first, selling deferred

**Decided:** finish this as a tool the owner actually uses on their own projects, post it
publicly, and defer multi-tenancy (Cognito, per-tenant database, GitHub App).

**Why:** market research found an open-source competitor with ~6.1k stars covering the same
pitch for free, plus GitHub's own Agent HQ targeting the problem natively. Building
multi-tenancy on spec means paying the full cost of a product before knowing anyone wants it.
Single-tenant own-use costs nothing extra and is the honest version of what this is.

**Consequence:** Phase 4 of the AWS plan is deferred indefinitely, not next.

**When:** 2026-09-01.

---

## 8. Keep `vercel.json` until AWS cutover

**Decided:** the Vercel cron config stays in the repo even though the migration plan says
to delete it.

**Why:** it is currently the only thing running the 6-hourly reporter cron. Deleting it
before the AWS EventBridge Scheduler rule exists would silently stop the reporter with
nothing to replace it.

**Delete when:** the EventBridge rule (`0 */6 * * *` → `/api/reporter/cron`) is live.

**When:** 2026-08-31.

---

## 9. ML stays in TypeScript — no Python runtime, no SageMaker

**Decided:** implement machine learning inside the existing Node/TypeScript app, using
`@huggingface/transformers` (transformers.js) with a local ONNX embedding model. No second
runtime.

**Why:** the data is small — roughly 124 documents and 46 labelled outcomes. Every idea
currently on the list (duplicate detection, retrieval, evaluation harnesses) is served by
embeddings plus cosine similarity and honest metrics, none of which need the Python
ecosystem. A second runtime means a second Dockerfile, a second deploy target, a second
dependency tree, and a second thing to break — on a project that at the time had no AWS
account, no database, and no deployment.

**Rejected:** a Python service (scikit-learn/PyTorch) and SageMaker. Standing up a training
cluster for a 44-row problem is not a credential — at this data scale it signals not knowing
when to leave the heavy tool alone.

**Revisit when:** the proposal-acceptance model has real labels (see `backlog.md` — it needs
the unused `declined`/`redraft` labels wired to a reason capture first). Adding Python *at
the point the data justifies it* is a better story than adding it up front.

**Design note:** the embedding layer takes an `EMBEDDING_BACKEND` switch (`local` and
`bedrock`), deliberately mirroring the existing `cli | api | bedrock` pattern in
`lib/map-ai.ts`. Swapping to a Bedrock-hosted embedding model is one env var, and rerunning
the same evaluation against both gives a backend comparison for free.

**How it paid off (2026-09-02):** the switch cost nothing and returned a real result. Titan
Text Embeddings V2 (AP 0.934 [0.856, 0.987]) and local MiniLM (AP 0.937 [0.844, 0.991]) are
statistically indistinguishable on 150 labelled pairs, so the free local encoder stayed. The
decision to make the backend a switch rather than a rewrite is what made that measurable
instead of hypothetical. The verdict on decision 9 itself is unchanged: still no Python, and
still no SageMaker.

**When:** 2026-09-01.

---

## 10. Testing: Vitest, targeted at the security and parsing code first

**Decided:** add Vitest and start with tests on the auth crypto (`lib/auth.ts`) and the AI
response-parsing paths (`lib/map-ai.ts`), rather than chasing coverage across 31k lines.

**Why:** these are pure functions with no network calls, so they are cheap to test, and they
are where a bug is both most likely and most expensive — a broken signature check is a
security hole, and a broken JSON parser silently corrupts every AI feature. Tests here also
*prove* the security claims the project makes about itself rather than merely asserting them.

**Rejected:** Jest (heavier, slower with ESM/TypeScript here), and broad UI/component testing
(higher effort, lower value at this stage).

**When:** 2026-09-01.

---

## 11. Text the dashboard relays into a repo is sanitized, not trusted

**Decided:** every caller-supplied string the dashboard posts to GitHub next to an "@claude"
goes through `lib/relay-safety.ts` first — length-capped, invisible characters stripped,
@-mentions rewritten to "(at)", fence markers defused, and the remainder fenced between the
existing `UNTRUSTED_OPEN`/`UNTRUSTED_CLOSE` markers from `lib/prompt-safety.ts`. The "@claude"
that actually wakes the agent is the route's own text, outside the fence. Structured inputs
(issue number, action) are validated against integers and an explicit allowlist before any
GitHub call happens.

**Why:** `config/loop-template/workflows/claude-mention.yml` decides who may steer the mention
agent by looking up the **comment author's** repository permission and accepting only
`admin`/`maintain`. That is sound when a person comments and useless when the dashboard does:
the author of anything we post is the dashboard's own GitHub token, which is an admin. The gate
passes automatically, and the relayed text reaches a job with `contents: write`,
`pull-requests: write`, `issues: write`, `actions: write` and Bash. A control meant to ask "may
this person steer the agent?" instead certifies whatever we forward — an authorization gate
inverted into an amplifier. Session auth on those routes (`proxy.ts`, commit `aac0fc6`) is the
first line of defence; this is the second, for a guessed password or a future read-only/demo
deployment.

**Rejected:** truncating over-long input (sends the agent a mangled instruction nobody wrote —
reject with a 4xx instead), and fencing only the `wake: true` path (an unfenced comment still
sits in a thread that a later "@claude" feeds to the agent in full).

**Still open — the stronger fix, deliberately not applied here:** the workflow should gate on
something other than the comment author, because the author is a machine identity we control.
Options, roughly in order of strength: (a) require the mention to come from a human `sender`
whose permission is admin/maintain **and** refuse when the sender is the repo's own token or an
App identity; (b) have the dashboard sign what it relays and have the workflow verify the
signature; (c) drop the relay entirely and have the dashboard trigger the agent through
`workflow_dispatch` with structured inputs rather than by writing English into a comment.
Not done in this pass because `config/loop-template/workflows/` is synced into other repos and
changing it has blast radius beyond the dashboard.

**When:** 2026-09-02.

---

## 9. OIDC trust pinned to GitHub's immutable subject claim

**Decided:** the deploy role `loopDashboardGitHubDeployRole` trusts exactly two subject
strings, both ending `:ref:refs/heads/main`, and the one that actually matches is
`repo:ApagPlayz@44716308/loop-dashboard@1301697678:ref:refs/heads/main`.

**Why the odd-looking subject:** GitHub has begun issuing *immutable* subject claims that
embed the numeric owner id and repository id rather than their current names. The plain
`repo:ApagPlayz/loop-dashboard:ref:refs/heads/main` that every tutorial shows was rejected
with a bare `Not authorized to perform sts:AssumeRoleWithWebIdentity`, and CloudTrail
redacts `requestParameters` on a failed assume-role, so the error names nothing. The
authoritative answer came from
`gh api /repos/OWNER/REPO/actions/oidc/customization/sub`, which reports the
`sub_claim_prefix` GitHub will actually mint. Check that endpoint first when an OIDC trust
policy denies for no visible reason.

This is a security improvement, not just a quirk: numeric ids survive a rename, so trust
cannot be inherited by whoever claims the old name after a repo is renamed or deleted.

**Why both strings:** the name-based form is kept as a fallback so the pipeline does not
break if GitHub serves the legacy subject during the transition. Both are exact
`StringEquals` matches on `main`, so this is two allowed values, not a widened wildcard.

**Rejected:** `StringLike` with `repo:ApagPlayz/loop-dashboard:*`. It is the usual
shortcut, but it lets *any* ref in the repo mint deploy credentials — including a branch
pushed by anyone who can open a PR — and those credentials can push images and update the
running service. Scoping to a single branch costs nothing and removes that path.

**Permission scoping:** resource-level everywhere it exists — ECR pushes limited to the
`loop-dashboard` repository, `ecs:UpdateService` to the one service ARN, CloudFront writes
to distribution `E1B8EXHI4E3CYX`, and `iam:PassRole` to the two ECS roles under an
`iam:PassedToService=ecs-tasks.amazonaws.com` condition. Only
`ecr:GetAuthorizationToken`, `ecs:RegisterTaskDefinition` and
`ec2:DescribeNetworkInterfaces` sit on `"*"`, because AWS gives those three no
resource-level support. No managed policies are attached. The role has no `ssm:GetParameter`
permission, because the app's secrets are injected into the container by the *task execution*
role, not by CI — the pipeline never handles them.

**When:** 2026-09-03.

---

## 12. Near-duplicate detection scores in the web tier, not in the deployed Lambda

**Decided:** the Ideas screen finds near-duplicate proposals by loading the precomputed
embedding index through `lib/dedup/artifact-store.ts` and taking dot products **in the
Next.js server**, inside the existing `GET /api/ideas` request. It does not call
`loop-dashboard-dedup-infer`, the deployed IAM-authed Function URL that does the same
scoring in AWS.

**Why:** every idea on that screen is *already in the index*. Its vector was computed when
`build-index.mjs` ran, so scoring the queue against itself is a `Map` lookup and a dot
product — **no embedding call, no Bedrock spend, no ONNX model in the web tier (which the
alpine container cannot run anyway), no runtime AWS credentials beyond the S3 read the
artifact store already does and already falls back from.** Measured on the pilot queue:
0.67 ms to score 44 ideas (946 pairs at 1024 dims) warm, 5 ms cold off the local file. That
cost is why it runs on every queue load rather than behind a button — there is nothing to
defer.

Calling the Function URL would mean signing SigV4 from the web tier, holding credentials
for it there, and paying for one `InvokeModel` **per idea per page view** to re-derive a
vector sitting in the very index the Lambda then downloads from S3. Slower, billable, more
failure modes, same number.

**What this does NOT mean:** the Lambda was not a mistake and is not dead code. It scores
text that is **not** in the corpus — and that case is now wired: the **custom-idea
composer** checks the owner's unfiled draft through it (`POST /api/ideas/custom/dedup` →
`lib/dedup/infer-client.ts`). A draft has never been embedded, so there is no vector to
look up and no local shortcut; going through the Function URL also keeps `bedrock:InvokeModel`
and `s3:GetObject` on the Lambda's own execution role, leaving the web tier needing exactly
one permission (`lambda:InvokeFunctionUrl`) instead of two broader ones.

Stated plainly because it is on a résumé: **the endpoint is deployed, healthy, and called by
the product — but not yet from the deployed container**, which has neither the Function URL
in its task definition nor that IAM permission on its task role. The Scout's own
check-before-filing (§3 step 6 of the backlog) remains unwired.

**Rejected:**
- **Call the Function URL from `/api/ideas`.** The name-drop option. See above.
- **Re-embed with the local MiniLM backend in-process.** 90 MB ONNX download into a request
  path, on a musl container where `onnxruntime-node` is unreliable — to recompute vectors
  that already exist. This is the mistake §8.4 of ARCHITECTURE.md warns about, one screen
  over.
- **A separate `/api/ideas/duplicates` route.** It would have to re-run `loadIdeas()` —
  eight paginated GitHub queries — to know which ideas to score, doubling the screen's
  GitHub cost for one extra round trip. Folding it into the existing payload also means the
  public demo's anonymous API surface is **unchanged**: no new route, no new fixture path,
  no edit to the exact-match assertion in `tests/lib/public-access.test.ts`.
- **Hard-coding 0.842.** The threshold is read from `metrics/dedup-eval.json` at runtime, so
  re-running `evaluate.mjs` moves the product's operating point; the constants in
  `queue-duplicates.ts` are a documented fallback carrying the eval's own caveats. The
  Lambda still hard-codes it, which is the drift this avoids.
- **Reusing Titan's threshold for the MiniLM fallback index.** 0.842 was swept for Titan;
  MiniLM's own precision-first point is 0.828. A threshold calibrated for one encoder means
  nothing applied to another, so the threshold moves with the index and the UI names which
  encoder produced the score.

**When:** 2026-09-03.
