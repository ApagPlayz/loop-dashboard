import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PageHeader from "@/components/page-header";
import StatCard from "@/components/stat-card";
import { getFileContent } from "@/lib/github";

// Always fetch fresh from GitHub on each request.
export const dynamic = "force-dynamic";

/** One daily snapshot in metrics/loop-metrics.json. */
type Snapshot = {
  date: string;
  prs_opened: number;
  prs_merged: number;
  prs_rejected: number;
  prs_open_now: number;
  merge_rate_pct: number | null;
  median_pr_size_lines: number | null;
  median_days_to_merge: number | null;
  prs_needing_changes: number;
  proposals_filed: number;
  proposals_approved: number;
  proposal_approval_rate_pct: number | null;
};

function fmt(v: number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined) return "—";
  return `${v}${suffix}`;
}

async function loadMetrics(): Promise<{
  snapshots: Snapshot[] | null;
  parseError: boolean;
}> {
  const raw = await getFileContent("metrics/loop-metrics.json");
  if (raw === null) return { snapshots: null, parseError: false };
  try {
    const data = JSON.parse(raw);
    const snapshots = Array.isArray(data)
      ? (data as Snapshot[])
      : Array.isArray((data as { history?: Snapshot[] }).history)
        ? (data as { history: Snapshot[] }).history
        : [];
    return { snapshots, parseError: false };
  } catch {
    return { snapshots: null, parseError: true };
  }
}

export default async function MetricsPage() {
  const [{ snapshots, parseError }, dashboardMd] = await Promise.all([
    loadMetrics(),
    getFileContent("LOOP-DASHBOARD.md"),
  ]);

  const latest =
    snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return (
    <>
      <PageHeader
        title="Metrics"
        description="Live snapshot of the loop, read straight from the repo."
      />

      {/* Stat cards for the latest snapshot */}
      {latest ? (
        <>
          <p className="mb-3 text-xs text-zinc-500">
            Latest snapshot: {latest.date}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard
              label="Merge rate"
              value={fmt(latest.merge_rate_pct, "%")}
            />
            <StatCard label="PRs merged" value={latest.prs_merged} />
            <StatCard label="PRs opened" value={latest.prs_opened} />
            <StatCard label="Open now" value={latest.prs_open_now} />
            <StatCard label="PRs rejected" value={latest.prs_rejected} />
            <StatCard
              label="Needs changes"
              value={latest.prs_needing_changes}
            />
            <StatCard label="Proposals filed" value={latest.proposals_filed} />
            <StatCard
              label="Median PR size"
              value={fmt(latest.median_pr_size_lines)}
              hint="lines"
            />
          </div>
        </>
      ) : (
        <EmptyMetrics parseError={parseError} />
      )}

      {/* History table */}
      {snapshots && snapshots.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">
            Snapshot history
          </h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <Th>Date</Th>
                  <Th>Opened</Th>
                  <Th>Merged</Th>
                  <Th>Rejected</Th>
                  <Th>Open</Th>
                  <Th>Merge %</Th>
                  <Th>Median lines</Th>
                  <Th>Proposals</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {[...snapshots].reverse().map((s) => (
                  <tr key={s.date} className="hover:bg-zinc-900/50">
                    <Td className="font-medium text-zinc-200">{s.date}</Td>
                    <Td>{s.prs_opened}</Td>
                    <Td>{s.prs_merged}</Td>
                    <Td>{s.prs_rejected}</Td>
                    <Td>{s.prs_open_now}</Td>
                    <Td>{fmt(s.merge_rate_pct, "%")}</Td>
                    <Td>{fmt(s.median_pr_size_lines)}</Td>
                    <Td>{s.proposals_filed}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Rendered LOOP-DASHBOARD.md */}
      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">
          Loop dashboard
        </h2>
        {dashboardMd ? (
          <div className="prose-dashboard rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {dashboardMd}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/50 p-5 text-sm text-zinc-500">
            LOOP-DASHBOARD.md not found in the repo yet.
          </p>
        )}
      </section>
    </>
  );
}

function EmptyMetrics({ parseError }: { parseError: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-500">
      {parseError
        ? "metrics/loop-metrics.json exists but could not be parsed as JSON."
        : "metrics/loop-metrics.json not found in the repo yet. It will appear here once the Metrics workflow has run."}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3">{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`whitespace-nowrap px-4 py-3 tabular-nums text-zinc-300 ${className}`}>
      {children}
    </td>
  );
}
