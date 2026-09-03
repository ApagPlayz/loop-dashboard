import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import { amzDates, signRequest, uriEncode } from "../../../lib/dedup/aws-sigv4";

/**
 * Signing is the part of `lib/dedup/infer-client.ts` that either works exactly
 * or fails with an opaque 403, and it cannot be exercised end to end without a
 * live AWS session. So it is pinned two ways here:
 *
 *   1. Against AWS's own published Signature V4 test vector (`get-vanilla`
 *      from the SigV4 test suite), which uses the documented example
 *      credentials AKIDEXAMPLE / wJalrX… at 20150830T123600Z. The expected
 *      signature is AWS's number, not ours.
 *
 *   2. Against the exact request shape the Function URL call makes — POST /,
 *      service "lambda", a JSON body, a session token. That expected signature
 *      was produced by an INDEPENDENT implementation (`@smithy/signature-v4`
 *      5.7.3, driven from a throwaway script) and matched byte for byte before
 *      being frozen here. Smithy is not imported at test time on purpose: it
 *      is a transitive-only package present at two different major versions,
 *      which is precisely why this signer is hand-rolled (see the module's
 *      header). A frozen expected value keeps the cross-check without taking
 *      the dependency.
 *
 * If either number ever changes, the signer changed — not the vector.
 */

const EXAMPLE_CREDENTIALS = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

const SIGNING_DATE = new Date("2015-08-30T12:36:00Z");

describe("amzDates", () => {
  test("formats the two SigV4 timestamps", () => {
    expect(amzDates(SIGNING_DATE)).toEqual({
      amzDate: "20150830T123600Z",
      dateStamp: "20150830",
    });
  });
});

describe("uriEncode", () => {
  test("escapes the characters encodeURIComponent leaves alone", () => {
    // The five SigV4 cares about and encodeURIComponent does not touch.
    expect(uriEncode("!'()*")).toBe("%21%27%28%29%2A");
  });

  test("escapes the colon in a Bedrock model id", () => {
    expect(uriEncode("amazon.titan-embed-text-v2:0")).toBe("amazon.titan-embed-text-v2%3A0");
  });
});

describe("signRequest — AWS's published get-vanilla vector", () => {
  const signed = signRequest({
    method: "GET",
    host: "example.amazonaws.com",
    service: "service",
    region: "us-east-1",
    credentials: EXAMPLE_CREDENTIALS,
    date: SIGNING_DATE,
    // The vector signs host;x-amz-date only.
    signContentSha: false,
  });

  test("produces AWS's canonical request", () => {
    expect(signed.canonicalRequest).toBe(
      [
        "GET",
        "/",
        "",
        "host:example.amazonaws.com",
        "x-amz-date:20150830T123600Z",
        "",
        "host;x-amz-date",
        // sha256 of the empty payload
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ].join("\n"),
    );
  });

  test("produces the string to sign, hashing the canonical request", () => {
    // The final hash is not quoted from AWS's vector; it is derived from the
    // canonical request pinned above, which IS quoted from it. The end-to-end
    // check is the signature below — that number is AWS's.
    expect(signed.stringToSign).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20150830T123600Z",
        "20150830/us-east-1/service/aws4_request",
        createHash("sha256").update(signed.canonicalRequest, "utf8").digest("hex"),
      ].join("\n"),
    );
  });

  test("produces AWS's signature", () => {
    expect(signed.signature).toBe(
      "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });
});

describe("signRequest — the Lambda Function URL request shape", () => {
  const body = JSON.stringify({ title: "t", body: "b" });
  const host = "abc123def456.lambda-url.us-east-1.on.aws";

  const signed = signRequest({
    method: "POST",
    host,
    pathSegments: [],
    body,
    service: "lambda",
    region: "us-east-1",
    credentials: { ...EXAMPLE_CREDENTIALS, sessionToken: "FAKE/SESSION+TOKEN==" },
    date: SIGNING_DATE,
    extraHeaders: { "content-type": "application/json" },
  });

  test("signs the root path with no query string", () => {
    expect(signed.url).toBe(`https://${host}/`);
    expect(signed.canonicalRequest.split("\n").slice(0, 3)).toEqual(["POST", "/", ""]);
  });

  test("signs exactly the headers it sends", () => {
    expect(signed.headers.authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token",
    );
    // Every signed header must actually be on the request, or the service
    // recomputes a different canonical request and answers 403.
    for (const name of [
      "content-type",
      "host",
      "x-amz-content-sha256",
      "x-amz-date",
      "x-amz-security-token",
    ]) {
      expect(signed.headers[name]).toBeTruthy();
    }
  });

  test("hashes the payload, not UNSIGNED-PAYLOAD", () => {
    // Function URLs require the body in the signature; a placeholder here
    // would pass locally and 403 in AWS.
    expect(signed.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.canonicalRequest.endsWith(signed.headers["x-amz-content-sha256"]!)).toBe(true);
  });

  test("carries the session token through", () => {
    expect(signed.headers["x-amz-security-token"]).toBe("FAKE/SESSION+TOKEN==");
  });

  test("matches @smithy/signature-v4's signature for the same request", () => {
    expect(signed.signature).toBe(
      "1e7093440a389e970aac9bcb1207cbe5468842b19a5d55fdc975cc446c6f661c",
    );
  });

  test("changing the body changes the signature", () => {
    const other = signRequest({
      method: "POST",
      host,
      body: JSON.stringify({ title: "t", body: "different" }),
      service: "lambda",
      region: "us-east-1",
      credentials: { ...EXAMPLE_CREDENTIALS, sessionToken: "FAKE/SESSION+TOKEN==" },
      date: SIGNING_DATE,
      extraHeaders: { "content-type": "application/json" },
    });
    expect(other.signature).not.toBe(signed.signature);
  });
});

describe("signRequest — path encoding", () => {
  test("double-encodes path segments for non-S3 services", () => {
    const signed = signRequest({
      method: "POST",
      host: "bedrock-runtime.us-east-1.amazonaws.com",
      pathSegments: ["model", "amazon.titan-embed-text-v2:0", "invoke"],
      body: "{}",
      service: "bedrock",
      region: "us-east-1",
      credentials: EXAMPLE_CREDENTIALS,
      date: SIGNING_DATE,
    });
    // ":" is %3A in the URL and %253A in the string to sign — the rule the
    // Lambda handler's own comment calls out.
    expect(signed.url).toContain("/model/amazon.titan-embed-text-v2%3A0/invoke");
    expect(signed.canonicalRequest).toContain("/model/amazon.titan-embed-text-v2%253A0/invoke");
  });

  test("single-encodes path segments for S3", () => {
    const signed = signRequest({
      method: "GET",
      host: "bucket.s3.us-east-1.amazonaws.com",
      pathSegments: ["embeddings", "titan", "latest.json"],
      service: "s3",
      region: "us-east-1",
      credentials: EXAMPLE_CREDENTIALS,
      date: SIGNING_DATE,
    });
    expect(signed.canonicalRequest).toContain("/embeddings/titan/latest.json");
  });
});
