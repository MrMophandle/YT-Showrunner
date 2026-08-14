import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assembleContextBundle, buildTurnPrompt, renderContextBundle } from "./context-bundle.js";

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
  it("includes the context bundle ahead of the user's message on the first turn (no existing session)", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: false,
      contextBundleText: "BUNDLE-CONTENT-MARKER",
      userMessage: "Let's start breaking season 2.",
    });

    expect(prompt).toContain("BUNDLE-CONTENT-MARKER");
    expect(prompt).toContain("Let's start breaking season 2.");
    expect(prompt.indexOf("BUNDLE-CONTENT-MARKER")).toBeLessThan(
      prompt.indexOf("Let's start breaking season 2."),
    );
  });

  it("sends only the user's message on a resumed turn (existing session), never re-sending the bundle", () => {
    const prompt = buildTurnPrompt({
      hasExistingSession: true,
      contextBundleText: "BUNDLE-CONTENT-MARKER",
      userMessage: "What about the missing captain thread?",
    });

    expect(prompt).not.toContain("BUNDLE-CONTENT-MARKER");
    expect(prompt).toBe("What about the missing captain thread?");
  });
});
