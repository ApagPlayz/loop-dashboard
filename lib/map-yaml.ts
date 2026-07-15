/**
 * Prompt extractor / replacer for the loop's workflow YAML files.
 *
 * Every Claude agent workflow embeds its instructions as a YAML block scalar:
 *
 *         prompt: |
 *           You are the SCOUT for ...
 *           ...many lines...
 *       # next step at a shallower indent ends the block
 *
 * These helpers round-trip that block safely: pull the prompt text out for a
 * friendly textarea, then splice edited text back into the ORIGINAL file so
 * everything outside the prompt stays byte-for-byte identical. If a file has no
 * such block (e.g. claude-mention uses --append-system-prompt, loop-metrics is a
 * plain script), extraction reports failure and callers fall back to raw editing.
 */

export type ExtractResult =
  | {
      ok: true;
      /** The de-indented prompt text, ready for a textarea. */
      prompt: string;
      /** Leading whitespace common to every prompt line (the block indent). */
      indent: string;
      /** Line index (0-based) of the `prompt: |` header. */
      headerLine: number;
    }
  | { ok: false; reason: string };

const HEADER_RE = /^(\s*)prompt:\s*\|[-+]?\d*\s*$/;

/** Does this string end with a carriage return (CRLF file)? */
function usesCrlf(yaml: string): boolean {
  return yaml.includes("\r\n");
}

/** Strip a trailing "\r" so we can reason about content without line endings. */
function bare(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function leadingWs(line: string): string {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : "";
}

/**
 * Extract the `prompt: |` block scalar from a workflow YAML string.
 */
export function extractPrompt(yaml: string): ExtractResult {
  const lines = yaml.split("\n");

  // 1. Find the `prompt: |` header line.
  let headerIdx = -1;
  let keyIndent = "";
  for (let i = 0; i < lines.length; i++) {
    const m = bare(lines[i]).match(HEADER_RE);
    if (m) {
      headerIdx = i;
      keyIndent = m[1];
      break;
    }
  }
  if (headerIdx < 0) {
    return { ok: false, reason: "No `prompt:` block found in this file." };
  }

  // 2. Walk the block: everything indented deeper than the `prompt:` key, plus
  //    blank lines, belongs to it. The first non-blank line at or below the key
  //    indent ends the block.
  let blockIndent: string | null = null;
  let endIdx = lines.length; // exclusive; first line AFTER the block
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const content = bare(lines[i]);
    if (content.trim() === "") continue; // blank lines are always inside
    const indent = leadingWs(content);
    if (indent.length <= keyIndent.length) {
      endIdx = i;
      break;
    }
    if (blockIndent === null) blockIndent = indent;
  }
  if (blockIndent === null) {
    return { ok: false, reason: "The `prompt:` block is empty." };
  }

  // 3. Trailing blank lines belong to whatever follows, not the prompt — leave
  //    them out so a no-op save preserves them exactly.
  let blockEnd = endIdx;
  while (blockEnd - 1 > headerIdx && bare(lines[blockEnd - 1]).trim() === "") {
    blockEnd--;
  }

  // 4. De-indent the block body for editing.
  const body = lines.slice(headerIdx + 1, blockEnd).map((l) => {
    const c = bare(l);
    if (c.trim() === "") return "";
    return c.startsWith(blockIndent!) ? c.slice(blockIndent!.length) : c.replace(/^\s+/, "");
  });

  return { ok: true, prompt: body.join("\n"), indent: blockIndent, headerLine: headerIdx };
}

/**
 * Splice edited prompt text back into the original YAML. Only the block body is
 * replaced; every other byte of the file is preserved. Throws if the original
 * has no extractable block (callers should have checked with extractPrompt).
 */
export function replacePrompt(originalYaml: string, newPrompt: string): string {
  const crlf = usesCrlf(originalYaml);
  const lines = originalYaml.split("\n");

  let headerIdx = -1;
  let keyIndent = "";
  for (let i = 0; i < lines.length; i++) {
    const m = bare(lines[i]).match(HEADER_RE);
    if (m) {
      headerIdx = i;
      keyIndent = m[1];
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error("Cannot splice: no `prompt:` block in the original file.");
  }

  let blockIndent: string | null = null;
  let endIdx = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const content = bare(lines[i]);
    if (content.trim() === "") continue;
    const indent = leadingWs(content);
    if (indent.length <= keyIndent.length) {
      endIdx = i;
      break;
    }
    if (blockIndent === null) blockIndent = indent;
  }
  if (blockIndent === null) {
    throw new Error("Cannot splice: the `prompt:` block is empty.");
  }

  let blockEnd = endIdx;
  while (blockEnd - 1 > headerIdx && bare(lines[blockEnd - 1]).trim() === "") {
    blockEnd--;
  }

  // Re-indent the edited text and re-attach line endings to match the file.
  const cr = crlf ? "\r" : "";
  const reindented = newPrompt.split("\n").map((l) => {
    const line = l.endsWith("\r") ? l.slice(0, -1) : l;
    return (line.trim() === "" ? "" : blockIndent + line) + cr;
  });

  const rebuilt = [
    ...lines.slice(0, headerIdx + 1),
    ...reindented,
    ...lines.slice(blockEnd),
  ];
  return rebuilt.join("\n");
}
