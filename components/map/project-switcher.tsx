"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Plus,
  FolderGit2,
  FolderOpen,
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

type LocalFolder = {
  name: string;
  path: string;
  suggestedRepo: string;
  isGitRepo: boolean;
  hasRemote: boolean;
  remoteSlug: string | null;
  fileCount: number;
  packageName: string | null;
  stack: string[];
  onDashboard: boolean;
  selectable: boolean;
};

type Step = { key: string; label: string; status: "ok" | "skipped" | "error"; detail?: string };

type InstallResult = {
  project: Project;
  commitUrl?: string;
  installed: string[];
  skipped: string[];
  labels: Record<string, string>;
  steps?: Step[];
};

type Source = "github" | "local";

function AddProjectWizard({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (key: string) => void;
}) {
  const [source, setSource] = useState<Source>("github");

  // GitHub-repo flow
  const [repos, setRepos] = useState<CandidateRepo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<CandidateRepo | null>(null);

  // Local-folder flow
  const [folders, setFolders] = useState<LocalFolder[] | null>(null);
  const [localUnavailable, setLocalUnavailable] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pickedFolder, setPickedFolder] = useState<LocalFolder | null>(null);

  // Shared install state
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

  // Load the local folders the first time the owner switches to that tab.
  useEffect(() => {
    if (source !== "local" || folders !== null || localUnavailable) return;
    (async () => {
      try {
        setLocalError(null);
        const res = await fetch("/api/projects/local-scan");
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? "Couldn't read your local folders.");
        if (j.localUnavailable) {
          setLocalUnavailable(true);
          setFolders([]);
        } else {
          setFolders(j.folders ?? []);
        }
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : "Couldn't read your local folders.");
      }
    })();
  }, [source, folders, localUnavailable]);

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

  async function initFolder() {
    if (!pickedFolder) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const res = await fetch("/api/projects/local-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: pickedFolder.name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't set the folder up.");
      setResult(j);
      onAdded(j.project.key);
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : "Couldn't set the folder up.");
    } finally {
      setInstalling(false);
    }
  }

  const filtered = (repos ?? []).filter((r) =>
    r.fullName.toLowerCase().includes(query.toLowerCase()),
  );

  const title = result
    ? "Project added"
    : picked || pickedFolder
      ? source === "local"
        ? "Set up this folder"
        : "Install the loop"
      : "Add a project";

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl border-t border-zinc-800 bg-zinc-950 shadow-2xl md:inset-x-auto md:left-1/2 md:top-16 md:max-h-[80vh] md:w-[520px] md:-translate-x-1/2 md:rounded-2xl md:border">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
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
              {result.steps && result.steps.length > 0 && <StepList steps={result.steps} />}
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
            /* Step 2a: confirm install into an existing GitHub repo */
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
          ) : pickedFolder ? (
            /* Step 2b: confirm setting up a local folder */
            <>
              <p className="text-sm leading-relaxed text-zinc-300">
                Here&apos;s what will happen to your folder{" "}
                <strong className="text-zinc-100">{pickedFolder.name}</strong>:
              </p>
              <ul className="space-y-1.5 text-sm text-zinc-300">
                {pickedFolder.hasRemote ? (
                  <li className="flex items-start gap-2">
                    <FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    It&apos;s already linked to{" "}
                    <strong className="text-zinc-100">{pickedFolder.remoteSlug}</strong> on GitHub —
                    the dashboard will use that repo (nothing new is created).
                  </li>
                ) : (
                  <li className="flex items-start gap-2">
                    <FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    A brand-new <strong className="text-zinc-100">private</strong> GitHub repo called{" "}
                    <strong className="text-zinc-100">{pickedFolder.suggestedRepo}</strong> is created,
                    and your folder&apos;s files are committed and pushed to it (a sensible
                    <code className="mx-1 rounded bg-zinc-800 px-1 text-[11px]">.gitignore</code>
                    is added if one is missing). No files are ever deleted or force-pushed.
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  Then the standard loop is installed on top: the 10 agent workflows, their config,
                  a fresh learnings file, and the three idea labels — one change on GitHub.
                </li>
              </ul>
              {installError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {installError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  disabled={installing}
                  onClick={initFolder}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {installing ? "Setting up…" : "Yes, set it up"}
                </button>
                <button
                  disabled={installing}
                  onClick={() => setPickedFolder(null)}
                  className="rounded-lg border border-zinc-700 px-3.5 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  Back
                </button>
              </div>
            </>
          ) : (
            /* Step 1: choose a source, then pick */
            <>
              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-zinc-900 p-1">
                <button
                  onClick={() => setSource("github")}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                    source === "github"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <FolderGit2 className="h-3.5 w-3.5" /> A GitHub repo
                </button>
                <button
                  onClick={() => setSource("local")}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                    source === "local"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> A local folder
                </button>
              </div>

              {source === "github" ? (
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
              ) : (
                <LocalFolderPicker
                  folders={folders}
                  unavailable={localUnavailable}
                  error={localError}
                  onPick={setPickedFolder}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Local-folder picker                                                 */
/* ------------------------------------------------------------------ */

function LocalFolderPicker({
  folders,
  unavailable,
  error,
  onPick,
}: {
  folders: LocalFolder[] | null;
  unavailable: boolean;
  error: string | null;
  onPick: (f: LocalFolder) => void;
}) {
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
      </div>
    );
  }
  if (unavailable) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm leading-relaxed text-zinc-400">
        This option only works when the dashboard is running on your own Mac (where your project
        folders live). It looks like it&apos;s running somewhere else right now — use the{" "}
        <strong className="text-zinc-300">A GitHub repo</strong> tab instead.
      </div>
    );
  }
  if (folders === null) {
    return (
      <p className="flex items-center gap-2 py-4 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Looking through your project folders…
      </p>
    );
  }
  if (folders.length === 0) {
    return <p className="py-4 text-sm text-zinc-500">No project folders found to add.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {folders.map((f) => {
        const meta = [
          `~${f.fileCount}${f.fileCount >= 3000 ? "+" : ""} files`,
          ...f.stack.slice(0, 2),
        ];
        return (
          <li key={f.name}>
            <button
              disabled={!f.selectable}
              onClick={() => f.selectable && onPick(f)}
              className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                f.selectable
                  ? "border-zinc-800 bg-zinc-900 hover:border-emerald-500/40 hover:bg-zinc-800/70"
                  : "cursor-not-allowed border-zinc-800/60 bg-zinc-900/40"
              }`}
            >
              <span className="flex items-center gap-2">
                <FolderOpen
                  className={`h-3.5 w-3.5 shrink-0 ${f.selectable ? "text-emerald-400" : "text-zinc-600"}`}
                />
                <span className={`truncate text-sm font-medium ${f.selectable ? "text-zinc-200" : "text-zinc-500"}`}>
                  {f.name}
                </span>
                {f.onDashboard ? (
                  <span className="ml-auto shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                    already added
                  </span>
                ) : f.hasRemote ? (
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-zinc-500">
                    <FolderGit2 className="h-3 w-3" /> on GitHub
                  </span>
                ) : (
                  <span className="ml-auto shrink-0 text-[10px] text-zinc-500">new repo</span>
                )}
              </span>
              <span className="mt-0.5 block truncate pl-5 text-[11px] text-zinc-500">
                {meta.join(" · ")}
                {f.remoteSlug ? ` · ${f.remoteSlug}` : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Per-step progress list (local-folder setup)                         */
/* ------------------------------------------------------------------ */

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ul className="space-y-1">
      {steps.map((s) => (
        <li key={s.key} className="flex items-start gap-2 text-xs text-zinc-400">
          {s.status === "error" ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
          ) : (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
          )}
          <span>
            <strong className="text-zinc-300">{s.label}</strong>
            {s.detail ? ` — ${s.detail}` : ""}
          </span>
        </li>
      ))}
    </ul>
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
