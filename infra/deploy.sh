#!/usr/bin/env bash
#
# Build, push, and redeploy the Loop Dashboard container to AWS ECS Fargate.
#
# What this stack actually is (created 2026-09-02, us-east-1, account 777164055831):
#
#   ECR repo          loop-dashboard
#   ECS cluster       loop-dashboard              (Fargate, no EC2 capacity)
#   ECS service       loop-dashboard              (1 task, desiredCount pinned to 1)
#   Task definition   infra/task-definition.json  (256 CPU / 512 MiB, ARM64)
#   Security group    loop-dashboard-sg           (TCP 3000, CloudFront only)
#   Log group         /ecs/loop-dashboard         (14-day retention)
#   Secrets           SSM Parameter Store, SecureString, /loop-dashboard/*
#   Front door        CloudFront E1B8EXHI4E3CYX -> https://d1ougmzejkasx3.cloudfront.net
#
# Estimated cost, us-east-1, 730 hours: ~$7.20 Fargate (0.25 vCPU / 0.5 GiB on
# Graviton) + $3.65 for the public IPv4 address + well under $1 of ECR storage
# and CloudWatch Logs. CloudFront sits inside the perpetual free tier at this
# traffic level. Call it ~$11.50/month. An ALB instead of CloudFront would add
# ~$16.50/month on its own, which is why there isn't one.
#
# Deliberate choices, do not "fix" these without reading why:
#
#   * ARM64, not x86_64. Building linux/amd64 on Apple Silicon segfaults:
#     Next.js 16 + Turbopack dies under QEMU with "uncaught target signal 11".
#     Fargate Graviton is also ~20% cheaper. The x86_64 pin only applies to
#     ECS Express Mode, which this stack does not use.
#   * desiredCount stays at 1. Six module-level in-memory stores
#     (lib/reporter-store.ts, app/api/reporter/route.ts, lib/map-ai-jobs.ts,
#     lib/launcher-jobs.ts, lib/tool-fit-jobs.ts, lib/queues-evidence.ts)
#     assume a single process; background-job polling 404s with more than one
#     task. Never raise this without moving that state out of process memory.
#   * Container health check hits /api/health, not /. "/" 307-redirects to
#     /login, so a health check on "/" never goes healthy.
#   * LOOP_DASHBOARD_LOCAL_MODE is deliberately absent. Six launcher routes
#     gate on it and must stay 404 in the cloud.
#   * GITHUB_TOKEN is deliberately absent. The token in .env.local is the
#     GitHub CLI's account-wide OAuth token (gho_); it must not go to the
#     cloud. Add a scoped fine-grained PAT as an SSM SecureString and a
#     matching "secrets" entry in task-definition.json when one exists.
#   * The security group only admits the CloudFront origin-facing prefix list
#     (pl-3b927c52), so the task's public IP is not directly reachable and the
#     login password is only ever submitted over TLS to CloudFront. The
#     CloudFront-to-origin hop is still plain HTTP; closing that needs an ALB
#     plus an ACM certificate.
#   * The distribution's origin request policy MUST stay
#     Managed-AllViewerAndCloudFrontHeaders-2022-06 (33f36d7e-...). It is what
#     forwards "CloudFront-Forwarded-Proto" to the origin, which is the only
#     signal the app has that the viewer was on TLS — and therefore the only
#     thing that puts the Secure flag on the session cookie (see
#     viewerProtocol() in lib/auth.ts). Managed-AllViewer does not forward it,
#     and X-Forwarded-Proto cannot substitute: CloudFront strips it from viewer
#     requests, ignores it as a custom origin header, and 502s if a CloudFront
#     Function sets it. infra/cloudfront-distribution.json is a snapshot of the
#     working config.
#
set -euo pipefail

REGION=us-east-1
ACCOUNT=777164055831
REPO=loop-dashboard
CLUSTER=loop-dashboard
SERVICE=loop-dashboard
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TAG="$(git -C "$ROOT" rev-parse --short HEAD)"

echo "==> Building ${REPO}:${TAG} for linux/arm64"
docker build --platform linux/arm64 -t "${REPO}:${TAG}" "$ROOT"

echo "==> Pushing to ECR"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"
docker tag "${REPO}:${TAG}" "${REGISTRY}/${REPO}:${TAG}"
docker tag "${REPO}:${TAG}" "${REGISTRY}/${REPO}:latest"
docker push "${REGISTRY}/${REPO}:${TAG}"
docker push "${REGISTRY}/${REPO}:latest"

echo "==> Registering task definition"
TD_ARN="$(aws ecs register-task-definition \
  --cli-input-json "file://${ROOT}/infra/task-definition.json" \
  --region "$REGION" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"
echo "    ${TD_ARN}"

echo "==> Updating service"
aws ecs update-service \
  --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$TD_ARN" \
  --force-new-deployment \
  --region "$REGION" >/dev/null

echo "==> Waiting for the service to stabilise (this takes a few minutes)"
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION"

echo "==> Pointing CloudFront at the new task"
"${ROOT}/infra/refresh-cloudfront-origin.sh"
