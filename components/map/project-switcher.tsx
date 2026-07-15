"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Plus,
  FolderGit2,
  Search,
  Loader2,
  X,
  Check,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import type { Project } from "@/lib/projects";

/* ------------------------------------------------------------------ */
/* Switcher                                                            */
/* ------------------------------------------------------------------ */

export default function ProjectSwitcher({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (key: string) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/map/projects");
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.projects)) setProjects(j.projects);
    } catch {
      /* keep whatever we have */
    }
  }, []);

  useEffect(() => {
    // Load the registry (an external system) once on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const current = projects.find((p) => p.key === selected);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
      >
        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <span className="truncate">{current?.label ?? selected}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-zinc-800 bg-zinc-950 p-1.5 shadow-2xl">
            {projects.map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  setOpen(false);
                  onSelect(p.key);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                  p.key === selected
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.label}</span>
                  <span className="block truncate font-mono text-[10px] text-zinc-500">
                    {p.owner}/{p.repo}
                  </span>
                </span>
                {p.key === selected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
            <div className="my-1 border-t border-zinc-800" />
            <button
              onClick={() => {
                setOpen(false);
                setWizardOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-300 transition hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5 text-emerald-400" /> Add a project
            </button>
          </div>
        </>
      )}

      {wizardOpen && (
        <AddProjectWizard
          onClose={() => setWizardOpen(false)}
          onAdded={(key) => {
            load();
            onSelect(key);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add-a-project wizard                                                */
/* ------------------------------------------------------------------ */

type CandidateRepo = {
  owner: string;
  repo: string;
  fullName: string;
  description: string;
  private: boolean;
  defaultBranch: string;
};

type InstallResult = {
  project: Project;
  commitUrl?: string;
  installed: string[];
  skipped: string[];
  labels: Record<string, string>;
};

function AddProjectWizard({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (key: string) => void;
}) {
  const [repos, setRepos] = useState<CandidateRepo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<CandidateRepo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoadError(null);
        const res = await fetch("/api/map/projects/repos");
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? "Couldn't list your repositories.");
        setRepos(j.repos ?? []);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Couldn't list your repositories.");
      }
    })();
  }, []);

  async function install() {
    if (!picked) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const res = await fetch("/api/map/projects/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: picked.owner, repo: picked.repo }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't set the project up.");
      setResult(j);
      onAdded(j.project.key);
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : "Couldn't set the project up.");
    } finally {
      setInstalling(false);
    }
  }

  const filtered = (repos ?? []).filter((r) =>
    r.fullName.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl border-t border-zinc-800 bg-zinc-950 shadow-2xl md:inset-x-auto md:left-1/2 md:top-16 md:max-h-[80vh] md:w-[520px] md:-translate-x-1/2 md:rounded-2xl md:border">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">
            {result ? "Project added" : picked ? "Install the loop" : "Add a project"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {/* Step 3: done + checklist */}
          {result ? (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  The loop was installed into <strong>{result.project.owner}/{result.project.repo}</strong> in
                  one change{" "}
                  {result.commitUrl && (
                    <a className="underline" href={result.commitUrl} target="_blank" rel="noreferrer">
                      (view it)
                    </a>
                  )}
                  . {result.installed.length} file{result.installed.length === 1 ? "" : "s"} added
                  {result.skipped.length > 0 &&
                    `, ${result.skipped.length} already existed and were left alone (${result.skipped.join(", ")})`}
                  . Labels:{" "}
                  {Object.entries(result.labels)
                    .map(([n, s]) => `${n} ${s}`)
                    .join(", ")}
                  .
                </span>
              </div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Two things only you can do
              </p>
              <ProjectChecklist project={result.project.key} />
              <button
                onClick={onClose}
                className="rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
              >
                Done — show me the map
              </button>
            </>
          ) : picked ? (
            /* Step 2: confirm install */
            <>
              <p className="text-sm leading-relaxed text-zinc-300">
                This installs the standard loop into{" "}
                <strong className="text-zinc-100">{picked.fullName}</strong>: the 10 agent
                workflows, their config files, a fresh empty learnings file, and the three idea
                labels. Everything lands as one change you can view (and undo) on GitHub. Files
                the repo already has are left untouched.
              </p>
              {installError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {installError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  disabled={installing}
                  onClick={install}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {installing ? "Installing…" : "Install the loop"}
                </button>
                <button
                  disabled={installing}
                  onClick={() => setPicked(null)}
                  className="rounded-lg border border-zinc-700 px-3.5 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Back
                </button>
              </div>
            </>
          ) : (
            /* Step 1: pick a repo */
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your repositories…"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-emerald-500/50"
                />
              </div>
              {loadError ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {loadError}
                </div>
              ) : repos === null ? (
                <p className="flex items-center gap-2 py-4 text-sm text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your repositories…
                </p>
              ) : filtered.length === 0 ? (
                <p className="py-4 text-sm text-zinc-500">
                  No repositories found. The dashboard&apos;s GitHub token only sees repos it was
                  given access to — grant it access to the new repo first.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {filtered.map((r) => (
                    <li key={r.fullName}>
                      <button
                        onClick={() => setPicked(r)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-left transition hover:border-emerald-500/40 hover:bg-zinc-800/70"
                      >
                        <span className="block truncate text-sm font-medium text-zinc-200">
                          {r.fullName}
                          {r.private && <span className="ml-1.5 text-[10px] text-zinc-500">private</span>}
                        </span>
                        {r.description && (
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">
                            {r.description}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Setup checklist                                                     */
/* ------------------------------------------------------------------ */

type Checklist = {
  secret: boolean | null;
  secretHelp: string;
  app: { status: string; note: string; url: string };
};

/** The post-install setup checks. Reused by the wizard and the map chip. */
export function ProjectChecklist({ project }: { project: string }) {
  const [data, setData] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/map/projects/checklist?project=${encodeURIComponent(project)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't run the checks.");
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run the checks.");
    } finally {
      setChecking(false);
    }
  }, [project]);

  useEffect(() => {
    // Run the setup checks against GitHub when shown.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    check();
  }, [check]);

  return (
    <div className="space-y-2">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* 1. Secret */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          {data === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
          ) : data.secret === true ? (
            <Check className="h-4 w-4 text-emerald-400" />
          ) : data.secret === false ? (
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-zinc-500" />
          )}
          1. The Claude login token (CLAUDE_CODE_OAUTH_TOKEN)
        </p>
        {data && data.secret !== true && (
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
            {data.secret === false
              ? "Not set yet — the agents can't run without it. "
              : "The dashboard's token can't check this one — if you've already added it, you're fine. "}
            {data.secretHelp}
          </p>
        )}
      </div>

      {/* 2. GitHub App */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <AlertTriangle className="h-4 w-4 text-zinc-500" />
          2. The Claude GitHub app
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          {data?.app.note ?? "Make sure the Claude GitHub app covers this repo."}{" "}
          <a
            className="inline-flex items-center gap-0.5 text-emerald-400 underline"
            href={data?.app.url ?? "https://github.com/apps/claude"}
            target="_blank"
            rel="noreferrer"
          >
            Open the app page <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>

      <button
        disabled={checking}
        onClick={check}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
      >
        {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Verify again
      </button>
    </div>
  );
}
