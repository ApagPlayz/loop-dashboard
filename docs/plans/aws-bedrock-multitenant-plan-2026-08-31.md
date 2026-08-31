# Loop Dashboard → multi-tenant AWS product with a Bedrock AI option

**Written:** 2026-08-31
**Audience:** the engineer(s) who will build this. Each phase opens with a plain-English "why" for the owner; the detail under it is for the builder.
**Status:** plan only. No application code was changed to produce this document.

---

## 0. What exists today (verified against the code on 2026-08-31)

Read this first — every estimate below depends on it being accurate.

| Thing | Reality |
|---|---|
| Framework | Next.js **16.2.10**, App Router, React 19.2.4, TypeScript, Tailwind 4. ~30,500 lines of `.ts`/`.tsx`, 67 API routes. |
| What it does | Control plane for an autonomous "Loop" of GitHub Actions agents (Scout / Builder / Auditor / Demo / Retro / Redraft / Tool-install / Metrics) that run **inside the customer's own repo**, via `anthropics/claude-code-action@v1`. |
| Where the AI runs | Not in the dashboard. The agents are GitHub Actions steps in the customer's repo, authenticated with a repo secret `CLAUDE_CODE_OAUTH_TOKEN` (8 template workflows use it). |
| Database | **None.** `config/projects.json` in *this* repo is the project registry (read/written through the GitHub Contents API, 60s in-process cache, `lib/projects.ts`). Per-project loop settings live in `.github/loop-config.json` in each target repo (`lib/loop-config.ts`). |
| Ephemeral state | In-process `Map`s plus `os.tmpdir()` JSON files in `lib/map-ai-jobs.ts`, `lib/launcher-jobs.ts`, `lib/tool-fit-jobs.ts`, `lib/tool-fit.ts`, `lib/reporter-store.ts`. All documented as best-effort; none survives an instance recycle. |
| Auth | One shared password. `lib/auth.ts` uses `DASHBOARD_PASSWORD` **directly as the HMAC-SHA256 signing key** for the session cookie. No users, no roles, no revocation, no rotation. `proxy.ts` gates every path except `/login` and `/api/login`. |
| GitHub access | One process-wide Octokit singleton (`lib/github.ts` `getOctokit()`), one `GITHUB_TOKEN` fine-grained PAT for everything. Server-side only, never sent to the client — but global, not per-tenant. Every helper already takes a required `repo: RepoConfig` argument, which is lucky. |
| AI backend | `lib/map-ai.ts`, two engines. `cli` = `execFile` of a local `claude` binary (Mac-only; dies in any container). `api` = a hand-rolled `fetch` to `api.anthropic.com/v1/messages` with **forced tool use** (`tool_choice: {type:"tool"}`) for structured output. Selected by `DASHBOARD_AI_BACKEND=cli|api|auto`. |
| Help chat | `aiChatCall()` in `lib/map-ai.ts` is **CLI-only with no API fallback** — the in-dashboard assistant is already dead in any cloud deployment. |
| Blast radius of the AI layer | Only **13 files** call `aiStructuredCall` / `aiChatCall`. Everything funnels through `lib/map-ai.ts`. |
| Mac-only surface | `lib/launchers.ts`, `lib/local-folders.ts`, `app/api/launch/*` (4 routes), `app/api/projects/local-scan`, `app/api/projects/local-init`. All `execFile` on the host. |
| Hosting today | Vercel. `vercel.json` declares one cron (`/api/reporter/cron`, every 6h). `next.config.ts` is empty. |
| Known security gaps | (a) `/api/launch/*` spawns local processes behind only the session cookie; (b) `/api/reporter/cron` is **fully open** when `CRON_SECRET` is unset (`app/api/reporter/cron/route.ts:22-30`). |

Two facts shape the whole plan:

1. **The UI and the GitHub-integration layer survive.** `lib/github.ts` helpers all take an explicit `repo` already. The 67 routes mostly resolve a project first. This is not a rewrite.
2. **45 of the 67 routes already call `resolveProject` / `resolveProjectFromUrl`.** That function is the natural chokepoint for tenant scoping. Only 22 routes need individual attention (listed in §3.4).

---

## 1. Summary & recommended sequencing

### In plain English

There are three separate jobs here and they are **not** equally hard, equally risky, or equally urgent. Doing them in the wrong order wastes months.

- **Job A — "let the AI run in the customer's own AWS account" (the compliance pitch).** This is the *smallest* job and the one with the biggest sales value. It's a change to the workflow template files this dashboard already manages. It touches almost no dashboard code and it can ship **before anything else**, on Vercel, today.
- **Job B — "move the dashboard onto AWS."** Medium job, mostly plumbing. It's a prerequisite for the dashboard's own AI calls using AWS identity instead of pasted keys, and for having a database in a private network. Nothing about it changes how the product behaves.
- **Job C — "make it multi-tenant."** By far the biggest and riskiest. Real users, real database, real per-customer GitHub credentials, and a tenant ID threaded through everything. Do it last, when the ground under it has stopped moving.

### Recommended order

| Phase | Work | Why here | Rough effort |
|---|---|---|---|
| **0** | Fold-in security fixes (§5) | Days, not weeks. Two of them get *worse* the moment this is multi-tenant, so fix them before anyone else is on the box. | 2–3 days |
| **1** | **Bedrock in the loop templates** (§4.2) — `use_bedrock` + GitHub OIDC → IAM role in the *customer's* account | Fully self-contained. Zero dependency on hosting or multi-tenancy. It is the compliance story, and it's testable on one pilot repo this week. | 3–5 days + a pilot run |
| **2** | **Hosting migration to AWS** (§2) — container → ECS Fargate behind ALB + CloudFront | Prerequisite for Phase 3 (IAM task role instead of static keys) and Phase 4 (a database in a VPC). Behaviour-neutral, so it can be validated by "does the app still work". | 1.5–3 weeks |
| **3** | **Bedrock for the dashboard's own AI** (§4.1) — swap `lib/map-ai.ts` to `@anthropic-ai/bedrock-sdk` | One file. Lands cleanly *after* Phase 2 because it can then authenticate with the ECS task role and hold no secrets at all. Also the moment to revive the dead help-chat assistant. | 3–5 days |
| **4** | **Multi-tenancy core** (§3) — Cognito, Postgres, GitHub App, tenant threading | Last. Biggest. Every earlier phase reduces its surface. | 6–10 weeks |

### What can run in parallel

- Phase 1 and Phase 2 are **completely independent** — one is YAML in `config/loop-template/`, the other is infrastructure. Two people can run them at once.
- Phase 3 depends on Phase 2 only for the *nice* version (task-role auth). It could ship on Vercel with static AWS keys if you're impatient; don't, the keys become a liability.
- Phase 4 depends on Phase 2 (needs a VPC/database) and benefits from Phase 1 being settled (the onboarding checklist changes shape once Bedrock is an option).

### One-line answer to "can Bedrock ship before multi-tenancy?"

**Yes, and it should.** The Bedrock work is self-contained in `lib/map-ai.ts` (dashboard side) and `config/loop-template/workflows/*.yml` (loop side). Neither touches auth, the database, or the project registry.

---

## 2. Stream 1 — Hosting migration (Phase 2)

### Why (plain English)

Vercel runs this app as short-lived serverless functions, which is why the AI job files under `/tmp` keep vanishing and why the local `claude` binary can never be there. Moving to a long-lived container on AWS fixes both, puts the app next to a database and next to Bedrock, and means we stop pasting API keys into a hosting dashboard — the container gets an AWS identity instead. Nothing the user sees changes.

### 2.1 Two current facts that decide the target

Both were verified on 2026-08-31 and both would have led to the wrong choice from stale knowledge:

- **AWS Amplify Hosting still caps at Next.js 15.** This repo is on `next@16.2.10`. Amplify is out. (Amplify is in the Next.js Adapter working group and a first-party AWS adapter is "in active development", but nothing shipped — Next.js 16.2's stable Adapter API currently has only the Vercel and Bun adapters published, with AWS/Netlify/Cloudflare "expected later this year".)
- **AWS App Runner is being retired.** It stops accepting new customers on **30 April 2026** and is in maintenance (no new features). AWS's own recommendation is **Amazon ECS Express Mode**. Do not build on App Runner.

So the target is a container on **ECS Fargate**. Two flavours:

| Option | What it is | Use it when |
|---|---|---|
| **ECS Express Mode** | ECS creates the cluster, a shared ALB (up to 25 services per ALB), listener, target group, security groups, CloudWatch log group + Container Insights, IAM roles, and target-tracking autoscaling from just: a container image, a task execution role, an infrastructure role. Gives you a `*.ecs.*.on.aws` URL. No surcharge over Fargate pricing. | The **first deploy**. Gets you a running dashboard on AWS in about a day. |
| **Standard ECS Fargate service** | You define the cluster, service, task definition, ALB, target group, autoscaling, and IAM yourself (CDK/Terraform). | The **product**. You will need a custom domain, WAF, CloudFront, blue/green deploys, and fine-grained task-role IAM — all of which are easier to express directly. |

**Recommendation:** stand it up on **Express Mode first** to de-risk the container, then move to a **standard ECS Fargate service behind an ALB, with CloudFront in front** before you take money for it. Do not skip the CloudFront layer — it's where TLS, WAF, and static-asset caching live.

Next.js's own position supports this: `next start` in a Docker container is listed as supporting **all** Next.js features, and `proxy.ts` "works self-hosted with zero configuration when deploying using `next start`". In Next 16, Proxy **defaults to the Node.js runtime** (it was renamed from Middleware in 16.0.0 and the `runtime` config option is rejected in Proxy files) — which is exactly what you want, because Phase 4 will do JWKS verification in there.

### 2.2 Code / file changes

| File | Change |
|---|---|
| `next.config.ts` (currently empty) | Add `output: "standalone"` so the Docker image ships only the runtime files it needs. |
| `Dockerfile` (**new**) | Multi-stage: `deps` → `builder` → `runner` on `node:22-alpine`. Runner copies `.next/standalone`, `.next/static`, and `public`; runs as a non-root user; `ENV PORT=3000 HOSTNAME=0.0.0.0`; `CMD ["node","server.js"]`. |
| `.dockerignore` (**new**) | Exclude `.next`, `node_modules`, `.git`, `docs`, `.env*`. |
| `app/api/health/route.ts` (**new**) | Returns `{ok:true}`, 200, no auth. **Load-bearing:** without it the ALB health check hits `/`, `proxy.ts` 307-redirects it to `/login`, and the target is marked unhealthy. |
| `proxy.ts` | Add `/api/health` to the always-public list alongside `/login` and `/api/login`. This is the *only* change this file needs in Phase 2. |
| `vercel.json` | Delete. The cron moves to EventBridge Scheduler (below). |
| `.env.example` | Rewrite: document that secrets now come from Secrets Manager via the ECS task definition, not `.env.local`. |
| `.github/workflows/deploy.yml` (**new**, in *this* repo) | On push to `main`: OIDC → IAM role → `docker build` → push to ECR → `aws ecs update-service --force-new-deployment`. No long-lived AWS keys in GitHub. |

### 2.3 AWS resources created

- **ECR** repository `loop-dashboard`, with a lifecycle policy (keep last 20 images).
- **ECS cluster** + **Fargate service** (start at 1 task, 0.5 vCPU / 1 GB; autoscale 1→4 on CPU 60%).
- **ALB** (HTTP→HTTPS redirect, health check on `/api/health`) + **target group**.
- **CloudFront** distribution in front of the ALB + **ACM certificate** (us-east-1 for CloudFront) + **Route 53** record.
- **AWS WAF** web ACL on the CloudFront distribution (rate limiting, AWS managed rule sets).
- **Secrets Manager** secrets for `DASHBOARD_PASSWORD` (until Phase 4 removes it), `GITHUB_TOKEN`, `CRON_SECRET`, `SESSION_SECRET`. Injected via the task definition's `secrets` block, never in `environment`.
- **IAM**: a task **execution** role (ECR pull, CloudWatch logs, Secrets Manager read) and a task role (empty for now; Phase 3 adds Bedrock, Phase 4 adds RDS/Secrets).
- **EventBridge Scheduler** rule replacing the Vercel cron: every 6h, hit `https://<domain>/api/reporter/cron` with `Authorization: Bearer <CRON_SECRET>`. (Or an EventBridge → Lambda → HTTP shim if you'd rather not expose the endpoint publicly at all.)
- **CloudWatch** log group + alarms on 5xx rate and task restarts.
- **VPC**: 2 public subnets (ALB) + 2 private subnets (tasks) + NAT gateway or VPC endpoints. Phase 4's database goes in the private subnets.

### 2.4 Things that break in a container and must be handled

- `lib/local-folders.ts`, `lib/launchers.ts`, `app/api/launch/*`, `app/api/projects/local-*` all `execFile` on the host. In a container they either fail or, worse, succeed against the container's filesystem. **Gate them behind an env flag** — see §5.1, which is Phase 0 work and lands before this.
- `lib/map-ai.ts`'s `cli` backend probes for a `claude` binary at `~/.local/bin/claude` etc. In a container `findCli()` returns `null` and `aiBackend()` falls through to `api` — correct today, and Phase 3 makes it fall through to `bedrock`.
- **Multi-instance ISR cache.** Next's disk cache is per-task. Almost every route here is `export const dynamic = "force-dynamic"`, so this is low risk, but if you scale past 1 task and start seeing stale pages, configure a `cacheHandler` in `next.config.ts` (Redis/ElastiCache) per Next's self-hosting guide.
- The in-process caches (`registryCache` in `lib/projects.ts:59`, `manifestCache` at `:182`, `CACHE` in `lib/queues-evidence.ts:38`, `checkoutCache` in `lib/local-folders.ts:103`) become per-task rather than global. Harmless for a 60s TTL; noted here because Phase 4 makes them a *correctness* issue (§3.4).

### 2.5 Effort

**1.5–3 weeks** for one engineer, including the CDK/Terraform, the deploy pipeline, and a working custom domain. Express Mode alone gets a URL in ~1 day.

---

## 3. Stream 2 — Multi-tenancy core (Phase 4)

### Why (plain English)

Right now there is one password, one GitHub token, and one list of projects that lives in a file inside this very repo. That is a personal tool. To sell it, three things have to become real: **who you are** (accounts, not a shared password), **whose data this is** (a database with a customer ID on every row), and **whose GitHub this is** (each customer's own connection, not one token that can reach everything). This is the big one — plan a couple of months, not a couple of weeks.

### 3.1 Database: **Aurora Serverless v2 PostgreSQL** — decided

**Recommendation: PostgreSQL (Aurora Serverless v2), one database, `tenant_id` on every table, Row-Level Security on top.**

Reasoning against DynamoDB *for this specific data shape*:

- The data is a **control plane**, not a workload: tenants, users, memberships, project configs, GitHub installation records, job/audit rows. Thousands of rows per tenant, not millions. DynamoDB's actual win — single-digit-ms reads at unbounded scale — buys nothing here.
- The **access patterns are not known yet.** This is a product still finding its shape. In DynamoDB every new question ("which tenants have a project on repo X?", "show me all failed jobs this week across tenants") is a new GSI and a data-model conversation. In Postgres it's a `WHERE` clause. That difference compounds over the first year.
- The genuine DynamoDB advantage worth wanting is **IAM-enforced isolation** via `dynamodb:LeadingKeys` on a per-tenant assumed role — a tenant-scoping bug gets blocked by AWS itself. Postgres's answer is **Row-Level Security**: set `app.tenant_id` per connection/transaction and let the database refuse cross-tenant rows. It is meaningfully weaker (a compromised app can `SET` a different tenant) but it is the same *shape* of defence and costs a fraction of the design tax.
- Aurora Serverless v2 scales down to 0 ACU between requests, so the pilot-scale bill is small, and you get full Postgres (`jsonb` for the loop-config blobs, transactions for onboarding's multi-step writes).

**Where DynamoDB genuinely fits and is being deliberately declined:** the four ephemeral job stores (`map-ai-jobs`, `launcher-jobs`, `tool-fit-jobs`, `reporter-store`) are TTL'd key-value, which is DynamoDB's home turf. Putting them in Postgres means an `expires_at` column and a sweep job. **Take the sweep job.** One datastore beats two for a small team; revisit only if job volume gets loud.

Sketch schema (10 tables is enough for v1):

```
tenants(id, name, slug, plan, created_at)
users(id, cognito_sub UNIQUE, email, created_at)
tenant_members(tenant_id, user_id, role)           -- owner | admin | viewer
projects(id, tenant_id, key, owner, repo, label, added_at)   -- replaces config/projects.json
github_installations(tenant_id, installation_id, account_login, installed_at)
loop_templates(tenant_id NULL, section, filename, content)   -- NULL tenant = the shipped default
ai_jobs(id, tenant_id, kind, status, input jsonb, result jsonb, error, consumed, created_at, expires_at)
reporter_digests(tenant_id, digest jsonb, last_updated)
audit_log(id, tenant_id, actor_user_id, action, target, detail jsonb, at)
tenant_settings(tenant_id, key, value jsonb)                 -- ai backend, model, region, ...
```

`UNIQUE(tenant_id, key)` on `projects` — **not** `UNIQUE(key)`. Two customers will both have a repo called `website`.

### 3.2 Auth: **Amazon Cognito user pools (Essentials tier) with Managed Login** — decided

**Recommendation: Cognito.** One user pool for the whole product; tenant membership lives in *your* `tenant_members` table, not in Cognito groups.

Reasoning:

- The entire product pitch is "runs on AWS". Adding a second identity vendor undercuts that and adds a bill, a status page, and a data-processing agreement.
- Cognito **Essentials** ($0.015/MAU, first 10,000 MAU free) includes **Managed Login** — a hosted, brandable sign-up/sign-in/reset/passwordless UI. That deletes a whole sprint of forms you'd otherwise write. (Lite is cheaper but has no Managed Login; **Plus** at $0.02/MAU adds adaptive auth, compromised-credential detection, and exportable auth-event logs — buy Plus the day an enterprise buyer asks about threat protection, not before.)
- Enterprise SAML/OIDC federation is supported when a buyer demands SSO, without changing your app code.

**Do not** create a user pool per tenant, and **do not** model tenants as Cognito groups. One pool, `sub` → `users.cognito_sub`, memberships in Postgres. Multiple pools is the "silo" pattern and is only worth it if you later sell a dedicated-isolation tier.

**Alternatives considered and declined:** *WorkOS* is genuinely better at enterprise SSO onboarding (self-serve SAML setup for the buyer's IT team, per-connection pricing) and is the right switch **if** enterprise SSO becomes the sales blocker — that's the trigger to revisit, and the swap is contained because you'd still be verifying a JWT in the same place. *Auth0* has the best developer experience and the worst price curve; declined on cost.

### 3.3 GitHub credentials: **GitHub App with per-installation tokens** — decided

**Recommendation: build a GitHub App. Do not store customer PATs.**

Reasoning:

- **Rate limits.** An installation token gets **15,000 requests/hour, isolated per installation**. A PAT gets 5,000/hour shared across everything that user's token touches. With one shared PAT today, two busy tenants would throttle each other.
- **Nothing long-lived to store.** You store the App ID and one private key (a single Secrets Manager secret) plus each tenant's `installation_id` in Postgres. Installation tokens are minted on demand and expire in an hour — cache them ~50 minutes; do not mint per request (that's the documented way to trip GitHub's secondary rate limits).
- **Revocation is the customer's.** They uninstall the app; every token dies. A PAT has to be revoked by the person who made it, and breaks silently when they leave the company.
- **Attribution.** PAT actions are attributed to a human. App actions are attributed to the app — correct for an audit log, and correct for the customer's own compliance review.
- **Sales.** "Install our GitHub App and pick which repos" is a one-click flow with GitHub's own permission UI. "Create a fine-grained PAT with Contents, Issues, Pull requests and Actions and paste it here" is a support ticket.
- **It unlocks features you can't have today.** `app/api/map/projects/checklist/route.ts:38-43` currently admits it *cannot* verify a GitHub App installation ("a fine-grained PAT cannot list GitHub App installations"). With your own App, `GET /app/installations` works and the checklist becomes real. With the `secrets: write` permission, onboarding can set repo secrets itself instead of telling the owner to run `gh secret set` by hand (`checklist/route.ts:36-37`).

**Effect on the loop templates — read this carefully.** The workflows in `config/loop-template/workflows/` authenticate *inside the customer's repo*, separately from the dashboard. Today they rely on `anthropics/claude-code-action@v1` minting its own GitHub App token from OIDC (which is why every workflow has `id-token: write`). Under Bedrock (§4.2) the action needs an explicit `github_token`. Three options, and the choice matters:

| Identity for the workflow | Consequence |
|---|---|
| The **official Claude GitHub App** (`github.com/apps/claude`) | Simplest; customer installs it once; the action mints its own token. **Recommended default.** |
| A **customer-owned custom GitHub App** | Narrowest permissions (Contents, Issues, Pull requests — read+write). For customers with an app-approval process. |
| `secrets.GITHUB_TOKEN` | No setup — but **GitHub does not trigger downstream workflows on commits made with it.** `repo-tests.yml` would stop running on Builder PRs. **Do not use for this loop.** |

**Never put your product's App private key into a customer's repo secrets.** Your App is for the dashboard's control-plane calls only.

### 3.4 Code changes — the real map

The single most important scoping decision: **do not add a `tenantId` parameter to 67 route handlers.**

Introduce `lib/tenant-context.ts` backed by Node's `AsyncLocalStorage`. `proxy.ts` verifies the session and puts the tenant ID on the request; a thin `withTenant(handler)` wrapper (or a `getTenantContext()` called at the top of each route) reads it. Then `getOctokit()` and `resolveProject()` pick the tenant up implicitly and **their existing call sites don't change**. This is what keeps the estimate at weeks instead of months.

| File | Change | Size |
|---|---|---|
| `lib/auth.ts` | **Replace.** Delete `verifyPassword`/`getSecret`/`DASHBOARD_PASSWORD`. Verify Cognito ID/access JWTs against the pool's JWKS (`aws-jwt-verify`), map `sub` → `users`, load memberships. If you keep a first-party session cookie, sign it with a real `SESSION_SECRET` from Secrets Manager — never with a user-supplied password. | Rewrite, ~150 lines |
| `proxy.ts` | Verify the Cognito session; on success attach tenant + user via `NextResponse.next({ request: { headers } })`. Public paths become `/login`, `/api/auth/*`, `/api/health`. Runs on the Node runtime in Next 16, so JWKS verification is fine here. | ~60 lines |
| `lib/tenant-context.ts` (**new**) | `AsyncLocalStorage<{tenantId, userId, role}>` + `getTenantContext()` + `withTenant()`. | ~60 lines |
| `lib/github.ts` | `getOctokit()` singleton (`:26-39`) becomes a per-tenant, cached factory: look up `installation_id`, mint/reuse an installation token, return an Octokit. Everything below `getOctokit()` in that file is untouched because every helper already takes an explicit `repo`. | ~80 lines changed, ~570 untouched |
| `lib/projects.ts` | `DASHBOARD_REPO`, `REGISTRY_PATH`, `PILOT_PROJECT`, `registryCache` all go. `listProjects`/`addProject`/`resolveProject` read/write the `projects` table filtered by tenant. `resolveProject` becoming tenant-aware **fixes 45 routes at once**. | Substantial rewrite of the registry half, ~150 lines |
| `lib/map-ai-jobs.ts`, `lib/launcher-jobs.ts`, `lib/tool-fit-jobs.ts`, `lib/reporter-store.ts` | Replace the `Map` + `os.tmpdir()` pattern with a shared `lib/jobs-store.ts` backed by the `ai_jobs` table (+ `tenant_id`, + `expires_at`). Same public API, so their callers don't change. The "job orphaned by a restart" logic (`map-ai-jobs.ts:178-182`) becomes a real query instead of a heuristic. | 4 files → 1 new + 4 thin shims |
| `lib/projects.ts:182`, `lib/queues-evidence.ts:38`, `lib/local-folders.ts:103` | **Correctness bug to avoid:** these caches key on project key alone. Two tenants with a project keyed `website` would read each other's cached data. Change every cache key to `${tenantId}:${projectKey}`. | One-line fixes, easy to miss |
| `lib/loop-template.ts` | Keep the shipped default in this repo (`config/loop-template/`) as the `tenant_id IS NULL` rows. Per-tenant overrides read from `loop_templates`. `seedTemplateFromPilot` and the `PILOT_REPO` constant are deleted — there is no pilot in a product. | ~120 lines |
| `lib/onboard.ts` | Wrap the multi-step install in a transaction; register the project in Postgres instead of committing `config/projects.json`. | ~80 lines |
| The **22 routes that don't call `resolveProject`** | Each needs explicit tenant scoping: `assistant`, `reporter` (+`refresh`, `summarize`, `cron`), `logout`, `login`, `tools/fit` (+`repos`, `[id]`), `tools/catalog/refresh`, `projects/local-scan`, `projects/local-init`, `map/projects`, `map/projects/repos`, `map/projects/add`, `map/template`, `map/template/seed`, `map/process-chat`, `map/ai-job/[id]`, `map/ai-job/latest`, `launch/analyze/[id]`. Several of these (`local-*`, `launch/*`) are being disabled in Phase 0 anyway, which shrinks the list. | The bulk of the route work |
| `app/api/map/projects/checklist/route.ts` | Rewrite against the GitHub App: `app` status becomes real, `secret` check becomes an actual set-the-secret action. | ~60 lines |
| UI (`components/`) | Add a tenant/org switcher next to the existing project switcher (`components/map/project-switcher.tsx` is the model to copy), a members/invites screen, and a login redirect to Cognito Managed Login. Everything else is untouched. | New screens only |

### 3.5 AWS resources created

- **Aurora Serverless v2 PostgreSQL** cluster in the private subnets (min 0.5 ACU), credentials in Secrets Manager with rotation, RDS Proxy in front (Fargate tasks + a scale-out event = connection storms otherwise).
- **Cognito user pool** (Essentials) + app client + Managed Login domain + hosted UI branding.
- **Secrets Manager**: GitHub App private key, `SESSION_SECRET`, DB credentials.
- **IAM** additions to the ECS task role: `secretsmanager:GetSecretValue` (scoped to those ARNs), RDS connect.
- Database migrations run as a **one-off ECS task** in the deploy pipeline, not on app boot.

### 3.6 Not in scope, but required to actually sell it

Billing and metering (Stripe or AWS Marketplace), per-tenant usage limits, an admin/support console, a data-deletion path, and a status page. Flagging so nobody discovers them in week nine.

### 3.7 Effort

**6–10 weeks** for one engineer; ~5–7 with two, split as (a) auth + tenant plumbing, (b) database + job stores + GitHub App. The variance is almost entirely in the 22 unscoped routes and in the UI for members/invites.

---

## 4. Stream 3 — Bedrock AI backend

### 4.1 The dashboard's own AI calls (Phase 3)

#### Why (plain English)

The dashboard itself asks Claude to draft things — new agent instructions, idea rewrites, the reporter summary. Today that either uses the Claude app on the owner's Mac (impossible in the cloud) or an Anthropic API key. Switching to Bedrock means those calls go through AWS with an AWS identity, no API key to store, and a bill that lands on the AWS invoice. It is a change to **one file**.

#### What changes

`lib/map-ai.ts` is the only file that talks to a model; 13 files call into it and **none of them change**.

1. `npm i @anthropic-ai/bedrock-sdk`.
2. Add `"bedrock"` to the `AiBackend` union (`lib/map-ai.ts:52`) and to `aiBackend()`'s selection (`:84-93`). Suggested precedence for `auto`: `cli` (local dev) → `bedrock` (if `DASHBOARD_AI_BACKEND=bedrock` or an AWS region is configured) → `api` → `disabled`.
3. Add `bedrockStructuredCall<T>()` alongside `apiStructuredCall` (`:411-483`). **Use the SDK, not a hand-rolled `fetch`.** The existing `api` path builds the request body by hand; on Bedrock that's where people get bitten by the `anthropic_version: "bedrock-2023-05-31"` body field (required on raw `bedrock-runtime` `InvokeModel` bodies for Anthropic models) and by SigV4 signing. **The SDK sets `anthropic_version` and signs for you** — writing it by hand re-imports a bug class you don't need.
4. **Forced tool use works unchanged.** The structured-output mechanism this app relies on — `tools: [...]` plus `tool_choice: {type: "tool", name}` — is supported on Bedrock (tool use and strict/structured tool output are both GA there). The parsing code at `:462-483` (find the `tool_use` block, return `.input`) ports 1:1. Do **not** switch to `output_config.format` on the way — that parameter is rejected on the Bedrock Messages path.
5. **Revive the help assistant.** `aiChatCall()` (`:349-405`) is CLI-only and therefore dead in any cloud deploy — `ASSISTANT_CLI_UNAVAILABLE_MESSAGE` is shipped to users today. Add a Bedrock path for it (same client, plain text, no tools). This is a small change that fixes a visibly broken feature.
6. **Model IDs.** `aiModel()` (`:100-102`) defaults to `"claude-sonnet-5"`, a first-party ID that is not a Bedrock ID. Add `DASHBOARD_AI_BEDROCK_MODEL` (or translate) so the two backends can't be misconfigured into each other's ID space.

#### Which Bedrock client

There are two, and picking the wrong one costs a day:

| Client | Path | Model ID shape | Use |
|---|---|---|---|
| `AnthropicBedrockMantle` (`new AnthropicBedrockMantle({ awsRegion })`) | Bedrock's **Messages-API** endpoint | `anthropic.claude-sonnet-5` (no version suffix) | **Preferred for new code.** |
| `AnthropicBedrock` | Legacy `bedrock-runtime` **InvokeModel** | `us.anthropic.claude-sonnet-4-6` (cross-region inference profile) | The path `claude-code-action` uses; use it if you want dashboard and workflows on identical model IDs. |

Region and model availability differ between the two — pick one, pin it, and put it in `.env.example`.

#### Bedrock model access (do this before writing code)

1. Bedrock console → **Model catalog** → select an Anthropic model → **submit the use case form**. Access is granted immediately on submission. Once per AWS account.
2. Under AWS Organizations you can submit once from the management account via the `PutUseCaseForModelAccess` API (needs `bedrock:PutUseCaseForModelAccess`); approval extends to child accounts.
3. **Cross-region inference profiles need access granted in *every region of their region group*.** A `us.`-prefixed profile that works in `us-east-1` and 403s in `us-west-2` is this, not a bug. Prefixes: `us.` / `eu.` / `apac.` / `global.` / `us-gov.`.

#### IAM for the ECS task role

Exactly the policy Anthropic documents for Claude Code on Bedrock — use it verbatim:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowModelAndInferenceProfileAccess",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:ListInferenceProfiles",
        "bedrock:GetInferenceProfile"
      ],
      "Resource": [
        "arn:aws:bedrock:*:*:inference-profile/*",
        "arn:aws:bedrock:*:*:application-inference-profile/*",
        "arn:aws:bedrock:*:*:foundation-model/*"
      ]
    },
    {
      "Sid": "AllowMarketplaceSubscription",
      "Effect": "Allow",
      "Action": ["aws-marketplace:ViewSubscriptions", "aws-marketplace:Subscribe"],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:CalledViaLast": "bedrock.amazonaws.com" } }
    }
  ]
}
```

Tighten `Resource` to specific inference-profile ARNs once you know which models you use. `GetInferenceProfile` is not optional-in-practice: without it the SDK retries with an alternate request shape, costing a round-trip per new model.

**Auth:** on ECS, the task role. No keys, no `AWS_ACCESS_KEY_ID`, nothing in Secrets Manager. Locally, `AWS_PROFILE`. (`AWS_BEARER_TOKEN_BEDROCK` API keys exist and are simpler for scripts; don't use them for the service.)

#### Effort

**3–5 days**, including the model-access dance and a side-by-side quality check of a few `Draft with AI` outputs against the current backend.

### 4.2 The loop templates — Bedrock in the *customer's* AWS account (Phase 1)

#### Why (plain English)

This is the compliance pitch, and it is real: the AI agents that read the customer's code can run entirely on **their** AWS account, on **their** Bedrock, billed to **them**, logged in **their** CloudTrail, with **their** guardrails — while our dashboard just watches. Nothing about it depends on the rest of this plan. It can be piloted on one repo this week.

#### Verified current, 2026-08-31

`anthropics/claude-code-action@v1` supports `use_bedrock: "true"` with GitHub OIDC. Anthropic's cloud-providers documentation still describes exactly the flow the brief assumed, including the four `bedrock:*` IAM actions. Confirmed against the live docs.

#### The customer-side setup (this becomes a docs page and an onboarding checklist item)

**Step 1 — OIDC provider.** In the customer's AWS account, add a GitHub OIDC identity provider: URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.

**Step 2 — IAM role.** Create a role trusted by that provider as a web identity, with the §4.1 policy attached (same four `bedrock:*` actions plus the two `aws-marketplace` ones), and a trust policy scoped to their repo:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:*" }
    }
  }]
}
```

Scope `sub` as tightly as the customer's risk appetite allows — `repo:org/repo:ref:refs/heads/main` is tighter than `repo:org/repo:*`.

**Step 3 — repo secrets.** `AWS_ROLE_TO_ASSUME` = that role's ARN. Plus, if they use a custom GitHub App for the workflow identity, `APP_ID` and `APP_PRIVATE_KEY`.

**Step 4 — model access.** Same Bedrock console use-case form as §4.1, in the customer's account, for every region in their inference-profile group.

#### The template changes

Eight workflows in `config/loop-template/workflows/` use `anthropics/claude-code-action@v1`: `claude-scout.yml`, `claude-builder.yml`, `claude-audit.yml`, `claude-demo.yml`, `claude-retro.yml`, `claude-redraft.yml`, `claude-mention.yml`, `claude-tool-install.yml`. Each needs the same four edits:

```yaml
permissions:
  id-token: write            # already present on every workflow — verify, don't assume

steps:
  # NEW — only if using a customer-owned custom GitHub App
  - name: Generate GitHub App token
    id: app-token
    uses: actions/create-github-app-token@v2
    with:
      app-id: ${{ secrets.APP_ID }}
      private-key: ${{ secrets.APP_PRIVATE_KEY }}

  # NEW
  - name: Configure AWS Credentials (OIDC)
    uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
      aws-region: us-west-2

  - uses: anthropics/claude-code-action@v1
    with:
      github_token: ${{ steps.app-token.outputs.token }}   # omit if using the official Claude App
      use_bedrock: "true"                                   # REPLACES claude_code_oauth_token
      claude_args: |
        --model us.anthropic.claude-sonnet-4-6
        --max-turns 50
        --allowedTools "..."
```

The `configure-aws-credentials` step exports `AWS_REGION` for the rest of the job. Keep `--max-turns` — it is the cost ceiling.

**Make this a per-project switch, not a fork.** Add `"aiProvider": "subscription" | "bedrock"` to `.github/loop-config.json` (`lib/loop-config.ts`, `LOOP_CONFIG_PATH = ".github/loop-config.json"`) and have the template renderer emit the Bedrock steps only when it's `bedrock`. Maintaining two copies of eight 400-line workflows is how this template drifts.

Also update `app/api/map/projects/checklist/route.ts`, which today hard-codes a check for the `CLAUDE_CODE_OAUTH_TOKEN` secret (`:28`). Under Bedrock, the required secret is `AWS_ROLE_TO_ASSUME`. The checklist should branch on `aiProvider`.

#### Does the compliance claim hold end-to-end? Mostly — with two honest caveats

**It holds where it matters.** The workflow runs in the customer's repo → assumes a role in the customer's AWS account via short-lived OIDC credentials (no stored AWS keys) → calls Bedrock in that account and region. Inference, billing, CloudTrail, Bedrock model-invocation logging, and Bedrock Guardrails are all the customer's. Anthropic's own docs describe this as the point of the feature. Nothing about the model call touches our infrastructure.

**Caveat 1 — the runner.** The job executes on a **GitHub-hosted** runner. The customer's source code is checked out onto GitHub's infrastructure, not their own. For a buyer whose objection is "our code can't leave our network", the answer is **self-hosted runners in their VPC** (`runs-on: [self-hosted, ...]`), and the templates should support that as a config flag. For a buyer whose objection is "our code can't be sent to a model vendor", Bedrock alone answers it.

**Caveat 2 — the dashboard's own AI.** §4.1 puts *our* Bedrock calls in *our* AWS account. So "everything runs in your account" is true of the agents and false of the dashboard's drafting features. Either say so plainly, or (harder, later) let a tenant supply a cross-account role the dashboard assumes for its own Bedrock calls too. Decide which before it goes on a marketing page.

#### Effort

**3–5 days** for the template work and the `aiProvider` switch, plus **1–2 days** writing the customer setup guide, plus a real pilot run on one repo before it ships.

---

## 5. Risks & open decisions

Ordered by how much they can hurt.

### R1 — Bedrock removes the Scout's WebSearch. **This is the biggest risk in the plan.**

Anthropic's docs state plainly: **"The WebSearch tool is not available on Amazon Bedrock."** `claude-scout.yml:396` allows `WebSearch,WebFetch`, and the Scout's evidence floor at `:541-547` *requires* a dated external source whenever the motivation comes from outside the repo ("a platform change, a competitor's release, a new API"). On Bedrock, half the Scout's job loses its instrument. The Auditor and Retro are less affected; the Scout is directly hit.

`WebFetch` in Claude Code is a client-side tool (unlike the server-side web-search tool) and is **not** listed as unavailable on Bedrock — but that must be **verified in a pilot run**, not assumed.

Options, in order of preference: (a) run the Scout on the subscription/API and everything else on Bedrock — the per-project `aiProvider` flag from §4.2 can be per-*agent* with little extra work; (b) give the Scout a search MCP server in `.mcp.json` (it already has an MCP config file in the template); (c) relax the evidence floor for Bedrock tenants and accept thinner proposals. **Decide before promising a Bedrock-only loop.**

### R2 — Whose AWS account runs the dashboard's own AI? (§4.2 caveat 2)

Affects the marketing claim and, if you choose cross-account, a meaningful chunk of Phase 3. **Owner decision.**

### R3 — DynamoDB vs Postgres

**Decided: Postgres** (§3.1). What would flip it: if the job/state tables turn out to dominate write volume by orders of magnitude, or if you need IAM-enforced (not app-enforced) tenant isolation as a contractual requirement. Both are knowable in Phase 4 week 2; neither is knowable now.

### R4 — Cognito vs WorkOS/Auth0

**Decided: Cognito Essentials** (§3.2). What would flip it: enterprise SAML onboarding becoming the sales blocker. The swap is contained (you're verifying a JWT in one place either way), so this is a reversible decision — do not spend a week debating it.

### R5 — PAT vs GitHub App

**Decided: GitHub App** (§3.3). The only argument for PATs is "it's faster to build", and it is — by about a week. It costs you rate-limit isolation, revocation, attribution, and the one-click install story, and it means holding customer credentials that can reach their source code. Not worth it.

### R6 — The Mac-only features have no cloud equivalent

`lib/launchers.ts` (launch the customer's product with `open`), `lib/local-folders.ts` (scan `~/Documents/Claude Projects`), and the six routes over them are genuinely local-machine features. Phase 0 disables them in the cloud. **Owner decision:** delete them, or keep them as a "desktop mode" the product still supports for solo users? Deleting is cheaper; keeping them means every future change carries two code paths.

### R7 — Bedrock quotas and cost

Bedrock on-demand throughput is quota'd per account per region. A loop running Scout hourly across many tenants can hit TPM limits. Mitigations: cross-region inference profiles (already the default), `ANTHROPIC_BEDROCK_SERVICE_TIER` (`flex` for the Scout, `priority` for interactive drafting), and provisioned throughput at scale. Also: with Bedrock, **model cost moves onto an AWS bill** — for the loop templates that's the customer's bill (good), for the dashboard's own calls it's yours (needs per-tenant metering before you price it).

### R8 — Next.js 16 has no verified AWS adapter yet

Next.js 16.2's stable Adapter API ships with only the Vercel and Bun adapters; AWS/Netlify/Cloudflare adapters (via OpenNext) are "in active development, expected later this year". This plan therefore commits to the **container path**, which Next documents as supporting *all* features and is not going away. Watch for the AWS adapter — it may later offer a cheaper serverless option — but do not wait for it.

### R9 — Cache keys collide across tenants

Called out in §3.4 because it is the kind of bug that ships silently: three module-level caches key on project key alone. Two tenants with a project named `website` would read each other's data. One-line fixes; put them on the Phase 4 checklist explicitly.

### R10 — Model ID drift between the two Bedrock paths

The dashboard (Mantle, `anthropic.claude-sonnet-5`) and the workflows (InvokeModel, `us.anthropic.claude-sonnet-4-6`) use different ID formats. Pin both, document both in `.env.example`, and don't let a "helpful" copy-paste move an ID from one to the other.

---

## 6. Fold-in fixes (Phase 0 — do these first, regardless)

These are pre-existing and independent of the AWS work. Two of them get materially worse the moment there is more than one customer.

### 6.1 `/api/launch/*` and `/api/projects/local-*` spawn local processes behind only a session cookie

**What's wrong.** `app/api/launch/run/route.ts` → `launchProject()` → `execFile`. `app/api/launch/analyze/route.ts` → `analyzeAndCreateLauncher()` → the local `claude` CLI with a real working directory. `app/api/projects/local-init/route.ts` `execFile`s directly. `app/api/projects/local-scan/route.ts` reads the host filesystem. The only thing in front of all of it is `proxy.ts` checking a cookie signed with the shared password. Today that's a single-owner tool on a laptop. In a multi-tenant container it's process execution reachable by any authenticated user of *any* tenant.

**Fix.** Add `LOOP_DASHBOARD_LOCAL_MODE` (default **off**). When off, all six routes return 404 and the UI hides the entries. Gate at the route, not in the library, so nothing can reach `lib/launchers.ts` or `lib/local-folders.ts` by another path.

**Files:** `app/api/launch/run/route.ts`, `app/api/launch/analyze/route.ts`, `app/api/launch/analyze/[id]/route.ts`, `app/api/launch/status/route.ts`, `app/api/projects/local-scan/route.ts`, `app/api/projects/local-init/route.ts`, plus the components that link to them (`components/map/launch-button.tsx`, the add-project flow). **Effort: 1 day.**

### 6.2 The cron endpoint is open when `CRON_SECRET` is unset

**What's wrong.** `app/api/reporter/cron/route.ts:22-30` — `if (secret) { ...check... }`. No secret, no check. Anyone who knows the URL can trigger a full reporter refresh (which fans out to GitHub and, with the API backend, to a paid model). It is deliberately open "so local dev works without configuring anything", but the endpoint is also **excluded from nothing** — `proxy.ts`'s matcher covers it, so today the session cookie is the only gate, and the cron caller doesn't have one.

**Fix.** Fail closed. Require the secret whenever `NODE_ENV === "production"` (or a `LOOP_DASHBOARD_LOCAL_MODE` flag is off); return 500 with a clear message if it's missing rather than silently opening. Keep the `Bearer` header check, drop the `?token=` query-param fallback (`:26`) — secrets in query strings end up in ALB and CloudFront access logs. Under EventBridge Scheduler the header form is what you'll use anyway. **Effort: 2 hours.**

### 6.3 (Recommended addition) The password *is* the signing key

**What's wrong.** `lib/auth.ts:16-24, 42-56` — `DASHBOARD_PASSWORD` is used directly as the HMAC key. Three consequences: a leaked password is also a cookie-forgery key; there is no way to revoke a session without changing the password for everyone; and the key inherits whatever entropy a human chose. `verifyPassword` (`:59-67`) also short-circuits on length mismatch, leaking password length.

**Fix (now, cheap).** Introduce `SESSION_SECRET` (32 random bytes, Secrets Manager) as the HMAC key; keep `DASHBOARD_PASSWORD` for the login check only; add a `kid`/version field to the cookie payload so sessions can be invalidated by bumping it. **Fix (later, properly).** Phase 4 deletes this file. Doing 6.3 now means Phase 4 changes one thing (the identity source) instead of two. **Effort: half a day.**

---

## 7. Sources

- Claude Code GitHub Actions with cloud providers — https://code.claude.com/docs/en/github-actions-cloud-providers
- Claude Code on Amazon Bedrock (IAM policy, model access, inference-profile prefixes, WebSearch limitation) — https://code.claude.com/docs/en/amazon-bedrock
- Next.js Across Platforms: Adapters, OpenNext, and Our Commitments (Adapter API stable in 16.2; AWS adapter in development) — https://nextjs.org/blog/nextjs-across-platforms
- Next.js self-hosting & deploying guides (bundled in `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md` and `.../01-getting-started/17-deploying.md`) — Proxy defaults to the Node.js runtime in v16; Docker/`next start` support all features
- AWS Amplify Hosting SSR supported features (Next.js up to 15) — https://docs.aws.amazon.com/amplify/latest/userguide/ssr-supported-features.html
- AWS App Runner product page — "will no longer accept new customers starting on April 30, 2026"; recommends Amazon ECS Express Mode — https://aws.amazon.com/apprunner/
- Amazon ECS Express Mode overview — https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html
- Amazon Cognito pricing & feature tiers (Lite / Essentials / Plus, Managed Login) — https://aws.amazon.com/cognito/pricing/ and https://aws.amazon.com/about-aws/whats-new/2024/11/new-feature-tiers-essentials-plus-amazon-cognito
- GitHub REST API rate limits (15,000/hr per installation vs 5,000/hr per PAT) — https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- Best practices for creating a GitHub App — https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app
- AWS Guidance for Multi-Tenant Architectures (pool / bridge / silo) — https://docs.aws.amazon.com/solutions/multi-tenant-architectures-on-aws/
- `@anthropic-ai/bedrock-sdk` — https://www.npmjs.com/package/@anthropic-ai/bedrock-sdk
