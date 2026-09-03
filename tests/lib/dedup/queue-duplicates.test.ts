import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INDEX_REPO,
  findQueueDuplicates,
  resetDuplicateIndexCache,
  type ScorableIdea,
} from "../../../lib/dedup/queue-duplicates";

/**
 * The Ideas-screen duplicate detector, exercised against the REAL committed
 * artifacts — `data/embeddings-titan.json` and `metrics/dedup-eval.json` — not
 * a fixture.
 *
 * That is deliberate. The thing worth testing here is not that a dot product
 * works; it is that the shipped index, the shipped threshold and the shipped
 * issue numbers still agree with each other. A synthetic index would pass
 * forever while the product silently reported nothing.
 *
 * `ML_ARTIFACT_STORE=local` keeps every case off the network: `artifact-store`
 * would otherwise try S3 first, which in CI is a slow failure and on a laptop
 * with credentials is a slow success.
 */

/** Two ideas that really are the same proposal, filed twice, in the pilot repo. */
const KNOWN_PAIR = { a: 27, b: 79 };

function idea(number: number, title = `Issue ${number}`): ScorableIdea {
  return {
    number,
    title,
    htmlUrl: `https://github.com/${INDEX_REPO.owner}/${INDEX_REPO.repo}/issues/${number}`,
  };
}

/** Every idea-labelled issue that is in the corpus, as the queue would supply it. */
const QUEUE: ScorableIdea[] = [
  17, 27, 51, 57, 58, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 82, 83, 84, 85, 86,
  87, 88, 89, 90, 100, 101, 102, 103, 109, 110, 114, 115, 118, 126,
].map((n) => idea(n));

beforeEach(() => {
  resetDuplicateIndexCache();
  vi.stubEnv("ML_ARTIFACT_STORE", "local");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDuplicateIndexCache();
  vi.restoreAllMocks();
});

describe("findQueueDuplicates", () => {
  it("uses the Titan index and the 0.842 operating point out of metrics/dedup-eval.json", async () => {
    const report = await findQueueDuplicates(INDEX_REPO, QUEUE);
    expect(report).not.toBeNull();
    // Not a hardcoded expectation duplicated from the source: this asserts the
    // number the product uses is the one the eval actually swept.
    expect(report!.thresholdSource).toBe("metrics");
    expect(report!.threshold).toBe(0.842);
    expect(report!.method).toBe("dense_titan");
    expect(report!.model).toBe("amazon.titan-embed-text-v2:0");
    expect(report!.indexSource).toBe("local");
  });

  it("finds the real duplicate pair in the pilot queue, above the threshold", async () => {
    const report = await findQueueDuplicates(INDEX_REPO, QUEUE);
    const forA = report!.pairs[String(KNOWN_PAIR.a)];
    expect(forA).toBeDefined();
    expect(forA![0]!.number).toBe(KNOWN_PAIR.b);
    expect(forA![0]!.score).toBeGreaterThanOrEqual(report!.threshold);
    // Pinned so a rebuilt index that moves this pair below the line is a
    // failing test rather than a feature that quietly stops finding anything.
    expect(forA![0]!.score).toBeCloseTo(0.8616, 3);
  });

  it("reports the pair on both cards, with the same score", async () => {
    const report = await findQueueDuplicates(INDEX_REPO, QUEUE);
    const forA = report!.pairs[String(KNOWN_PAIR.a)]!;
    const forB = report!.pairs[String(KNOWN_PAIR.b)]!;
    expect(forB[0]!.number).toBe(KNOWN_PAIR.a);
    expect(forB[0]!.score).toBe(forA[0]!.score);
  });

  it("carries the queue's own title and URL into the match, not the corpus's", async () => {
    const report = await findQueueDuplicates(INDEX_REPO, [
      idea(KNOWN_PAIR.a, "Renamed since the index was built"),
      idea(KNOWN_PAIR.b),
    ]);
    const match = report!.pairs[String(KNOWN_PAIR.b)]![0]!;
    expect(match.title).toBe("Renamed since the index was built");
    expect(match.htmlUrl).toBe(
      `https://github.com/${INDEX_REPO.owner}/${INDEX_REPO.repo}/issues/${KNOWN_PAIR.a}`,
    );
  });

  it("never reports an idea as its own duplicate, even when it appears twice", async () => {
    // An open-but-declined idea rides along in BOTH the live list and `closed`.
    const report = await findQueueDuplicates(INDEX_REPO, [
      idea(KNOWN_PAIR.a),
      idea(KNOWN_PAIR.a),
      idea(KNOWN_PAIR.b),
    ]);
    expect(report!.scored).toBe(2);
    for (const [number, matches] of Object.entries(report!.pairs)) {
      expect(matches.map((m) => m.number)).not.toContain(Number(number));
    }
  });

  it("puts ideas the index has never seen in `unindexed` rather than scoring them", async () => {
    const report = await findQueueDuplicates(INDEX_REPO, [
      idea(KNOWN_PAIR.a),
      idea(KNOWN_PAIR.b),
      idea(999_001),
      idea(999_000),
    ]);
    expect(report!.unindexed).toEqual([999_000, 999_001]);
    expect(report!.scored).toBe(2);
    expect(report!.pairs["999001"]).toBeUndefined();
  });

  it("refuses to score a repo the index does not describe", async () => {
    // Issue numbers are per-repo: this is the difference between a useful hint
    // and a confident lie about two unrelated issues.
    const report = await findQueueDuplicates(
      { owner: INDEX_REPO.owner, repo: "supply-chain-optimizer" },
      QUEUE,
    );
    expect(report).toBeNull();
  });

  it("returns null rather than throwing when no index can be loaded", async () => {
    // The Ideas screen still has to render. `artifact-store` resolves ROOT at
    // module load, so the way to make both stores fail is to move the paths.
    const { ARTIFACTS } = await import("../../../lib/dedup/artifact-store");
    const saved = { titan: ARTIFACTS["embeddings-titan"].localPath, local: ARTIFACTS["embeddings-local"].localPath };
    ARTIFACTS["embeddings-titan"].localPath = "data/does-not-exist.json";
    ARTIFACTS["embeddings-local"].localPath = "data/does-not-exist.json";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDuplicateIndexCache();
    try {
      await expect(findQueueDuplicates(INDEX_REPO, QUEUE)).resolves.toBeNull();
    } finally {
      ARTIFACTS["embeddings-titan"].localPath = saved.titan;
      ARTIFACTS["embeddings-local"].localPath = saved.local;
      resetDuplicateIndexCache();
    }
  });

  it("returns null for a queue too small to have a pair", async () => {
    await expect(findQueueDuplicates(INDEX_REPO, [])).resolves.toBeNull();
    await expect(findQueueDuplicates(INDEX_REPO, [idea(27)])).resolves.toBeNull();
  });

  it("caps and orders the matches on each card", async () => {
    const report = await findQueueDuplicates(INDEX_REPO, QUEUE);
    for (const matches of Object.values(report!.pairs)) {
      expect(matches.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < matches.length; i += 1) {
        expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score);
      }
    }
  });

  it("never reports a pair below the threshold", async () => {
    const report = await findQueueDuplicates(INDEX_REPO, QUEUE);
    for (const matches of Object.values(report!.pairs)) {
      for (const match of matches) {
        expect(match.score).toBeGreaterThanOrEqual(report!.threshold);
      }
    }
  });
});

describe("the local (MiniLM) fallback", () => {
  it("brings its own calibrated threshold rather than reusing Titan's", async () => {
    // Titan's 0.842 was swept for Titan. Applying it to MiniLM cosines would be
    // a different operating point with different precision — so when the
    // fallback index answers, the fallback's own 0.828 has to come with it.
    const { ARTIFACTS } = await import("../../../lib/dedup/artifact-store");
    const realTitanPath = ARTIFACTS["embeddings-titan"].localPath;
    ARTIFACTS["embeddings-titan"].localPath = "data/does-not-exist.json";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDuplicateIndexCache();
    try {
      const report = await findQueueDuplicates(INDEX_REPO, QUEUE);
      expect(report!.method).toBe("dense_local");
      expect(report!.model).toBe("Xenova/all-MiniLM-L6-v2");
      expect(report!.threshold).toBe(0.828);
      expect(report!.thresholdSource).toBe("metrics");
    } finally {
      ARTIFACTS["embeddings-titan"].localPath = realTitanPath;
      resetDuplicateIndexCache();
    }
  });
});
