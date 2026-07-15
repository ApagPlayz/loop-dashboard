"use client";

import type { ThreadComment } from "@/lib/queues";
import { Markdown, AuthorBadge, relativeTime, Spinner, EmptyState } from "./ui";

/** Renders a comment thread (issue or PR) with author + relative time. */
export default function CommentThread({
  comments,
  loading,
}: {
  comments: ThreadComment[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-zinc-500">
        <Spinner /> Loading the conversation…
      </div>
    );
  }
  if (comments.length === 0) {
    return <EmptyState message="No comments yet." />;
  }
  return (
    <div className="space-y-3">
      {comments.map((c) => (
        <div
          key={c.id}
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <AuthorBadge login={c.author} avatar={c.authorAvatar} isBot={c.isBot} />
            <a
              href={c.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              {relativeTime(c.createdAt)}
            </a>
          </div>
          <Markdown>{c.body}</Markdown>
        </div>
      ))}
    </div>
  );
}
