import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SEASON_DRAFTING_SKILL_COMMAND,
  assembleContextBundle,
  buildTurnPrompt,
  renderContextBundle,
} from "./context-bundle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_CANON_ROOT = path.join(__dirname, "..", "fixtures", "canon");

describe("assembleContextBundle", () => {
  it("reads real canon files and includes continuity-ledger.md's unresolved-thread text verbatim, plus series overview, character bibles, and a previous season summary (AC-HAPPY-1)", async () => {
    const bundle = await assembleContextBundle(FIXTURE_CANON_ROOT, "season-2");
    const rendered = renderContextBundle(bundle);

    // Verbatim unresolved-thread text from the fixture continuity-ledger.md — not a
    // paraphrase or summary, the exact sentence as written on disk.
    expect(rendered).toContain(
      "Chief Ashworth's body was never recovered from the tunnel collapse — is he",
    );
    expect(rendered).toContain(
      "actually dead?",
    );

    // Series overview content.
    expect(rendered).toContain("DeadLight follows a skeleton crew");

    // Character bible content (both fixture characters).
    expect(rendered).toContain("Mara Voss");
    expect(rendered).toContain("Dez Okafor");

    // Previous season summary content.
    expect(rendered).toContain("Chief Ashworth, in the finale's tunnel collapse");
  });

  it("omits the previous-seasons section cleanly (no fabricated content) when no previous season summary exists yet", async () => {
    const canonRoot = await mkdtemp(path.join(tmpdir(), "yts-canon-nosummary-"));
    try {
      await writeFile(
        path.join(canonRoot, "series-overview.md"),
        "# A brand new show\n\nNo prior seasons yet.",
        "utf-8",
      );
      await mkdir(path.join(canonRoot, "characters"), { recursive: true });
      await writeFile(
        path.join(canonRoot, "characters", "lead.md"),
        "# Lead Character\n\nSome bible content.",
        "utf-8",
      );
      await writeFile(
        path.join(canonRoot, "continuity-ledger.md"),
        "# Continuity Ledger\n\n## Unresolved Threads\n\n- Nothing yet, this is season 1.",
        "utf-8",
      );

      const bundle = await assembleContextBundle(canonRoot, "season-1");

      expect(bundle.previousSeasonSummaries).toEqual([]);
      const rendered = renderContextBundle(bundle);
      expect(rendered).toContain("A brand new show");
      expect(rendered).toContain("Nothing yet, this is season 1.");
      // No fabricated "Previous Seasons" heading content when there is nothing to show.
      expect(rendered).not.toMatch(/Previous Seasons?\s*\n+\s*(-|\*)/);
    } finally {
      await rm(canonRoot, { recursive: true, force: true });
    }
  });

  it("omits the unresolved-threads section cleanly when continuity-ledger.md is entirely missing, without fabricating thread text", async () => {
    const canonRoot = await mkdtemp(path.join(tmpdir(), "yts-canon-noledger-"));
    try {
      await writeFile(
        path.join(canonRoot, "series-overview.md"),
        "# A show with no ledger yet",
        "utf-8",
      );

      const bundle = await assembleContextBundle(canonRoot, "season-1");

      expect(bundle.unresolvedThreads).toBeNull();
      const rendered = renderContextBundle(bundle);
      expect(rendered).not.toContain("undefined");
      expect(rendered).not.toContain("null");
    } finally {
      await rm(canonRoot, { recursive: true, force: true });
    }
  });

  it("rejects a path-traversal-shaped seasonId instead of resolving outside the canon root", async () => {
    await expect(assembleContextBundle(FIXTURE_CANON_ROOT, "../../etc/passwd")).rejects.toThrow();
  });
});

describe("buildTurnPrompt", () => {
  it("prefixes the skill command ahead of the path facts, context bundle, and the user's message on the first turn (no existing session)", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: false,
      contextBundleText: "BUNDLE-CONTENT-MARKER",
      userMessage: "Let's start breaking season 2.",
      canonRoot: FIXTURE_CANON_ROOT,
      seasonId: "season-2",
    });

    expect(prompt).toContain(SEASON_DRAFTING_SKILL_COMMAND);
    expect(prompt).toContain("BUNDLE-CONTENT-MARKER");
    expect(prompt).toContain("Let's start breaking season 2.");
    expect(prompt.indexOf(SEASON_DRAFTING_SKILL_COMMAND)).toBeLessThan(
      prompt.indexOf("BUNDLE-CONTENT-MARKER"),
    );
    expect(prompt.indexOf("BUNDLE-CONTENT-MARKER")).toBeLessThan(
      prompt.indexOf("Let's start breaking season 2."),
    );
  });

  it("prefixes the skill command directly ahead of the path facts and the user's message on the first turn when the bundle is empty, without a fabricated bundle section", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: false,
      contextBundleText: "",
      userMessage: "Let's start breaking season 1.",
      canonRoot: FIXTURE_CANON_ROOT,
      seasonId: "season-1",
    });

    expect(prompt.startsWith(SEASON_DRAFTING_SKILL_COMMAND)).toBe(true);
    expect(prompt).toContain(FIXTURE_CANON_ROOT);
    expect(prompt.endsWith("Let's start breaking season 1.")).toBe(true);
    // No fabricated bundle section — the path facts sit directly ahead of the
    // user message, without an extra empty bundle block between them.
    expect(prompt).not.toMatch(/---\s*\n\s*\n\s*---/);
  });

  it("prefixes the skill command directly ahead of the path facts and the user's message on the first turn when the bundle is whitespace-only", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: false,
      contextBundleText: "   \n  ",
      userMessage: "Let's start breaking season 1.",
      canonRoot: FIXTURE_CANON_ROOT,
      seasonId: "season-1",
    });

    expect(prompt.startsWith(SEASON_DRAFTING_SKILL_COMMAND)).toBe(true);
    expect(prompt).toContain(FIXTURE_CANON_ROOT);
    expect(prompt.endsWith("Let's start breaking season 1.")).toBe(true);
  });

  it("sends only the user's message on a resumed turn (existing session), never re-sending the bundle or the skill prefix", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: true,
      contextBundleText: "BUNDLE-CONTENT-MARKER",
      userMessage: "What about the missing captain thread?",
      canonRoot: FIXTURE_CANON_ROOT,
      seasonId: "season-2",
    });

    expect(prompt).not.toContain("BUNDLE-CONTENT-MARKER");
    expect(prompt).not.toContain(SEASON_DRAFTING_SKILL_COMMAND);
    expect(prompt).toBe("What about the missing captain thread?");
  });

  it("states the absolute show canon root and the absolute resolved draft path on the first turn (AC-PATH-1)", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: false,
      contextBundleText: "BUNDLE-CONTENT-MARKER",
      userMessage: "Let's start breaking season 1.",
      canonRoot: FIXTURE_CANON_ROOT,
      seasonId: "season-1",
    });

    const expectedDraftPath = path.join(FIXTURE_CANON_ROOT, "seasons", "season-1", "season.draft.json");
    expect(prompt).toContain(FIXTURE_CANON_ROOT);
    expect(prompt).toContain(expectedDraftPath);
  });

  it("resolves the draft path using the route's seasonId verbatim, regardless of what season the conversation discusses (AC-SEASON-1)", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: false,
      contextBundleText: "We're actually drafting season 4 in the conversation text.",
      userMessage: "Let's talk about season 4 even though the route says season-1.",
      canonRoot: FIXTURE_CANON_ROOT,
      seasonId: "season-1",
    });

    const expectedDraftPath = path.join(FIXTURE_CANON_ROOT, "seasons", "season-1", "season.draft.json");
    expect(prompt).toContain(expectedDraftPath);
    expect(prompt).not.toContain(path.join(FIXTURE_CANON_ROOT, "seasons", "season-4", "season.draft.json"));
  });

  it("presents the canon root as show-scoped, distinct from the season-scoped draft path — never conflated into one string (AC-PATH-2)", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: false,
      contextBundleText: "BUNDLE-CONTENT-MARKER",
      userMessage: "Let's start breaking season 3.",
      canonRoot: FIXTURE_CANON_ROOT,
      seasonId: "season-3",
    });

    const draftPath = path.join(FIXTURE_CANON_ROOT, "seasons", "season-3", "season.draft.json");
    // Both facts appear, but the canon root itself is stated as its own fact
    // (e.g. followed by non-draft-path text) rather than only ever appearing
    // as a substring of the draft path sentence.
    expect(prompt).toContain(FIXTURE_CANON_ROOT);
    expect(prompt).toContain(draftPath);
    const canonRootIndex = prompt.indexOf(FIXTURE_CANON_ROOT);
    const draftPathIndex = prompt.indexOf(draftPath);
    expect(canonRootIndex).toBeGreaterThanOrEqual(0);
    expect(draftPathIndex).toBeGreaterThan(canonRootIndex);
    // The canon-root fact is not merely the prefix of the draft-path sentence —
    // there is a standalone mention of it (i.e. it appears at an offset other
    // than immediately where the draft path string begins).
    expect(canonRootIndex).not.toBe(draftPathIndex);
  });

  it("states neither the canon root nor the draft path on a resumed turn (AC-PATH-3)", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: true,
      contextBundleText: "BUNDLE-CONTENT-MARKER",
      userMessage: "What about the missing captain thread?",
      canonRoot: FIXTURE_CANON_ROOT,
      seasonId: "season-2",
    });

    expect(prompt).not.toContain(FIXTURE_CANON_ROOT);
    expect(prompt).not.toContain("season.draft.json");
    expect(prompt).toBe("What about the missing captain thread?");
  });
});
