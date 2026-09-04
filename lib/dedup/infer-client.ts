/**
 * Client for the deployed dedup inference Lambda —
 * `infra/lambda-dedup-infer/`, a Function URL with `AWS_IAM` auth.
 *
 * ## Why this exists, when `queue-duplicates.ts` deliberately does NOT call it
 *
 * `queue-duplicates.ts` explains at length why the Ideas screen must not go
 * through the Lambda: every idea on that screen is ALREADY in the embedding
 * index, so scoring it is a lookup and a dot product, and re-embedding it
 * through Bedrock would pay money to re-derive a vector we already hold. That
 * reasoning is correct and this module does not disturb it.
 *
 * This module is for the opposite case, which is the case the Lambda was
 * actually built for: **text that is not in the index and has no vector.** The
 * custom-idea composer is exactly that — the owner is drafting a brand-new
 * proposal that has never been embedded, and the useful question before he
 * files it is "does this already exist in the backlog?". There is no local
 * shortcut for that. Something has to embed the draft.
 *
 * ## Why the Lambda rather than embedding in the web tier
 *
 * The alternative is for the Next.js server to call Bedrock itself
 * (`lib/dedup/embed.ts`) and score against the index it fetches from S3. That
 * would work, and it would leave the Lambda uncalled. It is also the worse
 * design here, on grounds that have nothing to do with wanting to use the
 * Lambda:
 *
 *   1. **Least privilege.** Going direct, the ECS task role needs
 *      `bedrock:InvokeModel` on Titan AND `s3:GetObject` on the artifact
 *      prefixes. Going through the Function URL it needs exactly one action,
 *      `lambda:InvokeFunctionUrl`, on one function ARN. The Bedrock and S3
 *      grants stay where they already are — on the Lambda's own execution
 *      role, which `infra/deploy-dedup-inference.sh` already scopes to a single
 *      model and two key prefixes.
 *   2. **The web tier stays stateless and small.** No 541 KB index resident in
 *      the Next.js process, no 1.2 MB S3 fetch on the request path, no corpus
 *      metadata to hold for match titles.
 *   3. **The comparison set is the right one.** The Lambda scores against the
 *      full 132-document corpus — issues and PRs, open and closed — not just
 *      whatever the Ideas screen happens to have loaded. For "has this been
 *      proposed before?", a match against a closed issue from three months ago
 *      is a hit, not noise. That is a capability the local path does not have.
 *
 * ## OUT-OF-DOMAIN DRAFTS — why a near-miss here is not evidence of anything
 *
 * This path and the queue-scan path share one threshold, and they should: it is
 * the same encoder and the same index. But they do NOT share a text regime, and
 * that distinction is load-bearing.
 *
 * The 0.842 operating point was swept over 150 gold pairs in which BOTH sides
 * are prebuilt index vectors — each built from `docText()`, a doubled title plus
 * the stripped body, and the shortest text on either side of a positive pair is
 * 950 characters. The sweep therefore measures long-document vs long-document
 * similarity and says nothing about anything else.
 *
 * A composer draft is frequently one sentence with an empty body. Cosine
 * similarity between a short embedding and a long one is depressed independently
 * of meaning, so applying the swept threshold there is not merely strict — it
 * can be arithmetically unreachable. Measured on the MiniLM index: a corpus
 * document's OWN TITLE, scored against that same document's full-text vector,
 * reaches a median of 0.63 and a maximum of 0.768 against that encoder's swept
 * threshold of 0.828. Zero of 40 documents matched THEMSELVES above the
 * threshold once represented by their title alone. Zero paraphrase distance,
 * still a miss.
 *
 * The tempting response is to lower the threshold until short drafts trip it.
 * That is measurably the wrong trade: on the same gold set, moving the Titan
 * threshold from 0.842 to 0.714 takes precision from 0.909 to 0.639 — false
 * positives from 2 to 13 — to buy recall from 0.800 to 0.920. It degrades every
 * in-domain comparison on the Ideas screen in order to patch a regime the sweep
 * never measured.
 *
 * So this module changes no threshold. It reports `outOfDomain` instead, using
 * the floor published by the eval artifact, so that a false verdict is labelled
 * rather than believed. Closing the gap properly needs a short-query gold set
 * and its own swept operating point; until that exists, the ranking is the
 * honest product of this path and the yes/no is not.
 *
 * ## How it degrades
 *
 * Every failure returns `{ available: false, reason }` and logs. Nothing here
 * throws. The composer must always be able to file an idea, so a missing
 * Function URL, an expired credential chain, a 403 from IAM, a Lambda error or
 * a timeout are all the same thing to the caller: no duplicate information,
 * rendered as the absence of a panel and never as a blocked submit.
 */

import { resolveAwsCredentials, signRequest } from "./aws-sigv4";
import { dedupThreshold } from "./queue-duplicates";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/**
 * The Function URL, e.g. `https://<id>.lambda-url.us-east-1.on.aws/`.
 *
 * Not committed anywhere and not derivable: `infra/deploy-dedup-inference.sh`
 * prints it at deploy time and `aws lambda get-function-url-config` re-reads
 * it. It is deployment state, not source, so it arrives as an env var and its
 * absence is a normal, quiet "feature not configured" rather than an error.
 */
export function dedupInferenceUrl(): string | null {
  const raw = (process.env.DEDUP_INFER_FUNCTION_URL ?? "").trim();
  return raw || null;
}

/**
 * Region to sign for.
 *
 * A Function URL host encodes its own region — `<id>.lambda-url.<region>.on.aws`
 * — so the common case needs no configuration at all, and cannot drift out of
 * agreement with the URL next to it. The explicit override comes first for the
 * unusual host, and the same `AWS_REGION` fallback chain the rest of the dedup
 * pipeline uses comes last.
 */
export function dedupInferenceRegion(url: string): string {
  const explicit = (process.env.DEDUP_INFER_REGION ?? "").trim();
  if (explicit) return explicit;
  try {
    const host = new URL(url).hostname;
    const m = /\.lambda-url\.([a-z0-9-]+)\.on\.aws$/i.exec(host);
    if (m) return m[1]!.toLowerCase();
  } catch {
    /* fall through to the env chain */
  }
  return process.env.AWS_REGION || process.env.DASHBOARD_AI_BEDROCK_REGION || "us-east-1";
}

/**
 * How long to wait for the whole round trip.
 *
 * The function's own timeout is 15 s and measured latency is 146–275 ms warm,
 * 1.14 s cold (docs/resume-bullets.md). 12 s therefore gives a cold start room
 * while still failing before the owner concludes the composer has hung. This
 * is an explicit action he asked for, not a background refresh, so a couple of
 * seconds of patience is acceptable in a way it would not be on page load.
 */
const REQUEST_TIMEOUT_MS = 12_000;

/** Matches to ask for. Three is what an idea card shows; more is a wall of text. */
const TOP_K = 3;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One match, exactly as `infra/lambda-dedup-infer/index.mjs` returns it. */
export type InferMatch = {
  number: number;
  /** "issue" | "pull_request" from the corpus, or null if the corpus lacks it. */
  type: string | null;
  title: string | null;
  /** Cosine similarity, rounded to 4dp by the Lambda. */
  score: number;
};

export type InferSuccess = {
  available: true;
  matches: InferMatch[];
  /** True when the top match is at or above the threshold. */
  duplicate: boolean;
  threshold: number;
  /** Whether the threshold came from the eval artifact or the built-in constant. */
  thresholdSource: "metrics" | "builtin";
  /**
   * True when the draft is shorter than the shortest text the threshold was
   * calibrated on, so `duplicate: false` means "not comparable", NOT "checked
   * and clean". See the block comment on `OUT-OF-DOMAIN DRAFTS` below. The
   * matches and their scores are still meaningful as a RANKING — it is only
   * the yes/no verdict that has no evidence behind it.
   */
  outOfDomain: boolean;
  /** Characters of draft text actually embedded. */
  queryChars: number;
  /** Shortest text the threshold was fitted on, from the metrics artifact. */
  minCalibratedChars: number;
  model: string;
  indexedDocuments: number;
  indexBuiltAt: string;
  /** Round-trip time as measured by the Lambda, for the "what did this cost" line. */
  lambdaMs: number;
};

export type InferUnavailable = {
  available: false;
  /** Plain-language reason, safe to show the owner. Never a stack trace. */
  reason: string;
};

export type InferResult = InferSuccess | InferUnavailable;

/** The raw response body the Lambda sends. Parsed defensively. */
type LambdaResponse = {
  matches?: unknown;
  duplicate?: unknown;
  threshold?: unknown;
  model?: unknown;
  indexed_documents?: unknown;
  index_built_at?: unknown;
  timing_ms?: { total?: unknown };
  error?: unknown;
};

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function parseMatches(raw: unknown): InferMatch[] {
  if (!Array.isArray(raw)) return [];
  const out: InferMatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const number = Number(m.number);
    const score = Number(m.score);
    // A match with no issue number cannot be linked to, and one with no score
    // cannot be compared to a threshold. Either way it is not a usable match.
    if (!Number.isInteger(number) || !Number.isFinite(score)) continue;
    out.push({
      number,
      type: typeof m.type === "string" ? m.type : null,
      title: typeof m.title === "string" ? m.title : null,
      score,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The call                                                            */
/* ------------------------------------------------------------------ */

/**
 * Score one draft against the backlog via the deployed Lambda.
 *
 * The threshold is READ from `metrics/dedup-eval.json` (through
 * `queue-duplicates.ts`, through the artifact store) and sent in the request,
 * rather than left to the Lambda's own hard-coded `DEDUP_THRESHOLD=0.842`.
 * That is deliberate: re-running `scripts/ml/evaluate.mjs` should move the
 * product's operating point without a Lambda redeploy, and it keeps this
 * screen's number provably the same one the Ideas screen uses. The Lambda's
 * env default remains the floor for anyone calling it directly.
 *
 * Never throws.
 */
export async function inferDraftDuplicates(input: {
  title: string;
  body: string;
}): Promise<InferResult> {
  const url = dedupInferenceUrl();
  if (!url) {
    return {
      available: false,
      reason:
        "Duplicate checking isn't configured on this deployment " +
        "(DEDUP_INFER_FUNCTION_URL is unset).",
    };
  }

  const text = [input.title, input.body].filter(Boolean).join("\n\n").trim();
  if (!text) return { available: false, reason: "Nothing to check yet." };

  // Read the operating point first: if the metrics artifact is unreadable this
  // still resolves, to the documented built-in constant.
  const { threshold, thresholdSource, minCalibratedChars } = await dedupThreshold("titan");

  // `text` is what the Lambda embeds (it joins title and body exactly the same
  // way), so it is the right thing to measure — not the title alone and not the
  // two fields added up before trimming.
  const queryChars = text.length;
  const outOfDomain = queryChars < minCalibratedChars;

  let credentials;
  try {
    credentials = await resolveAwsCredentials();
  } catch (err) {
    console.warn(
      `[dedup-infer] no AWS credentials: ${(err as { message?: string })?.message ?? err}`,
    );
    return {
      available: false,
      reason:
        "The duplicate check needs AWS credentials and none are available " +
        "(the session may have expired).",
    };
  }

  const requestBody = JSON.stringify({
    title: input.title,
    body: input.body,
    topK: TOP_K,
    threshold,
  });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { available: false, reason: "DEDUP_INFER_FUNCTION_URL is not a valid URL." };
  }
  // `host` (not `hostname`) so a non-default port is part of the signature, as
  // SigV4 requires. A real Function URL has neither, but honouring what was
  // configured is what makes this testable against a local stand-in.
  const host = target.host;

  // Function URLs live at the root path, so there are no path segments to
  // encode and no query string — the two parts of SigV4 most likely to be got
  // wrong simply do not arise here.
  const signed = signRequest({
    method: "POST",
    host,
    pathSegments: [],
    body: requestBody,
    service: "lambda",
    region: dedupInferenceRegion(url),
    credentials,
    date: new Date(),
    extraHeaders: { "content-type": "application/json" },
  });

  // The configured origin, not a reconstructed `https://` one: the scheme and
  // port come from DEDUP_INFER_FUNCTION_URL so the caller controls exactly
  // where this goes. The signature is over the same host either way.
  let res: Response;
  try {
    res = await fetch(`${target.origin}/`, {
      method: "POST",
      headers: signed.headers,
      body: requestBody,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    console.warn(`[dedup-infer] request failed: ${name} ${(err as Error)?.message ?? err}`);
    return {
      available: false,
      reason:
        name === "TimeoutError" || name === "AbortError"
          ? "The duplicate check timed out."
          : "Couldn't reach the duplicate-check service.",
    };
  }

  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    // 403 here almost always means the caller's IAM identity lacks
    // lambda:InvokeFunctionUrl on the function — worth distinguishing, because
    // it is a permissions fix rather than a retry.
    console.warn(`[dedup-infer] ${res.status} from the Function URL: ${raw.slice(0, 300)}`);
    return {
      available: false,
      reason:
        res.status === 403
          ? "The duplicate-check service refused the request — this identity isn't " +
            "allowed to invoke it (lambda:InvokeFunctionUrl)."
          : `The duplicate-check service returned ${res.status}.`,
    };
  }

  let parsed: LambdaResponse;
  try {
    parsed = JSON.parse(raw) as LambdaResponse;
  } catch {
    console.warn(`[dedup-infer] unparseable response: ${raw.slice(0, 300)}`);
    return { available: false, reason: "The duplicate-check service sent an unreadable reply." };
  }

  if (typeof parsed.error === "string") {
    console.warn(`[dedup-infer] handler error: ${parsed.error}`);
    return { available: false, reason: "The duplicate check couldn't run just now." };
  }

  const matches = parseMatches(parsed.matches);
  const usedThreshold = Number.isFinite(Number(parsed.threshold))
    ? Number(parsed.threshold)
    : threshold;

  return {
    available: true,
    matches,
    // Recomputed rather than trusted: the response's own `duplicate` flag and
    // its `matches` must agree, and the flag is the derived one of the two.
    //
    // Deliberately NOT relaxed when `outOfDomain`. A short draft that clears
    // 0.842 anyway is a very strong signal and should still be flagged; the
    // problem being reported is the false NEGATIVE, and suppressing true
    // positives would not fix it.
    duplicate: matches.length > 0 && matches[0]!.score >= usedThreshold,
    outOfDomain,
    queryChars,
    minCalibratedChars,
    threshold: usedThreshold,
    // If the Lambda ignored our threshold, the number on screen is no longer
    // the one the metrics artifact supplied, and saying so keeps the label
    // honest.
    thresholdSource: usedThreshold === threshold ? thresholdSource : "builtin",
    model: typeof parsed.model === "string" ? parsed.model : "amazon.titan-embed-text-v2:0",
    indexedDocuments: Number(parsed.indexed_documents) || 0,
    indexBuiltAt: typeof parsed.index_built_at === "string" ? parsed.index_built_at : "",
    lambdaMs: Number(parsed.timing_ms?.total) || 0,
  };
}
