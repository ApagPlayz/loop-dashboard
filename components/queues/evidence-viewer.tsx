"use client";

import { useEffect, useState } from "react";
import {
  Camera,
  X,
  FileText,
  Video,
  AudioLines,
  Paperclip,
  RefreshCw,
} from "lucide-react";
import type { DemoEvidence, EvidenceItem } from "@/lib/queues";
import { Markdown, Spinner } from "./ui";

/** Star feature: the demo-evidence viewer for a PR. */
export default function EvidenceViewer({
  pr,
  project,
  demo,
  onRerun,
}: {
  pr: number;
  project: string;
  demo: DemoEvidence;
  onRerun: () => Promise<void>;
}) {
  const [lightbox, setLightbox] = useState<EvidenceItem | null>(null);
  const [rerunning, setRerunning] = useState(false);

  async function rerun() {
    setRerunning(true);
    try {
      await onRerun();
    } finally {
      setRerunning(false);
    }
  }

  if (demo.status === "none") {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-5 text-center">
        <Camera className="mx-auto mb-2 h-6 w-6 text-zinc-600" />
        <p className="text-sm text-zinc-400">
          No demo evidence yet — run the Demo agent from Testing or wait for it to
          finish.
        </p>
        <RerunButton onClick={rerun} busy={rerunning} label="Run demo" />
      </div>
    );
  }

  if (demo.status === "comment-only") {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <p className="mb-2 text-sm text-amber-300">
          The evidence files have expired (artifacts are kept for 30 days), but
          here is what the Demo agent reported:
        </p>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <Markdown>{demo.commentBody}</Markdown>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <a
            href={demo.commentUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-zinc-500 hover:text-emerald-400"
          >
            View on GitHub
          </a>
          <RerunButton onClick={rerun} busy={rerunning} label="Re-run demo" />
        </div>
      </div>
    );
  }

  // status === "available"
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          {demo.items.length} item{demo.items.length === 1 ? "" : "s"}
          {demo.capturedAt ? ` · captured ${fmtDate(demo.capturedAt)}` : ""}
        </p>
        <RerunButton onClick={rerun} busy={rerunning} label="Re-run demo" small />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {demo.items.map((item, i) => (
          <EvidenceCard
            key={`${item.file}-${i}`}
            pr={pr}
            project={project}
            item={item}
            onOpenImage={() => setLightbox(item)}
          />
        ))}
      </div>

      {lightbox && (
        <Lightbox
          pr={pr}
          project={project}
          item={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function evidenceUrl(pr: number, file: string, project: string) {
  const encoded = file
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  return `/api/builds/evidence/${pr}/${encoded}?project=${encodeURIComponent(
    project,
  )}`;
}

function EvidenceCard({
  pr,
  project,
  item,
  onOpenImage,
}: {
  pr: number;
  project: string;
  item: EvidenceItem;
  onOpenImage: () => void;
}) {
  const url = evidenceUrl(pr, item.file, project);
  return (
    <figure className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="bg-zinc-950">
        {item.type === "screenshot" && (
          <button onClick={onOpenImage} className="block w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={item.caption}
              loading="lazy"
              className="max-h-72 w-full cursor-zoom-in object-contain"
            />
          </button>
        )}
        {item.type === "video" && (
          <video src={url} controls className="max-h-72 w-full bg-black" />
        )}
        {item.type === "audio" && (
          <div className="p-4">
            <audio src={url} controls className="w-full" />
          </div>
        )}
        {(item.type === "log" || item.type === "other") && (
          <LogPreview url={url} type={item.type} />
        )}
      </div>
      <figcaption className="flex items-start gap-2 border-t border-zinc-800 p-3 text-sm text-zinc-300">
        <TypeIcon type={item.type} />
        <span className="leading-snug">{item.caption}</span>
      </figcaption>
    </figure>
  );
}

function LogPreview({ url, type }: { url: string; type: string }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.text();
      })
      .then((t) => alive && setText(t))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [url]);

  if (type !== "log") {
    return (
      <div className="p-4">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:underline"
        >
          <Paperclip className="h-4 w-4" /> Open attachment
        </a>
      </div>
    );
  }
  if (err) {
    return <p className="p-4 text-sm text-red-300">Could not load this log.</p>;
  }
  if (text === null) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
        <Spinner /> Loading log…
      </div>
    );
  }
  return (
    <pre className="max-h-72 overflow-auto p-3 text-xs leading-relaxed text-zinc-300">
      {text}
    </pre>
  );
}

function Lightbox({
  pr,
  project,
  item,
  onClose,
}: {
  pr: number;
  project: string;
  item: EvidenceItem;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4"
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-zinc-800/80 p-2 text-zinc-200 hover:bg-zinc-700"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={evidenceUrl(pr, item.file, project)}
        alt={item.caption}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-full rounded-lg object-contain"
      />
      <p className="mt-3 max-w-2xl text-center text-sm text-zinc-300">
        {item.caption}
      </p>
    </div>
  );
}

export function RerunButton({
  onClick,
  busy,
  label,
  small,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-700 font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50 ${
        small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
      } ${small ? "mt-0" : ""}`}
    >
      {busy ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function TypeIcon({ type }: { type: EvidenceItem["type"] }) {
  const cls = "mt-0.5 h-4 w-4 shrink-0 text-zinc-500";
  if (type === "screenshot") return <Camera className={cls} />;
  if (type === "video") return <Video className={cls} />;
  if (type === "audio") return <AudioLines className={cls} />;
  if (type === "log") return <FileText className={cls} />;
  return <Paperclip className={cls} />;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
