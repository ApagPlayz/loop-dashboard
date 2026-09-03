#!/usr/bin/env bash
#
# Point the CloudFront distribution at whatever public DNS name the current
# ECS task has.
#
# Why this script has to exist: the service runs a single Fargate task with
# assignPublicIp=ENABLED and no load balancer, which is what keeps the bill
# near $9/month instead of ~$26 (an ALB alone is ~$16.50/month). The trade-off
# is that the task's public IP — and therefore its ec2-*.compute-1.amazonaws.com
# DNS name — changes every time the task is replaced. CloudFront gives the
# deployment one permanent HTTPS URL; this script re-attaches it to the new
# origin after a redeploy or an unplanned task restart.
#
# Run it whenever https://d1ougmzejkasx3.cloudfront.net starts returning 502.
#
set -euo pipefail

REGION=us-east-1
CLUSTER=loop-dashboard
SERVICE=loop-dashboard
DIST_ID=E1B8EXHI4E3CYX
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TASK_ARN="$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICE" \
  --desired-status RUNNING --region "$REGION" --query 'taskArns[0]' --output text)"
if [ "$TASK_ARN" = "None" ] || [ -z "$TASK_ARN" ]; then
  echo "No RUNNING task in ${CLUSTER}/${SERVICE}. Nothing to point at." >&2
  exit 1
fi

ENI="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$REGION" \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" --output text)"
ORIGIN_DNS="$(aws ec2 describe-network-interfaces --network-interface-ids "$ENI" --region "$REGION" \
  --query 'NetworkInterfaces[0].Association.PublicDnsName' --output text)"

echo "==> Current task origin: ${ORIGIN_DNS}"

aws cloudfront get-distribution-config --id "$DIST_ID" > "$TMP/full.json"
ETAG="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ETag"])' "$TMP/full.json")"
CURRENT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["DistributionConfig"]["Origins"]["Items"][0]["DomainName"])' "$TMP/full.json")"

if [ "$CURRENT" = "$ORIGIN_DNS" ]; then
  echo "==> CloudFront already points at this task. Invalidating cache only."
else
  python3 - "$TMP/full.json" "$ORIGIN_DNS" "$TMP/config.json" <<'PY'
import json, sys
full = json.load(open(sys.argv[1]))
cfg = full["DistributionConfig"]
cfg["Origins"]["Items"][0]["DomainName"] = sys.argv[2]
json.dump(cfg, open(sys.argv[3], "w"))
PY
  aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
    --distribution-config "file://$TMP/config.json" \
    --query 'Distribution.Status' --output text
fi

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' \
  --query 'Invalidation.Status' --output text

echo "==> https://d1ougmzejkasx3.cloudfront.net"
