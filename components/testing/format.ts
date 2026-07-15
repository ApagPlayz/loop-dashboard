/** Small pure formatting helpers shared across the Testing UI (client-safe). */

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function duration(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string {
  if (!startIso) return "—";
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

export type StatusTone = "running" | "success" | "failure" | "neutral";

/** Map a run/job status+conclusion to a tone + label. */
export function statusMeta(
  status: string | null | undefined,
  conclusion: string | null | undefined,
): { tone: StatusTone; label: string } {
  if (status === "completed") {
    if (conclusion === "success") return { tone: "success", label: "Passed" };
    if (conclusion === "failure") return { tone: "failure", label: "Failed" };
    if (conclusion === "cancelled") return { tone: "neutral", label: "Cancelled" };
    if (conclusion === "skipped") return { tone: "neutral", label: "Skipped" };
    return { tone: "neutral", label: conclusion ?? "Done" };
  }
  if (status === "in_progress") return { tone: "running", label: "Running" };
  if (status === "queued" || status === "waiting" || status === "pending")
    return { tone: "running", label: "Queued" };
  return { tone: "neutral", label: status ?? "—" };
}
