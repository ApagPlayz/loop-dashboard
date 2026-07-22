/**
 * Product launchers: Claude analyzes a project's local folder, figures out how
 * to start the product, and writes a double-clickable .command launcher that
 * opens Terminal, starts the product detached, opens it in the browser, and
 * closes its own Terminal window on success (errors keep the window open so
 * the owner can read them).
 *
 * LOCAL-ONLY, like lib/local-folders.ts: everything here reads/writes the
 * owner's Mac. Launcher configs are stored OUTSIDE git (absolute machine paths
 * don't belong in the repo) at ~/.loop-dashboard/launchers.json, and the
 * generated launchers live in ~/Library/Application Support/Loop Dashboard/.
 *
 * Hard rules baked into everything generated here:
 *   - analysis is READ-ONLY (we only read package.json, README, file names);
 *   - launchers never run git and never modify tracked files — they may only
 *     install dependencies (node_modules etc.) and start the product.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { aiStructuredCall, AiError } from "./map-ai";
import { resolveProject, type Project } from "./projects";
import { scanLocalFolders, type LocalFolder } from "./local-folders";

const exec = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Types + store                                                       */
/* ------------------------------------------------------------------ */

export type LauncherKind = "web" | "desktop" | "cli" | "unknown";

export type LauncherConfig = {
  projectKey: string;
  /** Absolute path of the project's local folder. */
  folder: string;
  kind: LauncherKind;
  /** e.g. "npm install" — run only when dependencies look missing. */
  installCmd?: string;
  /** The command that starts the product (run detached from the launcher). */
  startCmd: string;
  port?: number;
  /** Where the product answers once running, e.g. http://localhost:3000 */
  url?: string;
  /** Open `url` in the browser once the product answers. */
  openBrowser: boolean;
  /** Absolute path of the generated .command file. */
  commandPath: string;
  analyzedAt: string;
  /** Claude's plain-English explanation of what the launcher does. */
  notes: string;
};

/** Local, machine-specific store — never committed to git. */
function storeFile(): string {
  return path.join(homedir(), ".loop-dashboard", "launchers.json");
}

/** Where the generated .command files live. */
function launchersDir(): string {
  return path.join(homedir(), "Library", "Application Support", "Loop Dashboard", "launchers");
}

type Store = { launchers: Record<string, LauncherConfig> };

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(storeFile(), "utf-8");
    const parsed = JSON.parse(raw) as Store;
    if (parsed && typeof parsed.launchers === "object" && parsed.launchers !== null) return parsed;
  } catch {
    /* first run / unreadable — start fresh */
  }
  return { launchers: {} };
}

async function writeStore(store: Store): Promise<void> {
  const file = storeFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

/** The saved launcher for a project, or null if none was created yet. */
export async function getLauncher(projectKey: string): Promise<LauncherConfig | null> {
  const store = await readStore();
  return store.launchers[projectKey] ?? null;
}

/* ------------------------------------------------------------------ */
/* Folder resolution + read-only evidence gathering                    */
/* ------------------------------------------------------------------ */

/** Find the local checkout of a registered project by its GitHub remote. */
export async function findLocalFolder(project: Project): Promise<LocalFolder | null> {
  const scan = await scanLocalFolders();
  if (scan.localUnavailable) return null;
  const slug = `${project.owner}/${project.repo}`.toLowerCase();
  return scan.folders.find((f) => f.remoteSlug?.toLowerCase() === slug) ?? null;
}

type Evidence = {
  topLevel: string[];
  packageJson: string | null;
  readmeHead: string | null;
  markers: string[];
};

const MARKER_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "Dockerfile",
  "docker-compose.yml",
  "requirements.txt",
  "pyproject.toml",
  "main.py",
  "app.py",
  "index.html",
  "Cargo.toml",
  "go.mod",
];

/** Read just enough about the folder for Claude to decide how to launch it. */
async function gatherEvidence(dir: string): Promise<Evidence> {
  let topLevel: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    topLevel = entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .slice(0, 60);
  } catch {
    /* unreadable — the AI gets what we have */
  }

  let packageJson: string | null = null;
  const pkgRaw = await fs.readFile(path.join(dir, "package.json"), "utf-8").catch(() => null);
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      packageJson = JSON.stringify(
        {
          name: pkg.name,
          scripts: pkg.scripts,
          dependencies: pkg.dependencies,
          devDependencies: pkg.devDependencies,
          main: pkg.main,
          bin: pkg.bin,
        },
        null,
        2,
      );
    } catch {
      packageJson = pkgRaw.slice(0, 2000);
    }
  }

  let readmeHead: string | null = null;
  for (const name of ["README.md", "readme.md", "README.txt", "README"]) {
    const raw = await fs.readFile(path.join(dir, name), "utf-8").catch(() => null);
    if (raw) {
      readmeHead = raw.split("\n").slice(0, 80).join("\n");
      break;
    }
  }

  const markers: string[] = [];
  for (const marker of MARKER_FILES) {
    try {
      await fs.access(path.join(dir, marker));
      markers.push(marker);
    } catch {
      /* not present */
    }
  }

  return { topLevel, packageJson, readmeHead, markers };
}

/* ------------------------------------------------------------------ */
/* AI analysis                                                         */
/* ------------------------------------------------------------------ */

type Analysis = {
  kind: LauncherKind;
  installCmd: string;
  startCmd: string;
  port: number;
  url: string;
  openBrowser: boolean;
  confidence: "high" | "medium" | "low";
  explanation: string;
};

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["web", "desktop", "cli", "unknown"],
      description: "What kind of product this is once running.",
    },
    installCmd: {
      type: "string",
      description:
        "Command that installs dependencies (e.g. 'npm install'), or empty string if none needed.",
    },
    startCmd: {
      type: "string",
      description:
        "The single shell command that starts the product from the project folder. Prefer a production-style start; a dev server is fine if that's all the project has.",
    },
    port: {
      type: "integer",
      description: "The local port the product listens on once started, or 0 if unknown/none.",
    },
    url: {
      type: "string",
      description:
        "The local URL to open once running (e.g. http://localhost:3000), or empty string if none.",
    },
    openBrowser: {
      type: "boolean",
      description: "True if the owner's browser should open the url once the product answers.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    explanation: {
      type: "string",
      description:
        "One or two plain-English sentences for a non-technical owner: what this product is and how the launcher starts it.",
    },
  },
  required: [
    "kind",
    "installCmd",
    "startCmd",
    "port",
    "url",
    "openBrowser",
    "confidence",
    "explanation",
  ],
  additionalProperties: false,
} as const;

/** Commands a launcher must never contain (it may only install + start). */
const FORBIDDEN_CMD = /(^|[\s;&|])(git|rm\s+-rf|sudo)(\s|$)/;

function assertSafeCommand(cmd: string, what: string): void {
  if (FORBIDDEN_CMD.test(cmd)) {
    throw new AiError(
      `The suggested ${what} command ("${cmd}") tries to do more than start the product, so it was rejected. Try analyzing again.`,
      422,
    );
  }
}

/* ------------------------------------------------------------------ */
/* .command file generation                                            */
/* ------------------------------------------------------------------ */

/** Quote a string for safe embedding inside single quotes in zsh. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render the self-closing launcher script. Modeled on the proven
 * /Applications/Loop Dashboard.command pattern: detached start (nohup+disown),
 * readiness polling, browser open, then close this Terminal window via
 * osascript keyed to the script's own filename. Error paths keep the window
 * open so the owner can read what went wrong.
 */
function renderLauncherScript(cfg: {
  label: string;
  key: string;
  folder: string;
  installCmd?: string;
  startCmd: string;
  url?: string;
  openBrowser: boolean;
  port?: number;
}): string {
  const scriptName = `${cfg.key}.command`;
  const log = `/tmp/loop-launcher-${cfg.key}.log`;
  const nodeInstall = cfg.installCmd && /\b(npm|pnpm|yarn|bun)\b/.test(cfg.installCmd);

  const lines: string[] = [
    "#!/bin/zsh",
    `# ${cfg.label} launcher — created automatically by the Loop Dashboard.`,
    "# Double-click to launch the product. This window closes itself on success;",
    "# if something goes wrong it stays open so you can read the error.",
    "# Safe to delete — the dashboard can recreate it any time.",
    "#",
    "# This launcher only installs dependencies and starts the product. It may",
    "# read git state (fetch + count commits behind) to decide whether a restart",
    "# is worth it, but it never modifies the project's code or commits anything.",
    "",
    `APP_DIR=${shq(cfg.folder)}`,
    `LOG=${shq(log)}`,
    `START_CMD=${shq(cfg.startCmd)}`,
    "",
    "close_window() {",
    `  ( sleep 1; /usr/bin/osascript -e 'tell application "Terminal" to close (every window whose name contains "${scriptName}")' ) </dev/null >/dev/null 2>&1 &`,
    "  disown",
    "}",
    "",
    'cd "$APP_DIR" || { echo "Project folder not found: $APP_DIR"; read -r "?Press Enter to close..."; exit 1; }',
    "",
  ];

  if (cfg.url) {
    lines.push(
      `URL=${shq(cfg.url)}`,
      "",
      "# Already running? Check whether the repo has new commits before deciding",
      "# whether to just reopen it or restart it. Without this, a long-running",
      "# server would never pick up newly-merged changes no matter how many times",
      "# you relaunch — it only ever checked \"is something answering,\" not",
      "# \"is what's running still current.\"",
      'if curl -s -o /dev/null --max-time 2 "$URL"; then',
      "  BEHIND=0",
      "  if [ -d .git ]; then",
      "    git fetch --quiet origin 2>/dev/null && BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)",
      "  fi",
      '  if [ "$BEHIND" = "0" ]; then',
      `    echo ${shq(`${cfg.label} is already running and up to date — opening it.`)}`,
      ...(cfg.openBrowser ? ['    open "$URL"'] : []),
      "    close_window",
      "    exit 0",
      "  fi",
      `  echo ${shq(`${cfg.label} is running, but $BEHIND new commit(s) have landed on GitHub — restarting so they're not stuck out of date.`)}`,
      ...(cfg.port
        ? [
            `  OLD_PID=$(lsof -ti tcp:${cfg.port} 2>/dev/null)`,
            '  [ -n "$OLD_PID" ] && kill $OLD_PID 2>/dev/null',
            `  for i in {1..10}; do lsof -ti tcp:${cfg.port} >/dev/null 2>&1 || break; sleep 0.5; done`,
          ]
        : [
            "  # No known port for this launcher — can't safely stop the old process,",
            "  # so just open what's running rather than risk leaving two copies up.",
            `  echo ${shq(`(Couldn't determine ${cfg.label}'s port to restart it safely — opening the running copy instead. Re-analyze the launcher to fix this.)`)}`,
            ...(cfg.openBrowser ? ['  open "$URL"'] : []),
            "  close_window",
            "  exit 0",
          ]),
      "fi",
      "",
    );
  }

  if (cfg.installCmd) {
    const installFail = `{ echo ""; echo "Installing what ${cfg.label} needs didn't work — ask Claude to take a look."; read -r "?Press Enter to close..."; exit 1; }`;
    if (nodeInstall) {
      lines.push(
        "# First run: install dependencies if they're missing.",
        `[ -d node_modules ] || { echo "Installing what it needs (first time only)..."; ${cfg.installCmd} || ${installFail}; }`,
        "",
      );
    } else {
      lines.push(
        "# Make sure dependencies are in place.",
        `echo "Getting dependencies ready..."`,
        `${cfg.installCmd} || ${installFail}`,
        "",
      );
    }
  }

  lines.push(
    `echo ${shq(`Starting ${cfg.label}...`)}`,
    "# Start fully detached so it keeps running after this window closes.",
    'nohup zsh -c "$START_CMD" </dev/null >"$LOG" 2>&1 &',
    "PRODUCT_PID=$!",
    "disown",
    "",
  );

  if (cfg.url) {
    lines.push(
      "# Wait up to 60s for it to answer.",
      "for i in {1..60}; do",
      '  if curl -s -o /dev/null --max-time 2 "$URL"; then',
      `    echo "Ready — it's up at $URL"`,
      ...(cfg.openBrowser ? ['    open "$URL"'] : []),
      "    close_window",
      "    exit 0",
      "  fi",
      "  sleep 1",
      "done",
      "",
      `echo ""`,
      `echo ${shq(`${cfg.label} didn't come up after 60 seconds. The log below may say why:`)}`,
      'echo "$LOG"',
      "echo \"\"",
      'tail -20 "$LOG"',
      'read -r "?Press Enter to close..."',
      "exit 1",
    );
  } else {
    lines.push(
      "# No known address to check — give it a moment and make sure it's still alive.",
      "sleep 3",
      "if kill -0 $PRODUCT_PID 2>/dev/null; then",
      `  echo ${shq(`${cfg.label} started. Its output is being saved to:`)}`,
      '  echo "$LOG"',
      "  close_window",
      "  exit 0",
      "fi",
      "",
      `echo ""`,
      `echo ${shq(`${cfg.label} stopped right away — something went wrong. The log below may say why:`)}`,
      'echo "$LOG"',
      "echo \"\"",
      'tail -20 "$LOG"',
      'read -r "?Press Enter to close..."',
      "exit 1",
    );
  }

  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------------ */
/* Analyze + create                                                    */
/* ------------------------------------------------------------------ */

/**
 * The whole flow: find the project's local folder, have Claude work out how to
 * launch it, write the self-closing .command launcher, and save the config.
 */
export async function analyzeAndCreateLauncher(projectKey: string): Promise<LauncherConfig> {
  const { project } = await resolveProject(projectKey);

  const folder = await findLocalFolder(project);
  if (!folder) {
    throw new AiError(
      `No local copy of "${project.label}" was found on this Mac (looked for a folder linked to ${project.owner}/${project.repo} in your Claude Projects directory). Launching only works for projects that live on this machine.`,
      404,
    );
  }

  const evidence = await gatherEvidence(folder.path);

  const analysis = await aiStructuredCall<Analysis>({
    system: `You are helping a NON-TECHNICAL owner launch one of his software projects from a dashboard with a single click. Given read-only evidence about a project folder on his Mac, decide how to start the product.

Rules:
- Prefer a production-style start (e.g. a build already exists, or "npm start"); a dev server ("npm run dev") is acceptable if that's all the project has.
- The command runs from the project folder on macOS with zsh. It must be ONE non-interactive shell command.
- It must NEVER run git, never delete things, never modify the project's source code. Installing dependencies (node_modules, pip packages) is allowed via installCmd.
- If the product is a website/dashboard, give the local URL and port and set openBrowser true.
- If you genuinely can't tell how to start it, use kind "unknown" and explain why in plain English.
- The explanation is shown to the owner — plain English, no jargon.`,
    user: `Project: "${project.label}" (folder: ${folder.path})

Top-level files and folders:
${evidence.topLevel.join("\n") || "(couldn't read the folder)"}

Marker files present: ${evidence.markers.join(", ") || "none of the common ones"}

package.json (trimmed):
${evidence.packageJson ?? "(no package.json)"}

README (first lines):
${evidence.readmeHead ?? "(no README found)"}

How should the launcher start this product?`,
    toolName: "report_launch_plan",
    toolDescription: "How to launch this project for a non-technical owner",
    schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: 180_000,
  });

  if (analysis.kind === "unknown" || !analysis.startCmd.trim()) {
    throw new AiError(
      `Claude couldn't work out how to launch "${project.label}": ${analysis.explanation}`,
      422,
    );
  }
  assertSafeCommand(analysis.startCmd, "start");
  if (analysis.installCmd) assertSafeCommand(analysis.installCmd, "install");

  const url =
    analysis.url.trim() ||
    (analysis.port > 0 ? `http://localhost:${analysis.port}` : "");

  const dir = launchersDir();
  await fs.mkdir(dir, { recursive: true });
  const commandPath = path.join(dir, `${project.key}.command`);

  const script = renderLauncherScript({
    label: project.label,
    key: project.key,
    folder: folder.path,
    installCmd: analysis.installCmd.trim() || undefined,
    startCmd: analysis.startCmd.trim(),
    url: url || undefined,
    openBrowser: analysis.openBrowser && !!url,
    port: analysis.port > 0 ? analysis.port : undefined,
  });
  await fs.writeFile(commandPath, script, { encoding: "utf-8", mode: 0o755 });
  await fs.chmod(commandPath, 0o755);

  const config: LauncherConfig = {
    projectKey: project.key,
    folder: folder.path,
    kind: analysis.kind,
    installCmd: analysis.installCmd.trim() || undefined,
    startCmd: analysis.startCmd.trim(),
    port: analysis.port > 0 ? analysis.port : undefined,
    url: url || undefined,
    openBrowser: analysis.openBrowser && !!url,
    commandPath,
    analyzedAt: new Date().toISOString(),
    notes: analysis.explanation,
  };

  const store = await readStore();
  store.launchers[project.key] = config;
  await writeStore(store);

  return config;
}

/* ------------------------------------------------------------------ */
/* Status + launch                                                     */
/* ------------------------------------------------------------------ */

/** True when the product's url/port answers within ~1.5s. */
async function probeRunning(config: LauncherConfig): Promise<boolean> {
  const target = config.url ?? (config.port ? `http://localhost:${config.port}` : null);
  if (!target) return false;
  try {
    // Any HTTP answer (even a 404) means something is listening there.
    await fetch(target, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

export type LauncherStatus = {
  exists: boolean;
  running: boolean;
  url?: string;
  kind?: LauncherKind;
  analyzedAt?: string;
  notes?: string;
};

/** Whether a launcher exists for the project and whether the product answers. */
export async function launcherStatus(projectKey: string): Promise<LauncherStatus> {
  const config = await getLauncher(projectKey);
  if (!config) return { exists: false, running: false };
  // The .command file may have been deleted by hand — treat that as unconfigured.
  try {
    await fs.access(config.commandPath);
  } catch {
    return { exists: false, running: false };
  }
  const running = await probeRunning(config);
  return {
    exists: true,
    running,
    url: config.url,
    kind: config.kind,
    analyzedAt: config.analyzedAt,
    notes: config.notes,
  };
}

export type LaunchResult = { alreadyRunning: boolean; url?: string };

/**
 * Launch the product: if it's already answering, do nothing (the client just
 * opens the url); otherwise open the .command file, which runs in a Terminal
 * window that closes itself once the product is up.
 */
export async function launchProject(projectKey: string): Promise<LaunchResult> {
  const config = await getLauncher(projectKey);
  if (!config) {
    throw new AiError(
      "This project doesn't have a launcher yet. Create one first (the “Create launcher” button).",
      404,
    );
  }
  try {
    await fs.access(config.commandPath);
  } catch {
    throw new AiError(
      "The launcher file for this project is missing (it may have been deleted). Re-analyze the project to recreate it.",
      404,
    );
  }

  if (await probeRunning(config)) {
    return { alreadyRunning: true, url: config.url };
  }

  try {
    await exec("open", [config.commandPath], { timeout: 15_000 });
  } catch (err) {
    console.error("launchers: open failed", err);
    throw new AiError("Couldn't start the launcher. Try again.", 502);
  }
  return { alreadyRunning: false, url: config.url };
}
