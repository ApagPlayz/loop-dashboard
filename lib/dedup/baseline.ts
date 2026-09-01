/**
 * Lexical baselines for near-duplicate detection over GitHub issues/PRs.
 *
 * Two methods, both dependency-free:
 *
 *   1. `overlap` — the approach already shipping in `lib/tool-fit.ts`
 *      (`overlapScore` / `preRank`): tokenize, drop short tokens and a small
 *      stopword list, count how many DISTINCT query tokens appear in the
 *      candidate. It is reimplemented here rather than imported because the
 *      one in tool-fit.ts is (a) not exported and (b) typed against
 *      `CatalogEntry` + a `Set<string>` repo profile, not against two
 *      documents. The tokenizer, the stopword list and the "distinct-token hit
 *      count" scoring rule are copied verbatim so the number means the same
 *      thing. The one deliberate omission is tool-fit's `quality * 0.02`
 *      tie-breaker, which reads `CatalogEntry.rankScore` — issues have no such
 *      field, and it only ever broke ties between equal hit counts.
 *
 *      Because that score is a RAW COUNT it grows with document length, so a
 *      length-normalised variant (`overlap_norm` = hits / min(|A|,|B|)) is also
 *      exposed. Both are evaluated; neither is presented as the other.
 *
 *   2. `bm25` — a textbook Okapi BM25 over the same tokenizer, written here
 *      (~70 lines) rather than pulled in as a dependency. k1 = 1.5, b = 0.75,
 *      IDF = ln(1 + (N - df + 0.5) / (df + 0.5)) (the non-negative "BM25+"
 *      style IDF, so a term appearing in >half the corpus can't push a score
 *      negative — with N = 132 that matters).
 *
 * Both expose the same shape: give it a query document, get back ranked
 * candidates with scores.
 */

/* ------------------------------------------------------------------ */
/* Corpus types                                                        */
/* ------------------------------------------------------------------ */

export type CorpusDoc = {
  number: number;
  type: "issue" | "pr";
  title: string;
  body: string;
  labels: string[];
  state: string;
  author: string | null;
  created_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
};

export type RankedCandidate = {
  /** Issue/PR number of the candidate document. */
  number: number;
  title: string;
  score: number;
};

/** Anything that can rank a query document against the indexed corpus. */
export type Ranker = {
  name: string;
  /** Score one ordered pair. Symmetric for overlap, asymmetric for BM25. */
  scorePair(a: number, b: number): number;
  /** Rank every other document against `queryNumber`, best first. */
  rank(queryNumber: number, topK?: number): RankedCandidate[];
};

/* ------------------------------------------------------------------ */
/* Tokenizer — copied from lib/tool-fit.ts so scores stay comparable   */
/* ------------------------------------------------------------------ */

/** Verbatim from lib/tool-fit.ts. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((t) => t.length > 2);
}

/** Verbatim from lib/tool-fit.ts. */
export const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "you", "your", "can", "are",
  "use", "using", "used", "from", "into", "app", "api", "run", "runs", "get",
  "web", "new", "all", "any", "one", "com", "www", "http", "https", "github",
]);

/**
 * Markdown → plain text. tool-fit.ts applies the same treatment to READMEs
 * before tokenizing; issue bodies here are markdown for the same reason.
 * Code fences are dropped: on this corpus they are mostly agent-generated
 * diffs and logs that swamp the prose.
 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text of a document as every method sees it. Title is weighted x2. */
export function docText(doc: CorpusDoc): string {
  const title = doc.title ?? "";
  return `${title} ${title} ${stripMarkdown(doc.body ?? "")}`.trim();
}

/** Tokens of a document, stopwords removed. Keeps duplicates (BM25 needs tf). */
export function docTokens(doc: CorpusDoc): string[] {
  return tokenize(docText(doc)).filter((t) => !STOPWORDS.has(t));
}

/* ------------------------------------------------------------------ */
/* 1. overlapScore — the existing in-repo baseline                     */
/* ------------------------------------------------------------------ */

/**
 * Faithful port of `overlapScore` from lib/tool-fit.ts: the number of DISTINCT
 * tokens the two documents share. `quality * 0.02` is omitted (no rankScore on
 * an issue); it was a tie-breaker only.
 */
export function overlapHits(a: Set<string>, b: Set<string>): number {
  let hits = 0;
  // Iterate the smaller set — same result, cheaper on 7,000+ pairs.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) hits += 1;
  return hits;
}

/**
 * Length-normalised overlap: shared distinct tokens over the size of the
 * smaller document. Bounded [0,1], so a single threshold is meaningful across
 * pairs — which a raw hit count is not.
 */
export function overlapNormalized(a: Set<string>, b: Set<string>): number {
  const denom = Math.min(a.size, b.size);
  return denom === 0 ? 0 : overlapHits(a, b) / denom;
}

export type OverlapVariant = "raw" | "normalized";

export function buildOverlapIndex(docs: CorpusDoc[], variant: OverlapVariant = "raw"): Ranker {
  const order = docs.map((d) => d.number);
  const titles = new Map(docs.map((d) => [d.number, d.title]));
  const sets = new Map<number, Set<string>>();
  for (const d of docs) sets.set(d.number, new Set(docTokens(d)));

  const score = (a: number, b: number): number => {
    const sa = sets.get(a);
    const sb = sets.get(b);
    if (!sa || !sb) return 0;
    return variant === "raw" ? overlapHits(sa, sb) : overlapNormalized(sa, sb);
  };

  return {
    name: variant === "raw" ? "overlap" : "overlap_norm",
    scorePair: score,
    rank(queryNumber: number, topK?: number): RankedCandidate[] {
      const out: RankedCandidate[] = [];
      for (const n of order) {
        if (n === queryNumber) continue;
        out.push({ number: n, title: titles.get(n) ?? "", score: score(queryNumber, n) });
      }
      out.sort((x, y) => y.score - x.score || x.number - y.number);
      return typeof topK === "number" ? out.slice(0, topK) : out;
    },
  };
}

/* ------------------------------------------------------------------ */
/* 2. BM25                                                             */
/* ------------------------------------------------------------------ */

export type Bm25Options = {
  /** Term-frequency saturation. 1.2–2.0 is the usual range. */
  k1?: number;
  /** Length normalisation, 0 = none, 1 = full. */
  b?: number;
};

/**
 * Okapi BM25.
 *
 *   score(Q, D) = Σ_{t ∈ Q}  idf(t) · ( tf(t,D)·(k1+1) )
 *                            / ( tf(t,D) + k1·(1 - b + b·|D|/avgdl) )
 *
 * The query is a whole document, so a query term repeated many times would
 * otherwise dominate; each distinct query term contributes once (the standard
 * treatment for long "more-like-this" queries).
 *
 * Note this is ASYMMETRIC — score(A→B) ≠ score(B→A), because only the
 * candidate's length is normalised. `scorePair` therefore returns the mean of
 * both directions, which is what a pairwise duplicate decision needs; `rank`
 * uses the true one-directional score.
 */
export function buildBm25Index(docs: CorpusDoc[], opts: Bm25Options = {}): Ranker {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;

  const order = docs.map((d) => d.number);
  const titles = new Map(docs.map((d) => [d.number, d.title]));

  /** number → (term → tf) */
  const tf = new Map<number, Map<string, number>>();
  /** number → |D| in tokens */
  const len = new Map<number, number>();
  /** term → document frequency */
  const df = new Map<string, number>();

  for (const d of docs) {
    const toks = docTokens(d);
    const counts = new Map<string, number>();
    for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
    tf.set(d.number, counts);
    len.set(d.number, toks.length);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const N = docs.length;
  const avgdl = N > 0 ? [...len.values()].reduce((s, x) => s + x, 0) / N : 0;

  const idf = new Map<string, number>();
  for (const [term, n] of df) {
    idf.set(term, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  /** Directional BM25: query document `q` against candidate document `d`. */
  const directional = (q: number, d: number): number => {
    const qTerms = tf.get(q);
    const dTf = tf.get(d);
    if (!qTerms || !dTf) return 0;
    const dl = len.get(d) ?? 0;
    const norm = k1 * (1 - b + (b * dl) / (avgdl || 1));
    let s = 0;
    for (const term of qTerms.keys()) {
      const f = dTf.get(term);
      if (!f) continue;
      s += (idf.get(term) ?? 0) * ((f * (k1 + 1)) / (f + norm));
    }
    return s;
  };

  return {
    name: "bm25",
    /** Symmetric pair score = mean of both directions. */
    scorePair(a: number, b2: number): number {
      return (directional(a, b2) + directional(b2, a)) / 2;
    },
    rank(queryNumber: number, topK?: number): RankedCandidate[] {
      const out: RankedCandidate[] = [];
      for (const n of order) {
        if (n === queryNumber) continue;
        out.push({ number: n, title: titles.get(n) ?? "", score: directional(queryNumber, n) });
      }
      out.sort((x, y) => y.score - x.score || x.number - y.number);
      return typeof topK === "number" ? out.slice(0, topK) : out;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Corpus loading                                                      */
/* ------------------------------------------------------------------ */

/** Parse the JSONL corpus text. Blank lines are skipped. */
export function parseCorpus(jsonl: string): CorpusDoc[] {
  const docs: CorpusDoc[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    docs.push(JSON.parse(t) as CorpusDoc);
  }
  return docs;
}
