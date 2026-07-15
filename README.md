# Loop Dashboard

A private web dashboard to watch and control the autonomous content-generation
loop (the Scout / Builder / Auditor / Retro / Metrics workflows running on
`ApagPlayz/content-generation-platform`). Built to be used from a laptop **and**
a phone.

Sections: **Process Map**, **Ideas**, **Builds & Evidence**, **Testing**,
**Tools**, **Metrics**.

---

## What you need (two secrets)

1. **A dashboard password** — anything long and random. You type it once on the
   login screen; it stays remembered for 30 days.
2. **A GitHub token** — a fine-grained Personal Access Token (PAT) that can read
   and write to the `content-generation-platform` repo.

### Creating the GitHub token

1. Go to <https://github.com/settings/tokens?type=beta> (Fine-grained tokens).
2. **Resource owner:** `ApagPlayz`. **Repository access:** *Only select
   repositories* → `content-generation-platform`.
3. **Permissions** (Repository permissions), set each to **Read and write**:
   Contents, Issues, Pull requests, Actions.
4. Generate it and copy the `github_pat_...` value somewhere safe — GitHub only
   shows it once.

### Optional: an Anthropic API key (AI drafting)

The Process Map has "Draft with AI" boxes — describe a change in plain English
("make Scout run twice a week") and Claude drafts it for you to review before
anything is saved. To turn that on, add a third secret:

- `ANTHROPIC_API_KEY` — create one at <https://console.anthropic.com/>.
- `DASHBOARD_AI_MODEL` — optional; which Claude model to use (leave unset for
  the default).

Without the key, the dashboard still works fully — the AI boxes just show a
note, and History / manual editing keep working.

---

## Run it on your own computer

```bash
npm install
cp .env.example .env.local     # then edit .env.local and paste your two secrets
npm run dev
```

Open <http://localhost:3000>, enter your dashboard password, and you're in.

---

## Put it online with Vercel (so your phone can reach it)

1. Push this repo to GitHub (already done: `ApagPlayz/loop-dashboard`).
2. Go to <https://vercel.com/new>, sign in with GitHub, and **Import** the
   `loop-dashboard` repository.
3. Before clicking Deploy, open **Environment Variables** and add the same two
   values from your `.env.local`:
   - `DASHBOARD_PASSWORD` → your chosen password
   - `GITHUB_TOKEN` → your `github_pat_...` token
   - `ANTHROPIC_API_KEY` → optional, turns on AI drafting (see above)
4. Click **Deploy**. After ~1 minute you get a URL like
   `https://loop-dashboard.vercel.app`.
5. Open that URL on your phone, log in once, and add it to your home screen.

To change a secret later: Vercel → your project → **Settings → Environment
Variables**, edit it, then **Redeploy**. (Changing `DASHBOARD_PASSWORD` also logs
everyone out, which is expected.)

---

## For developers / agents extending this

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · npm.
Deployed on Vercel. In Next.js 16 the request-interceptor file is `proxy.ts`
(formerly `middleware.ts`).

**Structure**

```
app/
  layout.tsx            root <html>/<body>, dark theme
  page.tsx              redirects / → /metrics
  globals.css           theme tokens + .prose-dashboard markdown styles
  login/page.tsx        password screen (public)
  api/login/route.ts    POST { password } → sets signed cookie
  api/logout/route.ts   POST → clears cookie
  (app)/                authenticated route group (wrapped in <AppShell>)
    layout.tsx
    map|ideas|builds|testing|tools|metrics/page.tsx
components/             app-shell, page-header, stat-card, under-construction
lib/
  auth.ts               HMAC cookie sign/verify (Web Crypto)
  github.ts             Octokit client + REPOS + typed helpers
  nav.ts                NAV_ITEMS (single source of truth for nav)
proxy.ts                auth gate (protects everything except /login)
```

**Auth.** Every route is protected by `proxy.ts` except `/login` and
`/api/login`. Login posts the password to `/api/login`, which sets an httpOnly
cookie named `loop_dash_session` — value is `payload.hmacSHA256(payload)` keyed
by `DASHBOARD_PASSWORD`, 30-day expiry. Server code can call helpers in
`lib/github.ts` directly (the proxy has already authenticated the request).

**Styling conventions (dark-only).** Reuse these — don't introduce new palettes:

| Purpose      | Classes                                             |
| ------------ | --------------------------------------------------- |
| Page bg      | `bg-zinc-950`                                        |
| Card / panel | `bg-zinc-900 border border-zinc-800 rounded-xl`      |
| Hover        | `bg-zinc-800`                                        |
| Text         | `text-zinc-100` (primary) / `text-zinc-400` (muted)  |
| Accent       | `emerald-500` / `emerald-400` (active, buttons, focus) |

Start each page with `<PageHeader title description />`, keep content in the
shell's `max-w-5xl` container, and use `<StatCard>` for metrics.

**Adding a section:** add an entry to `NAV_ITEMS` in `lib/nav.ts` and create
`app/(app)/<slug>/page.tsx`.

**GitHub helpers** live in `lib/github.ts` — `listIssues`, `listPRs`,
`getWorkflowRuns`, `dispatchWorkflow`, `repositoryDispatch`, `getFileContent`,
`commitFile`, `addLabel`, `removeLabel`, `createComment`, `mergePR`,
`listRunArtifacts`, `downloadArtifact`. All take an optional `repo` (defaults to
`REPOS.primary`); add more repos to the `REPOS` object.
