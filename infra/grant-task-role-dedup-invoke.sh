#!/usr/bin/env bash
#
# Let the running dashboard call the dedup inference Lambda.
#
#   ./infra/grant-task-role-dedup-invoke.sh
#
# Idempotent: `put-role-policy` overwrites the named inline policy.
#
# ------------------------------------------------------------------ #
# What this is for                                                    #
# ------------------------------------------------------------------ #
#
# `POST /api/ideas/custom/dedup` (the custom-idea composer's "Check for
# duplicates") signs a SigV4 request to the Lambda's Function URL, which is
# configured with `AWS_IAM` auth. Two things have to be true for that to work
# from ECS, and NEITHER is true by default:
#
#   1. The task must know the URL. It is deployment state, not source — add
#      DEDUP_INFER_FUNCTION_URL to infra/task-definition.json (this script
#      prints the value to use).
#   2. The task role must be allowed to invoke it. That is what this grants.
#
# Until both are done the feature degrades quietly: the composer says the
# check isn't configured and the owner files his idea exactly as before.
# Nothing about the Ideas screen's own duplicate badges depends on this —
# those score precomputed vectors in-process and call no remote service.
#
# ------------------------------------------------------------------ #
# Why this is a SEPARATE script                                       #
# ------------------------------------------------------------------ #
#
# `deploy-dedup-inference.sh` owns the Lambda and its OWN execution role.
# Modifying a different role — the one the web tier runs as — as a side effect
# of deploying a function would be a surprising thing for that script to do,
# and this is a one-time grant, not part of a deploy. `loopDashboardTaskRole`
# was created out of band and nothing in this repo otherwise manages it
# (docs/ARCHITECTURE.md §5.5), so it gets its own explicit, named step.
#
# ------------------------------------------------------------------ #
# Why the permission is this narrow                                   #
# ------------------------------------------------------------------ #
#
# ONE action on ONE function ARN. Note what is deliberately NOT granted:
#
#   - `lambda:InvokeFunction` — the SDK/CLI invoke path. Not needed; the app
#     only ever calls the Function URL.
#   - `bedrock:InvokeModel` and `s3:GetObject` — the whole point of routing
#     through the Lambda is that those stay on the Lambda's execution role,
#     scoped to one model and two key prefixes. Calling Bedrock directly from
#     the web tier would need both, on a task that also serves public traffic.
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

FUNCTION_NAME="loop-dashboard-dedup-infer"
TASK_ROLE_NAME="${TASK_ROLE_NAME:-loopDashboardTaskRole}"
POLICY_NAME="loop-dashboard-invoke-dedup-infer-url"

FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"

# Fail early and clearly rather than writing a policy for a function that is
# not there — a policy naming a nonexistent ARN is valid IAM and silently
# useless.
aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null

echo "==> Granting lambda:InvokeFunctionUrl on $FUNCTION_ARN to $TASK_ROLE_NAME"
aws iam put-role-policy \
  --role-name "$TASK_ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeDedupInferenceFunctionUrlOnly",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunctionUrl",
      "Resource": "${FUNCTION_ARN}",
      "Condition": {
        "StringEquals": { "lambda:FunctionUrlAuthType": "AWS_IAM" }
      }
    }
  ]
}
JSON
)"

FUNCTION_URL="$(aws lambda get-function-url-config \
  --function-name "$FUNCTION_NAME" --region "$REGION" \
  --query FunctionUrl --output text)"

echo
echo "Granted. Now add this to the container's environment in"
echo "infra/task-definition.json and redeploy:"
echo
echo "  { \"name\": \"DEDUP_INFER_FUNCTION_URL\", \"value\": \"${FUNCTION_URL}\" }"
echo
echo "It is a URL, not a secret — the endpoint is IAM-authed, so it belongs in"
echo "\`environment\`, not in SSM alongside the real secrets."
echo
echo "Verify from the task (or locally, with an active session):"
echo "  curl -X POST \"\$DEDUP_INFER_FUNCTION_URL\" --aws-sigv4 \"aws:amz:${REGION}:lambda\" \\"
echo "    --user \"\$AWS_ACCESS_KEY_ID:\$AWS_SECRET_ACCESS_KEY\" \\"
echo "    -H \"x-amz-security-token: \$AWS_SESSION_TOKEN\" \\"
echo "    -H 'content-type: application/json' \\"
echo "    -d '{\"title\":\"put affiliate links in every description\",\"body\":\"\"}'"
