# syntax=docker/dockerfile:1
#
# Multi-stage build for ECS Fargate. See
# docs/plans/aws-bedrock-multitenant-plan-2026-08-31.md §2.2 for the plan
# this implements.
#
# deps -> builder -> runner, on node:22-alpine (current Node LTS). The
# runner stage only copies the pruned `.next/standalone` output (see
# `output: "standalone"` in next.config.ts), `.next/static`, and `public` —
# it never contains the full dev node_modules tree or the source tree.

# ---- deps: install dependencies with a cached, reproducible install ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: build the Next.js app ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No secrets are needed at build time: this app reads all runtime config
# (DASHBOARD_PASSWORD, GITHUB_TOKEN, CRON_SECRET, SESSION_SECRET, etc.) from
# process.env at request time, not at build time.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: minimal runtime image ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user, per Next.js's own Dockerfile guidance for standalone output.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# `.next/standalone` contains a pruned node_modules + server.js entrypoint;
# `.next/static` and `public` are not included in standalone and must be
# copied in separately.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
