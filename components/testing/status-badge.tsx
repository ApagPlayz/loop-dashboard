import { Loader2, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { statusMeta, type StatusTone } from "./format";

const TONE: Record<StatusTone, string> = {
  running: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  success: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  failure: "bg-red-500/10 text-red-300 border-red-500/30",
  neutral: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

function Icon({ tone }: { tone: StatusTone }) {
  const cls = "h-3.5 w-3.5";
  if (tone === "running") return <Loader2 className={`${cls} animate-spin`} />;
  if (tone === "success") return <CheckCircle2 className={cls} />;
  if (tone === "failure") return <XCircle className={cls} />;
  return <MinusCircle className={cls} />;
}

export default function StatusBadge({
  status,
  conclusion,
  labelOverride,
}: {
  status: string | null | undefined;
  conclusion: string | null | undefined;
  labelOverride?: string;
}) {
  const { tone, label } = statusMeta(status, conclusion);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      <Icon tone={tone} />
      {labelOverride ?? label}
    </span>
  );
}
