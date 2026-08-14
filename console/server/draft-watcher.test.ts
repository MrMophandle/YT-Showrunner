/**
 * Draft-watcher tests: atomic-write round trip and torn/partial-read handling.
 * Mirrors `FileSessionStore.save`'s temp-file + rename convention
 * (season-session.ts) for the round-trip test, and injects `readFileFn` to
 * simulate a torn read for AC-ASYNC-3 without relying on OS-level write timing.
 */
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DraftWatcher } from "./draft-watcher.js";

describe("DraftWatcher", () => {
  let canonRoot: string;

  beforeEach(async () => {
    canonRoot = await mkdtemp(path.join(tmpdir(), "yts-draft-watcher-"));
  });

  afterEach(async () => {
    await rm(canonRoot, { recursive: true, force: true });
  });

  it("reads the draft after an atomic temp-file + rename write, matching FileSessionStore's convention", async () => {
    const seasonId = "season-2";
    const seasonDir = path.join(canonRoot, "seasons", seasonId);
    await mkdir(seasonDir, { recursive: true });
    const finalPath = path.join(seasonDir, "season.draft.json");
    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    const draft = {
      seasonNumber: 2,
      episodes: [{ title: "Cold Open", logline: "A ship breaks orbit.", threads: ["supply-run-saboteur"] }],
      updatedAt: "2026-08-12T22:00:00.000Z",
    };
    await writeFile(tmpPath, JSON.stringify(draft, null, 2), "utf-8");
    await rename(tmpPath, finalPath);

    const watcher = new DraftWatcher({ canonRoot, seasonId });
    const result = await watcher.pollOnce();

    expect(result.updated).toBe(true);
    expect(result.draft).toEqual(draft);
    expect(watcher.getLastGood()).toEqual(draft);
  });

  it("discards a torn/unparseable read and keeps serving the last-good draft, then recovers on the next poll", async () => {
    const goodDraft = {
      seasonNumber: 3,
      episodes: [{ title: "Pilot", logline: "Everything starts here.", threads: [] }],
      updatedAt: "2026-08-12T00:00:00.000Z",
    };
    const reads = [
      JSON.stringify(goodDraft), // first poll: valid draft
      '{"seasonNumber": 3, "episo', // second poll: torn mid-rename read
      JSON.stringify({ ...goodDraft, episodes: [...goodDraft.episodes, { title: "Ep 2", logline: "...", threads: [] }] }), // third poll: recovered
    ];
    let call = 0;
    const readFileFn = async () => {
      const value = reads[call];
      call += 1;
      if (value === undefined) throw new Error("no more fixture reads queued");
      return value;
    };

    const watcher = new DraftWatcher({ canonRoot, seasonId: "season-3", readFileFn });

    const first = await watcher.pollOnce();
    expect(first.updated).toBe(true);
    expect(first.draft).toEqual(goodDraft);

    const torn = await watcher.pollOnce();
    expect(torn.updated).toBe(false);
    expect(torn.draft).toEqual(goodDraft); // still the last-good draft, not null, not thrown

    const recovered = await watcher.pollOnce();
    expect(recovered.updated).toBe(true);
    expect(recovered.draft?.episodes).toHaveLength(2);
  });

  it("rejects an invalid seasonId at construction, before any path is ever built", () => {
    expect(() => new DraftWatcher({ canonRoot: "/tmp", seasonId: "../../etc" })).toThrow();
  });
});
