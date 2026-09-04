/**
 * Minimal ANSI/SGR parser for GitHub Actions log text.
 *
 * Why translate rather than strip: the log tail is the only place in the
 * dashboard where you can read what an agent actually did, and Actions leans on
 * colour to mark the shape of a run — grey command echoes, red failures, cyan
 * group headers. Throwing all of that away makes a wall of undifferentiated
 * text that is harder to skim than what we started with. So we keep the colour.
 *
 * Why this is not an injection vector: the log is third-party text rendered in
 * the owner's authenticated page, so nothing from it may ever become markup.
 * This function returns **plain strings plus a class name chosen from the fixed
 * table below** — the log can only ever select one of those class names, never
 * supply one, and never emit a tag or an attribute. The caller renders the text
 * as a React child, which escapes it. There is no `dangerouslySetInnerHTML`
 * anywhere on this path and there must not be.
 *
 * Everything that is not a recognised colour/weight code — cursor moves, erase
 * codes, OSC/hyperlink sequences, background colours — is dropped rather than
 * rendered. Backgrounds are deliberately ignored: the viewer is a black `pre`,
 * and honouring an arbitrary background colour is the one thing here that could
 * wreck contrast.
 */

export type AnsiSpan = { text: string; className: string };

/** SGR foreground code -> Tailwind class. Standard 30-37, bright 90-97. */
const FG: Record<number, string> = {
  30: "text-zinc-600",
  31: "text-red-400",
  32: "text-emerald-400",
  33: "text-amber-300",
  34: "text-sky-400",
  35: "text-fuchsia-400",
  36: "text-cyan-400",
  37: "text-zinc-200",
  90: "text-zinc-500",
  91: "text-red-300",
  92: "text-emerald-300",
  93: "text-amber-200",
  94: "text-sky-300",
  95: "text-fuchsia-300",
  96: "text-cyan-300",
  97: "text-zinc-100",
};

const ESC = "\\u001b";

/**
 * Matches, in order: a CSI sequence (ESC `[` … final byte), an OSC sequence
 * terminated by BEL or ST (Actions emits these for hyperlinks), and any other
 * two-byte escape. Only CSI sequences ending in `m` carry styling; the rest are
 * matched purely so they can be removed.
 *
 * Built from a string rather than written as a literal so the escape byte stays
 * a visible \u001b escape in the source instead of an invisible control byte.
 */
const ESCAPE = new RegExp(
  [
    `${ESC}\\[[0-9;:?]*[ -/]*[@-~]`,
    `${ESC}\\][\\s\\S]*?(?:\\u0007|${ESC}\\\\)`,
    `${ESC}[@-Z\\\\-_]`,
  ].join("|"),
  "g",
);

const CSI_BRACKET = 0x5b; // "["

type State = { fg: string; bold: boolean; dim: boolean; underline: boolean };

function classOf(s: State): string {
  const parts: string[] = [];
  if (s.fg) parts.push(s.fg);
  else if (s.dim) parts.push("text-zinc-500");
  if (s.bold) parts.push("font-semibold");
  if (s.underline) parts.push("underline");
  return parts.join(" ");
}

function applySgr(state: State, params: string): void {
  // A bare `ESC[m` means reset, same as `ESC[0m`.
  const codes = (params === "" ? "0" : params)
    .split(";")
    .map((n) => (n === "" ? 0 : Number(n)));

  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (!Number.isFinite(c)) continue;
    if (c === 0) {
      state.fg = "";
      state.bold = false;
      state.dim = false;
      state.underline = false;
    } else if (c === 1) state.bold = true;
    else if (c === 2) state.dim = true;
    else if (c === 4) state.underline = true;
    else if (c === 22) {
      state.bold = false;
      state.dim = false;
    } else if (c === 24) state.underline = false;
    else if (c === 39) state.fg = "";
    else if (FG[c]) state.fg = FG[c];
    else if (c === 38 || c === 48) {
      // Extended colour: `38;5;n` or `38;2;r;g;b`. We don't render these, but we
      // must consume their parameters so the numbers that follow aren't misread
      // as further SGR codes.
      const mode = codes[i + 1];
      i += mode === 5 ? 2 : mode === 2 ? 4 : 1;
    }
    // Everything else (backgrounds, blink, inverse, …) is intentionally ignored.
  }
}

/**
 * Split ANSI-coloured text into styled spans. Adjacent spans sharing a style are
 * merged so a 200-line log doesn't become thousands of DOM nodes.
 */
export function parseAnsi(input: string): AnsiSpan[] {
  const state: State = { fg: "", bold: false, dim: false, underline: false };
  const out: AnsiSpan[] = [];

  const push = (text: string) => {
    if (!text) return;
    const className = classOf(state);
    const last = out[out.length - 1];
    if (last && last.className === className) last.text += text;
    else out.push({ text, className });
  };

  let cursor = 0;
  ESCAPE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ESCAPE.exec(input)) !== null) {
    push(input.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    const seq = m[0];
    if (seq.charCodeAt(1) === CSI_BRACKET && seq.endsWith("m")) {
      applySgr(state, seq.slice(2, -1));
    }
    // Any other sequence is dropped.
  }
  push(input.slice(cursor));

  return out;
}
