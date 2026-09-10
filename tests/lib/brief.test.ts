/**
 * The product-brief reader/analyser.
 *
 * `analyseBrief` is the piece that decides whether a repo's brief is still
 * the template's placeholder text — which is the exact condition that makes
 * every agent in that repo's loop stand down and do nothing. Getting the
 * section-detection wrong in either direction is bad: too strict and a real
 * brief reads as "unfilled" forever; too loose and a repo that never got
 * filled in reads as fine.
 *
 * `resolveBriefPath` never touches the network in this file — lib/github is
 * mocked throughout, per this repo's convention (see tests/lib/loop-health.test.ts).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ARCHIVE_BRIEF_PATH,
  BRIEF_PLACEHOLDER,
  TEMPLATE_BRIEF_PATH,
  analyseBrief,
  resolveBriefPath,
} from "../../lib/brief";

// fileURLToPath, not `.pathname` — the repo path contains a space. Same note
// as tests/lib/public-access.test.ts and vitest.config.mts.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REAL_TEMPLATE_BRIEF = readFileSync(
  path.join(REPO_ROOT, "config/loop-template/files/loop-brief.md"),
  "utf-8",
);

vi.mock("../../lib/github", () => ({
  getFileContent: vi.fn(),
}));

const REPO = { owner: "alessiopagliarulo", repo: "some-project" };

describe("analyseBrief", () => {
  it("reads a fully-filled brief as filled", () => {
    const content = [
      "# Product brief for the loop",
      "",
      "## What this product is",
      "",
      "A dashboard that watches an AI improvement loop across several repos.",
      "",
      "## Current goals",
      "",
      "Ship the brief-awareness feature.",
      "",
      "## Off-limits areas",
      "",
      "Billing code — under contract with a vendor.",
      "",
      "## How the owner works",
      "",
      "Wants file:line evidence, triages daily.",
      "",
    ].join("\n");

    const result = analyseBrief(content);
    expect(result.filled).toBe(true);
    expect(result.unfilledSections).toEqual([]);
    expect(result.totalSections).toBe(5); // title + 4 content sections
  });

  it("reads the real template placeholder content as unfilled, naming every blank section", () => {
    const result = analyseBrief(REAL_TEMPLATE_BRIEF);

    expect(result.filled).toBe(false);
    expect(result.unfilledSections).toEqual([
      "What this product is",
      "Current goals",
      "Off-limits areas",
      "How the owner works",
    ]);
    // Title, "Keeping this current", its "scout block" sub-heading, and the
    // four content sections.
    expect(result.totalSections).toBe(7);
  });

  it("lists only the sections that are still blank when the brief is partially filled", () => {
    const content = [
      "## What this product is",
      "",
      "A tool for X.",
      "",
      "## Current goals",
      "",
      BRIEF_PLACEHOLDER,
      "",
      "## Off-limits areas",
      "",
      "Nothing yet — greenfield.",
      "",
    ].join("\n");

    const result = analyseBrief(content);
    expect(result.filled).toBe(false);
    expect(result.unfilledSections).toEqual(["Current goals"]);
    expect(result.totalSections).toBe(3);
  });

  it("reads an empty string as not filled", () => {
    expect(analyseBrief("")).toEqual({ filled: false, unfilledSections: [], totalSections: 0 });
  });

  it("reads a whitespace-only string as not filled", () => {
    expect(analyseBrief("   \n\n\t  ")).toEqual({
      filled: false,
      unfilledSections: [],
      totalSections: 0,
    });
  });

  it("is robust to heading level (### as well as ##)", () => {
    const content = ["### What this product is", "", BRIEF_PLACEHOLDER, ""].join("\n");
    const result = analyseBrief(content);
    expect(result.unfilledSections).toEqual(["What this product is"]);
    expect(result.totalSections).toBe(1);
  });

  it("detects a placeholder under the last heading, which has no following heading", () => {
    const content = ["## Off-limits areas", "", BRIEF_PLACEHOLDER].join("\n");
    const result = analyseBrief(content);
    expect(result.filled).toBe(false);
    expect(result.unfilledSections).toEqual(["Off-limits areas"]);
  });
});

describe("resolveBriefPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function mockPaths(present: { archive?: string; template?: string }) {
    const { getFileContent } = await import("../../lib/github");
    vi.mocked(getFileContent).mockImplementation(async (p: string) => {
      if (p === ARCHIVE_BRIEF_PATH) return present.archive ?? null;
      if (p === TEMPLATE_BRIEF_PATH) return present.template ?? null;
      return null;
    });
  }

  it("resolves to the archive path when only the archive brief exists", async () => {
    await mockPaths({ archive: "archive content" });
    expect(await resolveBriefPath(REPO)).toBe(ARCHIVE_BRIEF_PATH);
  });

  it("resolves to the template path when only the template brief exists", async () => {
    await mockPaths({ template: "template content" });
    expect(await resolveBriefPath(REPO)).toBe(TEMPLATE_BRIEF_PATH);
  });

  it("prefers the archive path when both exist", async () => {
    await mockPaths({ archive: "archive content", template: "template content" });
    expect(await resolveBriefPath(REPO)).toBe(ARCHIVE_BRIEF_PATH);
  });

  it("resolves to null when neither exists", async () => {
    await mockPaths({});
    expect(await resolveBriefPath(REPO)).toBeNull();
  });
});
