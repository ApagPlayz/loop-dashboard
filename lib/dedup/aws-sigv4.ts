/**
 * Minimal AWS Signature Version 4 signer, plus credential resolution, for the
 * one thing the web tier needs to sign: a POST to the dedup inference Lambda's
 * Function URL (`AWS_IAM` auth).
 *
 * ## Why hand-rolled rather than @smithy/signature-v4
 *
 * The same reason `infra/lambda-dedup-infer/index.mjs` signs its own requests,
 * and this file is a deliberate TypeScript port of that signer so the two can
 * be read side by side. `@smithy/signature-v4` IS resolvable in node_modules,
 * but only transitively, and at TWO different major versions at once (3.1.2
 * hoisted from `@anthropic-ai/bedrock-sdk`, 5.7.3 nested under the AWS SDK
 * clients). `lib/dedup/embed.ts`'s header records what this project thinks of
 * importing a package it does not declare; picking a major version by
 * accident of hoisting order is worse than that. SigV4 is ~60 lines of HMAC
 * over a documented string format, it is pinned below against AWS's own
 * published test vector, and it adds nothing to the dependency surface.
 *
 * ## Why credentials come from an SDK client's config
 *
 * The AWS default credential chain (env vars, `~/.aws/credentials`, SSO, ECS
 * task role via `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, IMDS) lives in
 * `@aws-sdk/credential-provider-node` — which, again, this project does not
 * declare. It does declare `@aws-sdk/client-s3`, and every AWS SDK v3 client
 * resolves that exact chain into `client.config.credentials`. So the chain is
 * borrowed from the package we do depend on rather than reached for through
 * one we don't. `lib/dedup/artifact-store.ts` already constructs an S3Client
 * the same lazy, memoised way and for the same "no explicit credentials, let
 * the chain decide" reason.
 */

import { createHash, createHmac } from "node:crypto";

/* ------------------------------------------------------------------ */
/* Credentials                                                         */
/* ------------------------------------------------------------------ */

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

/**
 * Structural type for the slice of an SDK client we use. Typed by shape rather
 * than importing `S3Client`'s type at the top level, so nothing pays for the
 * AWS type graph unless this path is actually taken — the same treatment
 * `artifact-store.ts` and `embed.ts` give their clients.
 */
type CredentialBearingClient = {
  config: { credentials: () => Promise<AwsCredentials> };
};

let credentialClientPromise: Promise<CredentialBearingClient> | null = null;

async function getCredentialClient(): Promise<CredentialBearingClient> {
  if (!credentialClientPromise) {
    credentialClientPromise = (async () => {
      const { S3Client } = await import("@aws-sdk/client-s3");
      // Region is irrelevant to credential resolution but the client requires
      // one; us-east-1 matches everything else in this pipeline.
      return new S3Client({ region: "us-east-1" }) as unknown as CredentialBearingClient;
    })();
  }
  return credentialClientPromise;
}

/** Drop the memoised client. Only needed by tests that swap env vars. */
export function resetAwsCredentialCache(): void {
  credentialClientPromise = null;
}

/**
 * Resolve credentials from the default AWS provider chain.
 *
 * Throws when the chain has nothing to offer — an expired SSO session, no ECS
 * task role, no env vars. Callers are expected to treat that as "the check is
 * unavailable", never as an error worth showing the owner as a failure of
 * their own action.
 */
export async function resolveAwsCredentials(): Promise<AwsCredentials> {
  const client = await getCredentialClient();
  const creds = await client.config.credentials();
  if (!creds?.accessKeyId || !creds?.secretAccessKey) {
    throw new Error("The AWS credential chain returned no usable credentials.");
  }
  return creds;
}

/* ------------------------------------------------------------------ */
/* Signing                                                             */
/* ------------------------------------------------------------------ */

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * RFC 3986 encoding. `encodeURIComponent` leaves `!'()*` alone; SigV4 does not.
 * Identical to the Lambda handler's `uriEncode`.
 */
export function uriEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** `20150830T123600Z` and `20150830` from a Date. */
export function amzDates(date: Date): { amzDate: string; dateStamp: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export type SignRequestInput = {
  method: string;
  /** Host header value, e.g. `abc123.lambda-url.us-east-1.on.aws`. */
  host: string;
  /**
   * RAW (unencoded) path segments. `[]` signs the root path `/`, which is what
   * a Lambda Function URL uses.
   */
  pathSegments?: string[];
  /** Request body, already serialised. Empty string for a bodyless request. */
  body?: string;
  service: string;
  region: string;
  credentials: AwsCredentials;
  /** Signing time. Injected so tests can pin a vector. */
  date: Date;
  /**
   * Extra headers to include in the signature (lowercase keys). `content-type`
   * belongs here for a JSON POST.
   */
  extraHeaders?: Record<string, string>;
  /**
   * Whether to send and sign `x-amz-content-sha256`. True for real calls (S3
   * requires it and Lambda Function URLs accept it); false only so the AWS
   * published test vector, which signs `host;x-amz-date` alone, can be
   * reproduced exactly.
   */
  signContentSha?: boolean;
};

export type SignedRequest = {
  url: string;
  headers: Record<string, string>;
  /** The canonical request, exposed for tests and for debugging a 403. */
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
};

/**
 * Sign one request and return the headers to send with it.
 *
 * The double-encoding of the canonical path is the rule that trips people up:
 * every service EXCEPT S3 encodes path segments twice in the string to sign.
 * A Function URL's path is `/`, where the distinction is invisible, but the
 * rule is implemented rather than assumed so this signer stays a faithful port
 * of the Lambda's and can be reused if a non-root path ever appears.
 */
export function signRequest(input: SignRequestInput): SignedRequest {
  const {
    method,
    host,
    pathSegments = [],
    body = "",
    service,
    region,
    credentials,
    date,
    extraHeaders = {},
    signContentSha = true,
  } = input;

  const isS3 = service === "s3";
  const urlPath = "/" + pathSegments.map(uriEncode).join("/");
  const canonicalPath = isS3
    ? urlPath
    : "/" + pathSegments.map((s) => uriEncode(uriEncode(s))).join("/");

  const payloadHash = sha256Hex(body);
  const { amzDate, dateStamp } = amzDates(date);

  const headers: Record<string, string> = {
    ...extraHeaders,
    host,
    "x-amz-date": amzDate,
  };
  if (signContentSha) headers["x-amz-content-sha256"] = payloadHash;
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((h) => `${h}:${headers[h]!.trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    canonicalPath,
    "", // no query string on any request this signer makes
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + credentials.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    url: `https://${host}${urlPath}`,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
}
