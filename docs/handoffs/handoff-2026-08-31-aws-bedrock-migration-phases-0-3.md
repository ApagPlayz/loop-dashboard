# Handoff — AWS/Bedrock migration phases 0–3 shipped; Phase 4 and an AWS account pending (2026-08-31)

## TL;DR
- Pivoted this session from "is the loop working?" to "can this be sold?" — three research passes done, then **phases 0–3 of the AWS migration implemented, verified and pushed** (`b703ffb`). Tree clean, `main` == `origin/main`.
- **Nothing is deployed to AWS. There is no AWS account.** Everything is written and locally verified; not one live AWS call has ever been made.
- **Single next action:** owner creates an AWS account + `aws login`, then Phase 4 (multi-tenancy) starts. Until then Phase 4 is mostly unverifiable.
- **Blocked on owner:** rotate the GitHub PAT (leaked into a local agent log this session), set `CRON_SECRET` in Vercel *before the next 6-hourly cron tick*, and the still-unanswered CGP brief question below.
- **Still open from 2026-08-19 and now 5 weeks stale:** CGP's loop is running against a completely **empty** `docs/loop-brief.md`. Not stale — empty.

## Goal
Two arcs are live at once. **Arc A (older):** make the autonomous loop trustworthy alongside a hands-on owner. **Arc B (new, this session):** find out whether Loop Dashboard is sellable, and if so build toward it — multi-tenant on AWS, with Bedrock so a customer's AI inference stays in their own AWS account. Owner is non-technical; plain language, and the micro-recap block from the global CLAUDE.md.

## State
`main` clean and pushed at `b703ffb`. Two commits this session: `d22efa4` (the plan) and `b703ffb` (phases 0–3, 31 files).

Non-obvious dispositions:
- **`vercel.json` was deliberately restored after Phase 2 deleted it.** The plan says delete it; that would stop the 6-hourly reporter cron with nothing to replace it while Vercel is still the only deployment. **Delete only at AWS cutover**, when the EventBridge Scheduler rule exists (`0 */6 * * *` → `/api/reporter/cron`, Bearer `CRON_SECRET`).
- **`.env.local` was edited by an agent** (gitignored, correctly). It gained `LOOP_DASHBOARD_LOCAL_MODE=1` and a generated `SESSION_SECRET`, so the Mac launcher features keep working. Owner is signed out of the dashboard once and must re-login.
- Three **pre-existing** lint errors remain (`components/help-chat.tsx:55`, `components/tools/catalog-browser.tsx:231`, `components/map/power-menu.tsx:221`). They predate this session and do not block the build. Untouched on purpose.
- **Phase 4 (multi-tenancy) deliberately not started.** It rewrites the same auth code Phase 0 just changed, and needs Cognito + a database to exist before most of it can be verified.

The three research deliverables are in this repo: `docs/plans/aws-bedrock-multitenant-plan-2026-08-31.md` (the plan being executed) and `docs/bedrock-setup.md` (customer-facing IAM/OIDC guide). Market findings were reported verbally only and are summarised under Key context.

## Verified vs assumed

**Verified this session:**
- `npx tsc --noEmit` exit 0; `npm run build` succeeds; all 10 template YAMLs parse via `yaml.safe_load`.
- **Container actually built and run**, not just written: 301 MB, `/api/health` → `200 {"ok":true}`, `/` → `307 → /login?next=%2F`, launcher route and cron endpoint both refuse. Image and container removed afterwards.
- Phase 0's gating was exercised behaviourally against the compiled modules (flag defaults off, tampered/expired cookies rejected, version bump revokes sessions, constant-time compare survives length mismatch).
- **WebSearch is genuinely unavailable on Bedrock** — verbatim in Anthropic's current docs, re-checked 2026-08-31. This is why Scout defaults to the subscription.
- CGP's loop is live and healthy: last 60 runs were 55 success / 0 failures; Scout and Builder both ran within the hour before this handoff.
- CGP's `docs/loop-brief.md` is the untouched template ("_Not filled in yet._"), last modified **2026-07-27**. Scout's own log: `no scout block in .github/loop-config.json — running on defaults`.

**Assumed / NOT verified — treat as unproven:**
- **No live Bedrock call has ever been made, by either path.** Model access grants, region availability, IAM sufficiency, response quality, and the `sts:AssumeRoleWithWebIdentity` handshake are all untested. There is no AWS account.
- **The new loop templates have never executed.** They are YAML-valid and the two branches were proven to carry byte-identical prompts, but no run has happened. **Do not roll them out to a live repo without a pilot.**
- The `.github/workflows/deploy.yml` pipeline has never run and cannot until six AWS values exist.
- Whether the CGP `@mention` security hole was ever *exploited* is still unchecked (offered 2026-08-19, never answered).
- The dashboard UI has still not been opened and looked at after the power-menu changes — carried over unresolved from the last two handoffs.
- The live Vercel deployment was never inspected; whether one is currently serving is unconfirmed.

## Dead ends & hard-won gotchas
- **The plan document is wrong about Bedrock model IDs and IAM, and the fix matters.** There are **two different Bedrock APIs** in play and conflating them produces access-denied errors naming an action you never called: the loop templates go through Claude Code's **InvokeModel** path (`bedrock:InvokeModel`, `InvokeModelWithResponseStream`, `ListInferenceProfiles`, `GetInferenceProfile`, model IDs like `us.anthropic.claude-sonnet-4-6`), while the dashboard's own `lib/map-ai.ts` defaults to the newer **Mantle** Messages API (**`bedrock-mantle:CreateInference`**, plain IDs like `anthropic.claude-sonnet-5`, no prefix). Documented in `docs/bedrock-setup.md`; the plan doc still carries the old claim.
- **Never combine `use_bedrock` with `claude_code_oauth_token`** — the static credential silently takes precedence and defeats Bedrock. That is why each template has two fully separate `claude-code-action` invocations gated by `if:`, not one step with conditional inputs.
- Template prompts are large (Scout's is 11 KB). Duplicating them across both branches was avoided using **YAML anchors/aliases**, which GitHub Actions has supported since Sept 2025.
- **AWS Amplify caps at Next.js 15** (repo is on 16.2.10) and **App Runner stops accepting new customers 30 Apr 2026**. Both already ruled out — don't re-evaluate them. Target is ECS Fargate.
- Gating `localCheckoutForRepo` had to happen **inside** the function (returning `null`), not at the route: the three chat routes must keep working, just without host-filesystem access. `lib/local-mode.ts`'s own doc comment says "gate at the route, never in the libraries" — that rule has this one deliberate exception.
- **macOS `sed` is not GNU `sed`.** An agent's redaction one-liner used GNU syntax, silently failed to redact, and printed `.env.local` unmasked into its transcript — which is why the GitHub PAT needs rotating.

## Running & resumable
- **Port 3000: node PID 1112 — the Content Engine, a different project. Leave it alone.** Nothing of ours is listening on 3100/3200.
- No dashboard dev server running. Start with `PORT=3100 npm run dev`.
- No agents, background jobs, workflow runs, or crons created by this session. No leftover Docker containers or images from this work (`kokoro` and the exited `music-web-*`/`logisiticsproject-redis-1` containers are unrelated).
- **CGP's loop is live and cycling** (Scout hourly, Builder every 30 min) on the OLD templates — this session's template changes are in this repo only and have not been rolled out.
- supply-chain-optimizer's 8 loop workflows remain `disabled_manually` **on purpose** — see memory `supply-chain-loop-intentionally-paused`. Do not resume or "fix".
- `aws` CLI v2.36.35 is installed; `aws sts get-caller-identity` returns `NoCredentials`.

## Next steps
1. **Owner creates an AWS account and runs `aws login`.** Everything below waits on this. Request **Bedrock model access** immediately after — it is an approval step on AWS's side, so start the clock early.
2. **Pilot Phase 1 on one repo before trusting it.** Set up the OIDC role per `docs/bedrock-setup.md`, point *one* non-critical workflow at `aiProvider: "bedrock"`, run it, confirm the call appears in that account's CloudTrail. Leave Scout on `subscription`.
3. **Stand the container up on ECS Express Mode** (plan §2.1) to de-risk it, then fill the six repo variables in `.github/workflows/deploy.yml` (`AWS_REGION`, `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN`, `ECR_REPOSITORY`, `ECS_CLUSTER`, `ECS_SERVICE`).
4. **Then Phase 4** — Cognito, Aurora Serverless v2 Postgres, GitHub App, tenant threading via `AsyncLocalStorage` (plan §3). Biggest piece by far.
5. **Independently of AWS: unblock CGP.** Get the owner's yes/no on the 5 goals in `docs/drafts/cgp-loop-brief-draft-2026-08-18.md`, land it as CGP's `docs/loop-brief.md`, add a `scout` block to its `.github/loop-config.json`. Then triage the 13 open PRs / 42 open issues — Scout will stand down every run until that queue moves (last merge 2026-07-28).

## Key context
- **Plan being executed:** `docs/plans/aws-bedrock-multitenant-plan-2026-08-31.md` (501 lines, phase-by-phase, with effort estimates). Its Bedrock IAM/model-ID details are superseded — see Dead ends.
- **Verify commands:** `npx tsc --noEmit`; `npm run build`; `docker build -t loop-dashboard:verify .` then run it on **port 3200** (3000 and 3100 are taken); YAML check via `python3 -c "import yaml;yaml.safe_load(open(f))"`.
- **Effort reality check:** the plan estimated weeks per phase; phases 0–3 landed in one session because they are almost entirely code. What cannot be compressed is non-code — AWS account setup, Bedrock model-access approval, domain/cert. Set expectations on that axis, not engineering hours.
- **Market finding (research only, nothing built):** pursue cautiously. An OSS competitor (`builderz-labs/mission-control`, ~6.1k stars) already covers the core pitch free, and **GitHub's own "Agent HQ"** plus its enterprise agent control plane (GA Feb 2026) target the same problem natively. Recommended test-of-demand is open-sourcing this, **not** building billing or multi-tenancy on spec. Note the tension: Phase 4 *is* building multi-tenancy on spec — worth a deliberate decision before starting it.
- **Salesforce:** SSO is cheap and real; an "autonomous loop for Salesforce orgs" is technically modest but commercially crowded (Copado Agentia, Gearset, Agentforce). AppExchange needs a paid security review (~$999/attempt, 4–9 weeks) and there is nothing to list today. Treat as design-partner-pilot-only.
- **Rollout is manual and still is.** Templates live in `config/loop-template/`; installing into a target repo is a Contents API PUT per file plus byte-verify. **Diff against the live workflow first** — that check is what previously saved supply-chain's customised mention workflow.
- Memory files that already auto-load (do not restate): `supply-chain-loop-intentionally-paused`, `deliberate-off-states-are-not-bugs`, `dashboard-commits-straight-to-main`.
- The supply-chain local checkout is the folder named **`Logisitics Project`** (typo and all).
- CGP is a **public** repo — anything shipped there is world-readable.

## Open questions
1. **Rotate the GitHub PAT now?** (It leaked into a local agent log this session.)
2. **Has `CRON_SECRET` been set in Vercel?** If the dashboard is deployed there, the cron now refuses to run without it — by design, but it needs the value.
3. **CGP brief: approve the 5 drafted goals, or change them?** (Blocking, 5 weeks open.)
4. **Given the market finding, still build Phase 4 multi-tenancy — or open-source first and wait for demand?**
5. Check whether the CGP `@mention` hole was ever exploited — yes/no?
