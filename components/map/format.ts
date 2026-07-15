/** Small formatting helpers shared by the map nodes and the drawer. */

/** "3m ago", "2h ago", "yesterday", "Mar 4". */
export function relativeTime(iso: string | null): string {
  if (!iso) return "never run";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "1m 42s", "38s". */
export function duration(sec: number | null): string {
  if (sec === null || sec < 0) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export type RunTone = "success" | "failure" | "running" | "idle";

/** Collapse GitHub's status/conclusion pair into a simple tone. */
export function runTone(status: string | null, conclusion: string | null): RunTone {
  if (status === "in_progress" || status === "queued" || status === "waiting" || status === "requested" || status === "pending") {
    return "running";
  }
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure") {
      return "failure";
    }
    return "idle"; // cancelled, skipped, neutral, ...
  }
  return "idle";
}

/** Plain-English label for a run outcome. */
export function toneLabel(tone: RunTone): string {
  switch (tone) {
    case "success":
      return "Passed";
    case "failure":
      return "Failed";
    case "running":
      return "Running";
    default:
      return "—";
  }
}
