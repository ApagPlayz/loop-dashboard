#!/usr/bin/env bash
#
# Deploy the duplicate-detection inference endpoint to AWS Lambda.
#
# Idempotent: safe to re-run. Creates on first run, updates thereafter.
#
#   ./infra/deploy-dedup-inference.sh
#
# What it builds
#   - IAM role  loop-dashboard-dedup-infer-role  with ONE inline least-privilege
#     policy: InvokeModel on the single Titan embeddings model, GetObject on the
#     two S3 prefixes this reads, and writes to this function's own log group.
#     Deliberately NOT the AWSLambdaBasicExecutionRole managed policy, which
#     grants logs:* on "*".
#   - Lambda   loop-dashboard-dedup-infer  (nodejs22.x, arm64, 512 MB)
#   - A Function URL with AWS_IAM auth (callers must sign with SigV4; this is
#     not an open endpoint, and no lambda:InvokeFunctionUrl permission is
#     granted to "*").
#
# The deployment package is infra/lambda-dedup-infer/index.mjs and nothing else
# — the handler signs its own AWS requests, so there are no node_modules to
# ship. See the header of that file for why.
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

FUNCTION_NAME="loop-dashboard-dedup-infer"
ROLE_NAME="loop-dashboard-dedup-infer-role"
POLICY_NAME="loop-dashboard-dedup-infer-least-privilege"

BUCKET="loop-dashboard-ml-${ACCOUNT_ID}"
MODEL_ID="amazon.titan-embed-text-v2:0"

# 512 MB, not the 128 MB default. The resident data is small — the Titan index
# is 132 x 1024 float32 = 541 KB plus a ~1.2 MB JSON string held transiently
# during parse — so this is a CPU choice, not a memory one: Lambda scales vCPU
# with memory, and at 512 MB (~1/3 vCPU) the cold-start JSON.parse and the
# 135k-multiply-accumulate scoring pass finish in a fraction of the time they
# take at 128 MB. Duration bills per ms, so the faster tier is close to
# cost-neutral and materially better on latency.
MEMORY_MB=512
TIMEOUT_S=15

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lambda-dedup-infer"
BUILD_ZIP="$(mktemp -d)/dedup-infer.zip"

echo "==> Packaging $SRC_DIR"
(cd "$SRC_DIR" && zip -q -r "$BUILD_ZIP" index.mjs)

# ------------------------------------------------------------------ #
# IAM role                                                            #
# ------------------------------------------------------------------ #

TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}'

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "==> IAM role $ROLE_NAME already exists"
else
  echo "==> Creating IAM role $ROLE_NAME"
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Least-privilege execution role for the dedup inference Lambda" \
    >/dev/null
  echo "    waiting for role propagation..."
  sleep 10
fi

ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)"

echo "==> Putting least-privilege inline policy $POLICY_NAME"
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeTitanEmbeddingsOnly",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:${REGION}::foundation-model/${MODEL_ID}"
    },
    {
      "Sid": "ReadIndexArtifactsOnly",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::${BUCKET}/embeddings/titan/*",
        "arn:aws:s3:::${BUCKET}/corpus/*"
      ]
    },
    {
      "Sid": "OwnLogGroupOnly",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/lambda/${FUNCTION_NAME}:*"
    }
  ]
}
JSON
)"

# ------------------------------------------------------------------ #
# Lambda function                                                     #
# ------------------------------------------------------------------ #

ENV_VARS="Variables={INDEX_BUCKET=${BUCKET},INDEX_KEY=embeddings/titan/latest.json,CORPUS_KEY=corpus/corpus.jsonl,EMBEDDING_BEDROCK_MODEL=${MODEL_ID},EMBEDDING_BEDROCK_DIMENSIONS=1024,DEDUP_THRESHOLD=0.842}"

if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Updating existing function $FUNCTION_NAME"
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$BUILD_ZIP" \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --memory-size "$MEMORY_MB" \
    --timeout "$TIMEOUT_S" \
    --environment "$ENV_VARS" \
    --region "$REGION" >/dev/null
else
  echo "==> Creating function $FUNCTION_NAME"
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs22.x \
    --architectures arm64 \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file "fileb://$BUILD_ZIP" \
    --memory-size "$MEMORY_MB" \
    --timeout "$TIMEOUT_S" \
    --environment "$ENV_VARS" \
    --description "Near-duplicate backlog detection: Titan v2 embeddings + cosine over the precomputed index" \
    --region "$REGION" >/dev/null
fi

aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"

# Keep logs cheap and bounded — without this the group retains forever.
aws logs put-retention-policy \
  --log-group-name "/aws/lambda/${FUNCTION_NAME}" \
  --retention-in-days 14 \
  --region "$REGION" 2>/dev/null || true

# ------------------------------------------------------------------ #
# Function URL (AWS_IAM auth — signed callers only)                   #
# ------------------------------------------------------------------ #

if aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  FUNCTION_URL="$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" --query FunctionUrl --output text)"
else
  echo "==> Creating Function URL (AWS_IAM auth)"
  FUNCTION_URL="$(aws lambda create-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --auth-type AWS_IAM \
    --region "$REGION" \
    --query FunctionUrl --output text)"
fi

echo
echo "Function : $FUNCTION_NAME"
echo "Role     : $ROLE_ARN"
echo "URL      : $FUNCTION_URL  (AWS_IAM — sign requests with SigV4, service 'lambda')"
echo
echo "Try it:"
echo "  aws lambda invoke --function-name $FUNCTION_NAME --region $REGION \\"
echo "    --cli-binary-format raw-in-base64-out \\"
echo "    --payload '{\"title\":\"...\",\"body\":\"...\"}' /dev/stdout"
