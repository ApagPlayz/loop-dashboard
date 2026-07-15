"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";

/** Rendered GitHub markdown inside the shared dashboard prose styles. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-dashboard">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

/** Compact spinner used inside buttons and loading states. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

/** Human "3 days ago" style relative time. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Full-width tab bar with counts. Scrolls horizontally on narrow phones. */
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; count: number }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900 p-1">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
              on
                ? "bg-emerald-500/15 text-emerald-300"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            }`}
          >
            <span>{t.label}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                on ? "bg-emerald-500/20 text-emerald-200" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Small avatar + name row for comment authors. */
export function AuthorBadge({
  login,
  avatar,
  isBot,
}: {
  login: string;
  avatar?: string;
  isBot?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar}
          alt=""
          className="h-5 w-5 rounded-full border border-zinc-700"
        />
      ) : null}
      <span className="text-sm font-medium text-zinc-300">{login}</span>
      {isBot && (
        <span className="rounded bg-zinc-800 px-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          bot
        </span>
      )}
    </span>
  );
}

/** Standard readable error panel — never leaves a blank screen. */
export function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-5 text-center">
      <p className="text-sm font-medium text-red-200">Something went wrong</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-red-300/80">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-red-800 px-3 py-1.5 text-sm font-medium text-red-200 hover:bg-red-900/40"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Empty-state block. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center text-sm text-zinc-500">
      {message}
    </div>
  );
}
