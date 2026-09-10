"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Setup checklist                                                     */
/* ------------------------------------------------------------------ */

/**
 * The post-install setup gate. Reused by the add-project wizard and by the
 * map's setup chip.
 *
 * Why this exists in the shape it does: installing the loop is the easy half.
 * The half that actually decides whether anything runs is three conditions
 * that live outside the commit — a filled-in brief, a login token, and the
 * GitHub app. Every one of them fails *silently*:
 *
 *   - A blank brief makes every agent stand down cleanly, forever, logging a
 *     warning into a run nobody opens. The owner's own loop sat dead for two
 *     days exactly this way, and the dashboard had no idea the file existed.
 *   - A missing token lets the workflows trigger and then fail at the first
 *     step, so the map can look completely normal while nothing works.
 *   - A missing app install cannot be detected at all with a fine-grained PAT.
 *
 * So the rule here is: never render a check as passed unless it was actually
 * proven, and give every failing check something the owner can *do* in this
 * panel rather than a sentence telling them to go somewhere else. `unknown`
 * is its own state and must never be painted as healthy.
 */

type BriefStatus = {
  path: string | null;
  exists: boolean;
  filled: boolean;
  unfilledSections: string[];
};

type Checklist = {
  brief: BriefStatus | null;
  secret: boolean | null;
  secretHelp: string;
  app: { status: string; note: string; url: string };
};

type BriefDoc = {
  path: string;
  exists: boolean;
  content: string;
  filled: boolean;
  unfilledSections: string[];
  totalSections: number;
};

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

  // "Armed" is deliberately strict: both of the checks we can actually prove
  // have to be green. The GitHub app is excluded because it is unknowable
  // here, not because it is optional — the copy below says so.
  const briefOk = data?.brief?.filled === true;
  const secretOk = data?.secret === true;
  const armed = briefOk && secretOk;

  return (
    <div className="space-y-2">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {data && <ArmedBanner armed={armed} briefOk={briefOk} secretOk={secretOk} />}

      <BriefCheck project={project} status={data?.brief ?? null} loading={!data} onSaved={check} />

      <SecretCheck
        project={project}
        present={data ? data.secret : undefined}
        help={data?.secretHelp ?? ""}
        onSaved={check}
      />

      <AppCheck app={data?.app} />

      <button
        disabled={checking}
        onClick={check}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
      >
        {checking ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Verify again
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The verdict line                                                    */
/* ------------------------------------------------------------------ */

function ArmedBanner({
  armed,
  briefOk,
  secretOk,
}: {
  armed: boolean;
  briefOk: boolean;
  secretOk: boolean;
}) {
  if (armed) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <strong>This loop can run.</strong> The brief is filled in and the login token is set,
          so the next scheduled agent run will do real work. If the Claude GitHub app isn&apos;t
          on this repo, that first run is what will tell you.
        </span>
      </div>
    );
  }

  // Name the specific blocker rather than a generic "setup incomplete" — the
  // whole failure this panel exists to prevent is a person not knowing which
  // of the two silent conditions is the one stopping them.
  const missing = [!briefOk && "the brief is still blank", !secretOk && "the login token isn't set"]
    .filter(Boolean)
    .join(" and ");

  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>This loop will not do anything yet</strong> — {missing}. The agents will still
        trigger on schedule; they&apos;ll just stand down or fail without telling you. Finish the
        steps below and that stops.
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. The brief                                                        */
/* ------------------------------------------------------------------ */

function BriefCheck({
  project,
  status,
  loading,
  onSaved,
}: {
  project: string;
  status: BriefStatus | null;
  loading: boolean;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<BriefDoc | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function openEditor() {
    setOpen(true);
    setErr(null);
    if (doc) return; // already loaded — don't throw away an in-progress draft
    try {
      const res = await fetch(`/api/map/projects/brief?project=${encodeURIComponent(project)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't read the brief.");
      setDoc(j);
      setDraft(j.content ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read the brief.");
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/map/projects/brief", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, content: draft }),
      });
      const j = await res.json().catch(() => ({}));
      // A 400 here is the deliberate refusal to save a brief that still has
      // placeholder text in it. It is the feature, not an error to paper over.
      if (!res.ok) throw new Error(j.error ?? "Couldn't save the brief.");
      setDoc(j);
      setOpen(false);
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the brief.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
        ) : status?.filled ? (
          <Check className="h-4 w-4 text-emerald-400" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-400" />
        )}
        1. The product brief
      </p>

      {status && !status.filled && (
        <div className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-zinc-400">
          <p>
            {status.exists
              ? "The file is there but still has its placeholder text. Every agent reads this before it does anything, so until it's written they all stand down — quietly, on every scheduled run."
              : "There's no brief in this repo yet. Every agent reads it before doing anything, so without it none of them will propose work."}
          </p>
          {status.unfilledSections.length > 0 && (
            <p className="text-zinc-500">
              Still blank:{" "}
              <span className="text-amber-300">{status.unfilledSections.join(", ")}</span>
            </p>
          )}
        </div>
      )}

      {status?.filled && status.path && (
        <p className="mt-1.5 font-mono text-[10px] text-zinc-500">{status.path}</p>
      )}

      {err && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {err}
        </div>
      )}

      {open ? (
        <div className="mt-2 space-y-2">
          {doc === null ? (
            <p className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the brief…
            </p>
          ) : (
            <>
              <p className="text-[11px] text-zinc-500">
                Replace every{" "}
                <code className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-300">
                  _Not filled in yet._
                </code>{" "}
                with real text. The comments above each section say what belongs there. Saving
                commits it straight to{" "}
                <span className="font-mono text-[10px] text-zinc-400">{doc.path}</span>.
              </p>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck
                className="h-64 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-200 outline-none focus:border-emerald-500/60"
              />
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={save}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {busy ? "Saving…" : "Save the brief"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={openEditor}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          <FileText className="h-3.5 w-3.5" />
          {status?.filled ? "Edit the brief" : "Write the brief"}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. The login token                                                  */
/* ------------------------------------------------------------------ */

function SecretCheck({
  project,
  present,
  help,
  onSaved,
}: {
  project: string;
  /** true = set, false = missing, null = can't tell, undefined = still loading */
  present: boolean | null | undefined;
  help: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inconclusive, setInconclusive] = useState(false);

  async function save(skipVerify: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/map/projects/secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, token, skipVerify }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 502 means we could not reach Anthropic to check the token — that is
        // not the same as a bad token, so offer to store it unverified rather
        // than leaving the owner stuck behind a check that itself is broken.
        setInconclusive(res.status === 502);
        throw new Error(j.error ?? "Couldn't save the token.");
      }
      setToken(""); // never keep it in component state longer than needed
      setOpen(false);
      setInconclusive(false);
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        {present === undefined ? (
          <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
        ) : present === true ? (
          <Check className="h-4 w-4 text-emerald-400" />
        ) : present === false ? (
          <AlertTriangle className="h-4 w-4 text-amber-400" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-zinc-500" />
        )}
        2. The Claude login token (CLAUDE_CODE_OAUTH_TOKEN)
      </p>

      {present !== undefined && present !== true && (
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
          {present === false
            ? "Not set — the workflows will trigger and then fail at the first step. "
            : "The dashboard's token can't check this one, so treat it as unproven. "}
          Get one by running{" "}
          <code className="rounded bg-zinc-800 px-1 text-[11px] text-zinc-300">
            claude setup-token
          </code>{" "}
          on your own machine, then paste it here — the dashboard checks it against Anthropic
          and writes it to this repo for you.
        </p>
      )}

      {err && (
        <div className="mt-2 space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {err}
          </p>
          {inconclusive && (
            <button
              disabled={busy}
              onClick={() => save(true)}
              className="rounded-lg border border-red-400/40 px-2.5 py-1 text-[11px] font-medium text-red-100 hover:bg-red-500/20 disabled:opacity-50"
            >
              Save it anyway, without checking
            </button>
          )}
        </div>
      )}

      {open ? (
        <div className="mt-2 space-y-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste the token from `claude setup-token`"
            // "new-password", not "off": Chrome ignores autoComplete="off" on
            // a password input and helpfully fills the saved login password
            // for this origin — which here is the DASHBOARD password, sitting
            // in the box about to be written to a repo as the Claude token.
            // The live check would reject it, but a field that pre-fills
            // itself with the wrong secret shouldn't exist in the first place.
            autoComplete="new-password"
            name="claude-oauth-token"
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-emerald-500/60"
          />
          <p className="text-[11px] text-zinc-500">
            Paste the whole thing. A token that gets cut short is accepted by GitHub without
            complaint and then fails every run with a confusing auth error — so the dashboard
            makes a real call to Anthropic with it before saving.
          </p>
          <div className="flex gap-2">
            <button
              disabled={busy || token.trim().length === 0}
              onClick={() => save(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              {busy ? "Checking and saving…" : "Check it and save it"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setToken("");
                setOpen(false);
                setErr(null);
              }}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-zinc-600">{help}</p>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          <KeyRound className="h-3.5 w-3.5" />
          {present === true ? "Replace the token" : "Paste the token"}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. The GitHub app                                                   */
/* ------------------------------------------------------------------ */

function AppCheck({ app }: { app?: { status: string; note: string; url: string } }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <AlertTriangle className="h-4 w-4 text-zinc-500" />
        3. The Claude GitHub app
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
        {app?.note ?? "Make sure the Claude GitHub app covers this repo."}{" "}
        <a
          className="inline-flex items-center gap-0.5 text-emerald-400 underline"
          href={app?.url ?? "https://github.com/apps/claude"}
          target="_blank"
          rel="noreferrer"
        >
          Open the app page <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </div>
  );
}
