import { describe, expect, test } from "vitest";

// scripts/ml/_shared.mjs is imported by explicit relative path (it is not
// under lib/), the same way evaluate.mjs and build-index.mjs import it.
import { buildMethods, loadAllEmbeddings } from "../../../scripts/ml/_shared.mjs";

const docs = [
  {
    number: 1,
    type: "issue",
    title: "duplicate detection",
    body: "find near-duplicate issues",
    labels: [],
    state: "open",
    author: null,
    created_at: null,
    closed_at: null,
    merged_at: null,
  },
  {
    number: 2,
    type: "issue",
    title: "unrelated topic",
    body: "something else entirely",
    labels: [],
    state: "open",
    author: null,
    created_at: null,
    closed_at: null,
    merged_at: null,
  },
];

function fakeIndex(vectors: number[][], backend = "local") {
  return {
    model: "fake-model",
    backend,
    dims: vectors[0].length,
    builtAt: "2026-01-01T00:00:00.000Z",
    corpusSha256: "deadbeef",
    numbers: [1, 2],
    vectors,
  };
}

/* ------------------------------------------------------------------ */
/* buildMethods — the naming/shape contract compare-encoders.mjs and   */
/* evaluate.mjs both depend on.                                        */
/* ------------------------------------------------------------------ */

describe("buildMethods", () => {
  test("always returns the three lexical baselines, in order", () => {
    const methods = buildMethods(docs, null);
    expect(methods.map((m) => m.name)).toEqual(["overlap", "overlap_norm", "bm25"]);
  });

  test("a bare single-index object (pre-split shape) adds one method named 'dense'", () => {
    const methods = buildMethods(
      docs,
      fakeIndex([
        [1, 0],
        [0, 1],
      ]),
    );
    const names = methods.map((m) => m.name);
    expect(names).toContain("dense");
    expect(names).not.toContain("dense_local");
    expect(names).not.toContain("dense_titan");
  });

  test("a { local, titan } map adds dense_local AND dense_titan", () => {
    const methods = buildMethods(docs, {
      local: fakeIndex(
        [
          [1, 0],
          [0, 1],
        ],
        "local",
      ),
      titan: fakeIndex(
        [
          [1, 1],
          [1, -1],
        ],
        "bedrock",
      ),
    });
    const names = methods.map((m) => m.name);
    expect(names).toEqual(["overlap", "overlap_norm", "bm25", "dense_local", "dense_titan"]);
  });

  test("a map with only 'local' present omits dense_titan entirely (not a zero score)", () => {
    const methods = buildMethods(docs, {
      local: fakeIndex([
        [1, 0],
        [0, 1],
      ]),
    });
    const names = methods.map((m) => m.name);
    expect(names).toContain("dense_local");
    expect(names).not.toContain("dense_titan");
  });

  test("an empty map (neither backend built yet) adds no dense method", () => {
    const methods = buildMethods(docs, {});
    expect(methods.map((m) => m.name)).toEqual(["overlap", "overlap_norm", "bm25"]);
  });

  test("dense_local.scorePair is plain cosine similarity of the given vectors", () => {
    const methods = buildMethods(docs, {
      local: fakeIndex([
        [1, 0],
        [0, 1],
      ]),
    });
    const dense = methods.find((m) => m.name === "dense_local");
    expect(dense).toBeDefined();
    expect(dense!.scorePair(1, 2)).toBeCloseTo(0); // orthogonal vectors
  });

  test("dense_titan.rank ranks the other document by cosine similarity, best first", () => {
    const threeDocs = [...docs, { ...docs[0], number: 3, title: "third" }];
    const methods = buildMethods(threeDocs, {
      titan: fakeIndex([
        [1, 0],
        [0.9, 0.1], // close to doc 1
        [-1, 0], // opposite of doc 1
      ]),
    });
    const dense = methods.find((m) => m.name === "dense_titan");
    expect(dense).toBeDefined();
    const ranked = dense!.rank(1);
    expect(ranked.map((r) => r.number)).toEqual([2, 3]);
  });
});

/* ------------------------------------------------------------------ */
/* loadAllEmbeddings — integration check against the real repo state.  */
/* build-index.mjs was run as part of this work and wrote              */
/* data/embeddings-local.json; data/embeddings-titan.json does not     */
/* exist because there is no AWS account yet, which is exactly the     */
/* "absent, not zeroed" case this function exists to handle.           */
/* ------------------------------------------------------------------ */

describe("loadAllEmbeddings (real repo files)", () => {
  test("finds the local index and correctly reports titan as absent", async () => {
    const sets = await loadAllEmbeddings();
    expect(sets.local).toBeDefined();
    expect(sets.local?.backend).toBe("local");
    expect(sets.local?.numbers?.length).toBeGreaterThan(0);
    expect(sets.titan).toBeUndefined();
  });
});
