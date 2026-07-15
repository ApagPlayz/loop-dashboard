"use client";

/**
 * Minimal +/- line diff, self-contained (no library).
 * - computeLineDiff: LCS-based line diff between two strings.
 * - InlineDiff: renders that diff (used for AI draft previews).
 * - PatchView: renders a unified patch string from the GitHub commits API.
 */

export type DiffLine = { type: "same" | "add" | "del"; text: string };

const MAX_LINES = 3000;

/** LCS line diff. Falls back to whole-block replace on huge inputs. */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }

  // Trim common prefix/suffix first — keeps the LCS table small for the
  // typical "one paragraph changed" case.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  // LCS lengths table (small after trimming).
  const n = midA.length;
  const m = midB.length;
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ type: "same", text: a[k] });
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      out.push({ type: "same", text: midA[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: midA[i] });
      i++;
    } else {
      out.push({ type: "add", text: midB[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: midA[i++] });
  while (j < m) out.push({ type: "add", text: midB[j++] });
  for (let k = endA; k < a.length; k++) out.push({ type: "same", text: a[k] });
  return out;
}

/**
 * Collapse long runs of unchanged lines so the changes stand out.
 * Keeps `context` lines around each change.
 */
function collapse(lines: DiffLine[], context = 3): (DiffLine | { type: "skip"; count: number })[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.type !== "same") {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
        keep[k] = true;
      }
    }
  });
  const out: (DiffLine | { type: "skip"; count: number })[] = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipped > 0) {
        out.push({ type: "skip", count: skipped });
        skipped = 0;
      }
      out.push(l);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) out.push({ type: "skip", count: skipped });
  return out;
}

function lineClass(type: string): string {
  switch (type) {
    case "add":
      return "bg-emerald-500/10 text-emerald-300";
    case "del":
      return "bg-red-500/10 text-red-300";
    default:
      return "text-zinc-400";
  }
}

function marker(type: string): string {
  return type === "add" ? "+" : type === "del" ? "-" : " ";
}

/** Diff between two full texts (AI draft previews, restore previews). */
export function InlineDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = collapse(computeLineDiff(oldText, newText));
  const changed = rows.some((r) => r.type === "add" || r.type === "del");
  if (!changed) {
    return <p className="text-xs text-zinc-500">No differences.</p>;
  }
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950">
      <pre className="min-w-full p-2 font-mono text-[11px] leading-relaxed">
        {rows.map((r, idx) =>
          r.type === "skip" ? (
            <div key={idx} className="select-none px-1 text-zinc-600">
              ⋯ {r.count} unchanged line{r.count === 1 ? "" : "s"}
            </div>
          ) : (
            <div key={idx} className={`whitespace-pre px-1 ${lineClass(r.type)}`}>
              {marker(r.type)} {r.text}
            </div>
          ),
        )}
      </pre>
    </div>
  );
}

/** Render a unified `patch` string from the GitHub commits API. */
export function PatchView({ patch }: { patch: string | null }) {
  if (!patch) {
    return (
      <p className="text-xs text-zinc-500">
        The change is too large to preview here — use the GitHub link.
      </p>
    );
  }
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950">
      <pre className="min-w-full p-2 font-mono text-[11px] leading-relaxed">
        {patch.split("\n").map((line, idx) => {
          const type = line.startsWith("+")
            ? "add"
            : line.startsWith("-")
              ? "del"
              : line.startsWith("@@")
                ? "hunk"
                : "same";
          return (
            <div
              key={idx}
              className={`whitespace-pre px-1 ${
                type === "hunk" ? "text-sky-400" : lineClass(type)
              }`}
            >
              {line}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
