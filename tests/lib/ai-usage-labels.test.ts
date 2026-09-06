/**
 * Guards the one property AI_LABELS exists for: the label vocabulary in
 * lib/ai-usage.ts and what call sites actually reference must not drift apart.
 *
 * TypeScript already keeps a call site from passing a bogus string (label is
 * typed `AiLabel`, not `string` — see StructuredCallOpts/ChatCallOpts in
 * lib/map-ai.ts), so a typo there is a compile error, not a silent new bucket
 * in the usage summary. What TypeScript does NOT catch is a label that's
 * defined but never wired to any call site — that's the "unused"-shaped half
 * of drift, and this test checks it the plain way: grep the source tree for
 * `AI_LABELS.<key>` and require every key to show up at least once.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { AI_LABELS } from "../../lib/ai-usage";

// fileURLToPath, not `.pathname` — the repo path contains a space, which a
// file: URL percent-encodes. Same note as tests/lib/public-access.test.ts.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "tests"]);

/** Every .ts/.tsx file under `dir`, recursively, skipping the usual noise. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

// app/ and lib/ are where every real call site lives (see the table in the
// task this test was written for); ai-usage.ts itself is excluded below since
// it's the definition, not a use.
const SOURCE_FILES = [
  ...collectSourceFiles(path.join(REPO_ROOT, "app")),
  ...collectSourceFiles(path.join(REPO_ROOT, "lib")),
].filter((f) => f !== path.join(REPO_ROOT, "lib", "ai-usage.ts"));

const SOURCE_TEXT = SOURCE_FILES.map((f) => readFileSync(f, "utf8")).join("\n");

describe("AI_LABELS", () => {
  test("every label is a non-empty kebab-case string", () => {
    for (const [key, value] of Object.entries(AI_LABELS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
      // lowercase words separated by single hyphens, e.g. "custom-idea-clarify".
      expect(value, `AI_LABELS.${key} = ${JSON.stringify(value)} is not kebab-case`).toMatch(
        /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
      );
    }
  });

  test("no two labels collide on the same value", () => {
    const values = Object.values(AI_LABELS);
    expect(new Set(values).size).toBe(values.length);
  });

  test("every defined label is referenced by at least one call site", () => {
    const unused = Object.keys(AI_LABELS).filter(
      (key) => !SOURCE_TEXT.includes(`AI_LABELS.${key}`),
    );
    expect(unused, `AI_LABELS keys defined but never used: ${unused.join(", ")}`).toEqual([]);
  });
});
