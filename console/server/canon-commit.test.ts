import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitDraftToCanon } from "./canon-commit.js";
import type { SeasonDraft } from "./draft-watcher.js";

const fixtureDraft: SeasonDraft = {
  seasonNumber: 2,
  episodes: [
    { title: "Cold Open", logline: "A ship breaks orbit.", threads: ["supply-run-saboteur"] },
    { title: "Fallout", logline: "The crew scatters.", threads: [] },
  ],
  updatedAt: "2026-08-12T00:00:00.000Z",
};

describe("commitDraftToCanon", () => {
  let canonRoot: string;

  beforeEach(async () => {
    canonRoot = await mkdtemp(path.join(tmpdir(), "yts-canon-commit-test-"));
  });

  afterEach(async () => {
    await rm(canonRoot, { recursive: true, force: true });
  });

  it("writes the season markdown slate and appends a dated ledger section for the approved episodes (AC-HAPPY-4)", async () => {
    const result = await commitDraftToCanon({ canonRoot, seasonId: "season-2", draft: fixtureDraft });

    expect(result.seasonFile).toBe(path.join(canonRoot, "seasons", "season-2", "season-2.md"));
    expect(result.ledgerFile).toBe(path.join(canonRoot, "continuity-ledger.md"));

    const seasonContent = await readFile(result.seasonFile, "utf-8");
    expect(seasonContent).toContain("Cold Open");
    expect(seasonContent).toContain("A ship breaks orbit.");
    expect(seasonContent).toContain("supply-run-saboteur");
    expect(seasonContent).toContain("Fallout");

    const ledgerContent = await readFile(result.ledgerFile, "utf-8");
    expect(ledgerContent).toContain("Season 2");
    expect(ledgerContent).toContain("Cold Open");
    expect(ledgerContent).toContain("supply-run-saboteur");
  });

  it("appends to an existing ledger rather than overwriting prior seasons' approved-thread entries", async () => {
    await commitDraftToCanon({ canonRoot, seasonId: "season-2", draft: fixtureDraft });

    const secondDraft: SeasonDraft = {
      seasonNumber: 3,
      episodes: [{ title: "New Horizon", logline: "A fresh start.", threads: [] }],
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const result = await commitDraftToCanon({ canonRoot, seasonId: "season-3", draft: secondDraft });

    const ledgerContent = await readFile(result.ledgerFile, "utf-8");
    expect(ledgerContent).toContain("Season 2");
    expect(ledgerContent).toContain("Season 3");
    expect(ledgerContent).toContain("New Horizon");
  });

  it("writes both the season file and the ledger via temp-file + rename, never a direct write to the final path", async () => {
    const calls: string[] = [];
    const writeFileFn = vi.fn(async (p: string) => {
      calls.push(`write:${p}`);
    });
    const renameFn = vi.fn(async (from: string, to: string) => {
      calls.push(`rename:${from}->${to}`);
    });
    const mkdirFn = vi.fn(async () => {});

    const result = await commitDraftToCanon({
      canonRoot,
      seasonId: "season-2",
      draft: fixtureDraft,
      writeFileFn,
      renameFn,
      mkdirFn,
    });

    // Every write targets a `.tmp-<pid>-<timestamp>` path, never the final path directly.
    for (const call of writeFileFn.mock.calls) {
      const [writtenPath] = call;
      expect(writtenPath).not.toBe(result.seasonFile);
      expect(writtenPath).not.toBe(result.ledgerFile);
      expect(writtenPath).toMatch(/\.tmp-\d+-\d+$/);
    }

    // Each temp file is renamed into its real final path.
    expect(renameFn).toHaveBeenCalledWith(expect.stringMatching(/season-2\.md\.tmp-/), result.seasonFile);
    expect(renameFn).toHaveBeenCalledWith(expect.stringMatching(/continuity-ledger\.md\.tmp-/), result.ledgerFile);

    // The write always precedes its matching rename — never rename before the temp file exists.
    const seasonWriteIdx = calls.findIndex((c) => c.startsWith("write:") && c.includes("season-2.md.tmp-"));
    const seasonRenameIdx = calls.findIndex((c) => c.startsWith("rename:") && c.includes("season-2.md.tmp-"));
    expect(seasonWriteIdx).toBeGreaterThanOrEqual(0);
    expect(seasonWriteIdx).toBeLessThan(seasonRenameIdx);
  });

  it("rejects a path-traversal-shaped seasonId instead of resolving outside canonRoot", async () => {
    await expect(
      commitDraftToCanon({ canonRoot, seasonId: "../../etc/passwd", draft: fixtureDraft }),
    ).rejects.toThrow();
  });
});
