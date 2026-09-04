import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `lib/dedup/infer-client.ts` against a mocked AWS SDK and a mocked `fetch`.
 *
 * WHAT THIS DOES NOT PROVE: that the deployed Function URL accepts the
 * signature. That needs a live AWS session, and the one on this machine is
 * expired. What it does prove is everything on this side of the wire — that
 * credentials come from the default chain, that the request carries an
 * `authorization` header and the documented Titan request body, that the
 * threshold sent is the one read from `metrics/dedup-eval.json` rather than a
 * hardcoded literal, that the response is parsed defensively, and — most
 * importantly — that EVERY failure path returns `{ available: false }` instead
 * of throwing, because the composer must never be blocked by a dedup check.
 *
 * The signing math itself is pinned separately, against AWS's own published
 * test vector, in `aws-sigv4.test.ts`.
 */

const mockCredentials = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    config: { credentials: () => Promise<unknown> };
    constructor() {
      this.config = { credentials: () => mockCredentials() };
    }
  }
  return { S3Client: MockS3Client };
});

const FAKE_CREDS = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  sessionToken: "FAKE-SESSION-TOKEN",
};

const FUNCTION_URL = "https://abc123def456.lambda-url.us-east-1.on.aws/";

/** A response shaped exactly like infra/lambda-dedup-infer/index.mjs returns. */
function lambdaBody(overrides: Record<string, unknown> = {}) {
  return {
    matches: [
      {
        number: 79,
        type: "issue",
        title: "Auto-add your links (affiliate/product) to every video's description",
        score: 0.8616,
      },
      { number: 27, type: "issue", title: "Add affiliate links to descriptions", score: 0.8412 },
    ],
    duplicate: true,
    threshold: 0.842,
    model: "amazon.titan-embed-text-v2:0",
    indexed_documents: 132,
    index_built_at: "2026-09-02T20:11:03.000Z",
    timing_ms: { total: 214, index_load: 0, index_cold_load: 940, embed: 198, score: 3 },
    ...overrides,
  };
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, text: string): Response {
  return { ok: false, status, text: async () => text } as unknown as Response;
}

const ORIGINAL_ENV = { ...process.env };
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetModules();
  mockCredentials.mockReset();
  mockCredentials.mockResolvedValue(FAKE_CREDS);
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  process.env = { ...ORIGINAL_ENV };
  // Read metrics/dedup-eval.json off disk rather than reaching for S3, exactly
  // as tests/lib/dedup/queue-duplicates.test.ts does.
  process.env.ML_ARTIFACT_STORE = "local";
  process.env.DEDUP_INFER_FUNCTION_URL = FUNCTION_URL;
  delete process.env.DEDUP_INFER_REGION;
  // Quiet the deliberate console.warn on the failure paths.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

async function load() {
  return import("../../../lib/dedup/infer-client");
}

const DRAFT = {
  title: "Put my affiliate links into every video description automatically",
  body: "Whenever a video is published, append my product and affiliate links to its description so I don't have to paste them by hand each time.",
};

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

describe("dedupInferenceRegion", () => {
  test("reads the region out of the Function URL host", async () => {
    const { dedupInferenceRegion } = await load();
    expect(dedupInferenceRegion("https://x.lambda-url.eu-west-2.on.aws/")).toBe("eu-west-2");
  });

  test("an explicit override wins", async () => {
    process.env.DEDUP_INFER_REGION = "us-west-2";
    const { dedupInferenceRegion } = await load();
    expect(dedupInferenceRegion(FUNCTION_URL)).toBe("us-west-2");
  });

  test("falls back to the AWS_REGION chain for an unrecognised host", async () => {
    process.env.AWS_REGION = "ap-south-1";
    const { dedupInferenceRegion } = await load();
    expect(dedupInferenceRegion("https://example.com/")).toBe("ap-south-1");
  });
});

describe("dedupInferenceUrl", () => {
  test("is null when unset, so the feature is simply absent", async () => {
    delete process.env.DEDUP_INFER_FUNCTION_URL;
    const { dedupInferenceUrl } = await load();
    expect(dedupInferenceUrl()).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The happy path                                                      */
/* ------------------------------------------------------------------ */

describe("inferDraftDuplicates — the request", () => {
  test("posts a SigV4-signed request to the Function URL", async () => {
    mockFetch.mockResolvedValue(okResponse(lambdaBody()));
    const { inferDraftDuplicates } = await load();
    await inferDraftDuplicates(DRAFT);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FUNCTION_URL);

    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/lambda\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
    );
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-amz-security-token"]).toBe("FAKE-SESSION-TOKEN");
    expect(headers.host).toBe("abc123def456.lambda-url.us-east-1.on.aws");
    expect(init.method).toBe("POST");
  });

  test("sends the handler's documented body, with the threshold read from metrics", async () => {
    mockFetch.mockResolvedValue(okResponse(lambdaBody()));
    const { inferDraftDuplicates } = await load();
    await inferDraftDuplicates(DRAFT);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.title).toBe(DRAFT.title);
    expect(sent.body).toBe(DRAFT.body);
    expect(sent.topK).toBe(3);
    // 0.842 is results.duplicate.dense_titan.precision_first_operating_point
    // in metrics/dedup-eval.json — asserted as a READ value, not as a literal
    // this module owns. If the eval is re-run, this is what should move.
    expect(sent.threshold).toBe(0.842);
  });

  test("the signed payload hash is the body actually sent", async () => {
    mockFetch.mockResolvedValue(okResponse(lambdaBody()));
    const { inferDraftDuplicates } = await load();
    await inferDraftDuplicates(DRAFT);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(init.body as string, "utf8").digest("hex");
    expect(headers["x-amz-content-sha256"]).toBe(expected);
  });
});

describe("inferDraftDuplicates — the response", () => {
  test("returns the matches and flags the duplicate", async () => {
    mockFetch.mockResolvedValue(okResponse(lambdaBody()));
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toEqual({
      number: 79,
      type: "issue",
      title: "Auto-add your links (affiliate/product) to every video's description",
      score: 0.8616,
    });
    expect(result.duplicate).toBe(true);
    expect(result.threshold).toBe(0.842);
    expect(result.thresholdSource).toBe("metrics");
    expect(result.model).toBe("amazon.titan-embed-text-v2:0");
    expect(result.indexedDocuments).toBe(132);
    expect(result.lambdaMs).toBe(214);
  });

  /**
   * The regression this guards: a one-line draft scored 0.714 against the issue
   * it paraphrased, did not clear 0.842, and was reported as "nothing scores at
   * or above the threshold" — which reads as a clean bill of health but is
   * actually an out-of-domain comparison. The 0.842 sweep is fitted entirely on
   * index-vector pairs whose shortest member is 950 characters
   * (`calibration_domain.min_positive_member_chars` in metrics/dedup-eval.json),
   * and short-vs-long cosine is depressed independently of meaning.
   */
  test("flags a short draft as out of the threshold's calibrated domain", async () => {
    mockFetch.mockResolvedValue(
      okResponse(
        lambdaBody({
          matches: [{ number: 115, type: "issue", title: "Cache & reuse AI stills", score: 0.714 }],
          duplicate: false,
        }),
      ),
    );
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates({
      title: "Cache AI images between videos to cut the image bill",
      body: "",
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.outOfDomain).toBe(true);
    expect(result.queryChars).toBe(52);
    // Read from the artifact, not owned by this module — same discipline as the
    // threshold itself. If the eval is re-run, this is what should move.
    expect(result.minCalibratedChars).toBe(950);
    // The ranking is still the useful output; only the verdict lacks evidence.
    expect(result.duplicate).toBe(false);
    expect(result.matches[0]!.number).toBe(115);
  });

  test("a full-length draft is in domain", async () => {
    mockFetch.mockResolvedValue(okResponse(lambdaBody()));
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates({ title: DRAFT.title, body: "x".repeat(1000) });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.outOfDomain).toBe(false);
    expect(result.queryChars).toBeGreaterThanOrEqual(950);
  });

  test("out-of-domain does NOT suppress a genuine high-scoring match", async () => {
    // The reported problem is a false negative. A short draft that clears the
    // threshold anyway is a strong signal and must still be flagged.
    mockFetch.mockResolvedValue(
      okResponse(
        lambdaBody({
          matches: [{ number: 115, type: "issue", title: "Cache & reuse AI stills", score: 0.97 }],
        }),
      ),
    );
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates({ title: "Cache AI stills between videos", body: "" });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.outOfDomain).toBe(true);
    expect(result.duplicate).toBe(true);
  });

  test("recomputes `duplicate` rather than trusting the flag", async () => {
    // A response whose flag and scores disagree: the top score is below the
    // threshold but the handler said `duplicate: true`. The score wins.
    mockFetch.mockResolvedValue(
      okResponse(
        lambdaBody({
          matches: [{ number: 12, type: "issue", title: "Something else", score: 0.41 }],
          duplicate: true,
        }),
      ),
    );
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result.available && result.duplicate).toBe(false);
  });

  test("drops malformed matches instead of rendering them", async () => {
    mockFetch.mockResolvedValue(
      okResponse(
        lambdaBody({
          matches: [
            { number: 79, title: "Fine", score: 0.9 },
            { number: "not a number", title: "Bad", score: 0.9 },
            { number: 5, title: "No score" },
            null,
          ],
        }),
      ),
    );
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.matches.map((m) => m.number)).toEqual([79]);
    expect(result.matches[0]!.type).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Every failure is graceful — this is the load-bearing part           */
/* ------------------------------------------------------------------ */

describe("inferDraftDuplicates — degradation", () => {
  test("unconfigured: returns unavailable and never calls out", async () => {
    delete process.env.DEDUP_INFER_FUNCTION_URL;
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result).toEqual({
      available: false,
      reason: expect.stringContaining("DEDUP_INFER_FUNCTION_URL"),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("expired/absent credentials: unavailable, and nothing is sent", async () => {
    mockCredentials.mockRejectedValue(
      Object.assign(new Error("Your session has expired."), {
        name: "CredentialsProviderError",
      }),
    );
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result.available).toBe(false);
    expect(result.available === false && result.reason).toContain("AWS credentials");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("a credential chain that resolves nothing is still not a crash", async () => {
    mockCredentials.mockResolvedValue({});
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result.available).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("403 says it is a permissions problem, not a retryable one", async () => {
    mockFetch.mockResolvedValue(errorResponse(403, "{\"Message\":\"Forbidden\"}"));
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result.available).toBe(false);
    expect(result.available === false && result.reason).toContain("lambda:InvokeFunctionUrl");
  });

  test("a 500 from the Function URL is reported, not thrown", async () => {
    mockFetch.mockResolvedValue(errorResponse(500, "boom"));
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result).toEqual({ available: false, reason: expect.stringContaining("500") });
  });

  test("a timeout is reported as a timeout", async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    );
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result).toEqual({ available: false, reason: "The duplicate check timed out." });
  });

  test("a network failure is reported, not thrown", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result.available).toBe(false);
  });

  test("the handler's own {error} shape is unavailable, not a match list", async () => {
    mockFetch.mockResolvedValue(okResponse({ error: "Index is 384-dim but this embeds at 1024." }));
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result.available).toBe(false);
  });

  test("an unparseable body is unavailable, not a crash", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>502 Bad Gateway</html>",
    } as unknown as Response);
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result.available).toBe(false);
  });

  test("an empty draft never reaches the network", async () => {
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates({ title: "   ", body: "" });
    expect(result).toEqual({ available: false, reason: "Nothing to check yet." });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("a malformed Function URL is unavailable, not a crash", async () => {
    process.env.DEDUP_INFER_FUNCTION_URL = "not a url";
    const { inferDraftDuplicates } = await load();
    const result = await inferDraftDuplicates(DRAFT);
    expect(result.available).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
