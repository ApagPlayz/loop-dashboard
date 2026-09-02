import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Mock for `@aws-sdk/client-bedrock-runtime`. There is no AWS account yet
 * (see docs/ml-dedup.md), so the Bedrock backend in lib/dedup/embed.ts has
 * never made a real InvokeModel call — everything below verifies the request
 * shape, response parsing, retry/error behaviour, and region/model resolution
 * against a fake client instead. This is the "unit-test what you can with
 * mocks" half of the deliverable; the real end-to-end call is unverified
 * until an AWS account exists (see the module's own doc comment).
 */
const mockSend = vi.fn();
const mockClientCtor = vi.fn();
const mockCommandCtor = vi.fn();

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  class MockBedrockRuntimeClient {
    constructor(config: unknown) {
      mockClientCtor(config);
    }
    send(cmd: unknown) {
      return mockSend(cmd);
    }
  }
  class MockInvokeModelCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
      mockCommandCtor(input);
    }
  }
  return {
    BedrockRuntimeClient: MockBedrockRuntimeClient,
    InvokeModelCommand: MockInvokeModelCommand,
  };
});

/** A Titan-v2-shaped InvokeModel response, matching AWS's documented contract:
 * https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-embed-text.html */
function fakeTitanResponse(embedding: number[]) {
  return {
    body: {
      transformToString: () =>
        JSON.stringify({
          embedding,
          inputTextTokenCount: 7,
          embeddingsByType: { float: embedding },
        }),
    },
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  mockSend.mockReset();
  mockClientCtor.mockReset();
  mockCommandCtor.mockReset();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.EMBEDDING_BACKEND;
  delete process.env.EMBEDDING_BEDROCK_DIMENSIONS;
  delete process.env.EMBEDDING_BEDROCK_MODEL;
  delete process.env.DASHBOARD_AI_BEDROCK_REGION;
  delete process.env.AWS_REGION;
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...ORIGINAL_ENV };
});

/* ------------------------------------------------------------------ */
/* Pure helpers — no env dependence                                    */
/* ------------------------------------------------------------------ */

describe("cosineSim", () => {
  test("returns 1 for identical vectors", async () => {
    const { cosineSim } = await import("../../../lib/dedup/embed");
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  test("returns 0 for orthogonal vectors", async () => {
    const { cosineSim } = await import("../../../lib/dedup/embed");
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
  });

  test("returns -1 for opposite vectors", async () => {
    const { cosineSim } = await import("../../../lib/dedup/embed");
    expect(cosineSim([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  test("throws on a vector-length mismatch", async () => {
    const { cosineSim } = await import("../../../lib/dedup/embed");
    expect(() => cosineSim([1, 2], [1, 2, 3])).toThrow(/length mismatch/i);
  });

  test("returns 0 (not NaN) when a vector is all-zero", async () => {
    const { cosineSim } = await import("../../../lib/dedup/embed");
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });
});

describe("indexToMap", () => {
  test("maps document numbers to their vectors, in index order", async () => {
    const { indexToMap } = await import("../../../lib/dedup/embed");
    const index = {
      model: "m",
      backend: "local" as const,
      dims: 2,
      builtAt: "2026-01-01T00:00:00.000Z",
      corpusSha256: "abc",
      numbers: [10, 20],
      vectors: [
        [1, 2],
        [3, 4],
      ],
    };
    const map = indexToMap(index);
    expect(map.get(10)).toEqual([1, 2]);
    expect(map.get(20)).toEqual([3, 4]);
    expect(map.size).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Backend selection                                                   */
/* ------------------------------------------------------------------ */

describe("backend selection", () => {
  test("defaults to local with 384 expected dims", async () => {
    const mod = await import("../../../lib/dedup/embed");
    expect(mod.embeddingBackend()).toBe("local");
    expect(mod.embeddingModelId()).toBe(mod.LOCAL_EMBEDDING_MODEL);
    expect(mod.expectedEmbeddingDims()).toBe(384);
  });

  test("EMBEDDING_BACKEND=bedrock selects Titan v2 with 1024 expected dims", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    const mod = await import("../../../lib/dedup/embed");
    expect(mod.embeddingBackend()).toBe("bedrock");
    expect(mod.embeddingModelId()).toBe("amazon.titan-embed-text-v2:0");
    expect(mod.expectedEmbeddingDims()).toBe(1024);
  });

  test("rejects an unknown EMBEDDING_BACKEND value", async () => {
    process.env.EMBEDDING_BACKEND = "openai";
    const mod = await import("../../../lib/dedup/embed");
    expect(() => mod.embeddingBackend()).toThrow(/Unknown EMBEDDING_BACKEND/);
  });

  test("EMBEDDING_BEDROCK_DIMENSIONS rejects a width Titan v2 does not support", async () => {
    process.env.EMBEDDING_BEDROCK_DIMENSIONS = "777";
    await expect(import("../../../lib/dedup/embed")).rejects.toThrow(
      /only accepts 1024, 512, or 256/,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Bedrock backend — request shape, region, retries, error contract    */
/* ------------------------------------------------------------------ */

describe("embedTexts (bedrock backend, mocked AWS SDK)", () => {
  test("sends the documented Titan v2 request shape and parses the response", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    const mod = await import("../../../lib/dedup/embed");
    mockSend.mockResolvedValue(fakeTitanResponse(Array(1024).fill(0.01)));

    const [vec] = await mod.embedTexts(["hello world"]);

    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec).toHaveLength(1024);
    expect(mockCommandCtor).toHaveBeenCalledTimes(1);
    const input = mockCommandCtor.mock.calls[0][0] as {
      modelId: string;
      contentType: string;
      accept: string;
      body: string;
    };
    expect(input.modelId).toBe("amazon.titan-embed-text-v2:0");
    expect(input.contentType).toBe("application/json");
    expect(input.accept).toBe("application/json");
    const body = JSON.parse(input.body);
    expect(body).toEqual({ inputText: "hello world", dimensions: 1024, normalize: true });
  });

  test("truncates input text to MAX_CHARS before sending, same as the local backend", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    const mod = await import("../../../lib/dedup/embed");
    mockSend.mockResolvedValue(fakeTitanResponse(Array(1024).fill(0)));

    await mod.embedTexts(["x".repeat(3000)]);

    const input = mockCommandCtor.mock.calls[0][0] as { body: string };
    const body = JSON.parse(input.body);
    expect(body.inputText).toHaveLength(mod.MAX_CHARS);
  });

  test("returns [] without touching the network for an empty input list", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    const mod = await import("../../../lib/dedup/embed");
    const result = await mod.embedTexts([]);
    expect(result).toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("preserves input order across concurrent requests", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    const mod = await import("../../../lib/dedup/embed");
    const texts = Array.from({ length: 12 }, (_, i) => `doc-${i}`);
    mockSend.mockImplementation(async (cmd: { input: { body: string } }) => {
      const { inputText } = JSON.parse(cmd.input.body);
      const idx = Number(inputText.split("-")[1]);
      // Deliberately-scrambled latency so responses can land out of request order.
      await new Promise((resolve) => setTimeout(resolve, (11 - idx) % 4));
      return fakeTitanResponse(Array(1024).fill(idx));
    });

    const vectors = await mod.embedTexts(texts);

    vectors.forEach((v, i) => expect(v[0]).toBe(i));
  });

  test("respects EMBEDDING_BEDROCK_DIMENSIONS in both the request and the returned vector width", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    process.env.EMBEDDING_BEDROCK_DIMENSIONS = "256";
    const mod = await import("../../../lib/dedup/embed");
    mockSend.mockResolvedValue(fakeTitanResponse(Array(256).fill(0.1)));

    const [vec] = await mod.embedTexts(["hi"]);

    expect(vec).toHaveLength(256);
    const body = JSON.parse((mockCommandCtor.mock.calls[0][0] as { body: string }).body);
    expect(body.dimensions).toBe(256);
  });

  test("EMBEDDING_BEDROCK_MODEL override changes the modelId actually invoked, not just its label", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    process.env.EMBEDDING_BEDROCK_MODEL = "amazon.titan-embed-text-v2:custom-profile";
    const mod = await import("../../../lib/dedup/embed");
    mockSend.mockResolvedValue(fakeTitanResponse(Array(1024).fill(0)));

    await mod.embedTexts(["hi"]);

    const input = mockCommandCtor.mock.calls[0][0] as { modelId: string };
    expect(input.modelId).toBe("amazon.titan-embed-text-v2:custom-profile");
    expect(mod.embeddingModelId()).toBe("amazon.titan-embed-text-v2:custom-profile");
  });

  test("throws when Titan returns a different width than requested (does not silently accept it)", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    const mod = await import("../../../lib/dedup/embed");
    mockSend.mockResolvedValue(fakeTitanResponse(Array(256).fill(0.1))); // asked for 1024

    await expect(mod.embedTexts(["hi"])).rejects.toThrow(/256 dims, expected 1024/);
  });

  test("retries on ThrottlingException with backoff, then succeeds", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    const mod = await import("../../../lib/dedup/embed");
    let calls = 0;
    mockSend.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("slow down");
        err.name = "ThrottlingException";
        throw err;
      }
      return fakeTitanResponse(Array(1024).fill(0.5));
    });

    vi.useFakeTimers();
    const promise = mod.embedTexts(["hello"]);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(calls).toBe(2);
    expect(result).toHaveLength(1);
  });

  test("a non-retryable error throws immediately and never falls back to local", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    const mod = await import("../../../lib/dedup/embed");
    mockSend.mockImplementation(async () => {
      const err = new Error("not authorized to invoke this model");
      err.name = "AccessDeniedException";
      throw err;
    });

    await expect(mod.embedTexts(["hello"])).rejects.toThrow(
      /Refusing to fall back to the local model/,
    );
    expect(mockSend).toHaveBeenCalledTimes(1); // no retry on a non-retryable error
  });

  test("region: DASHBOARD_AI_BEDROCK_REGION wins over AWS_REGION", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    process.env.AWS_REGION = "us-west-2";
    process.env.DASHBOARD_AI_BEDROCK_REGION = "eu-central-1";
    const mod = await import("../../../lib/dedup/embed");
    mockSend.mockResolvedValue(fakeTitanResponse(Array(1024).fill(0)));

    await mod.embedTexts(["hi"]);

    expect(mockClientCtor).toHaveBeenCalledWith({ region: "eu-central-1" });
  });

  test("region: falls back to AWS_REGION when DASHBOARD_AI_BEDROCK_REGION is unset", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    process.env.AWS_REGION = "ap-southeast-2";
    const mod = await import("../../../lib/dedup/embed");
    mockSend.mockResolvedValue(fakeTitanResponse(Array(1024).fill(0)));

    await mod.embedTexts(["hi"]);

    expect(mockClientCtor).toHaveBeenCalledWith({ region: "ap-southeast-2" });
  });

  test("region: defaults to us-east-1 when nothing is set", async () => {
    process.env.EMBEDDING_BACKEND = "bedrock";
    const mod = await import("../../../lib/dedup/embed");
    mockSend.mockResolvedValue(fakeTitanResponse(Array(1024).fill(0)));

    await mod.embedTexts(["hi"]);

    expect(mockClientCtor).toHaveBeenCalledWith({ region: "us-east-1" });
  });
});
