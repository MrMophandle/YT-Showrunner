import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileSessionStore,
  InMemorySessionStore,
  SeasonSessionManager,
  isValidSeasonId,
  type ChildProcessLike,
  type SpawnFn,
} from "./season-session.js";

function line(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

/** Builds a fake claude CLI process that emits the given stdout lines then exits. */
function fakeSpawn(opts: {
  stdoutLines: string[];
  stderr?: string;
  exitCode?: number | null;
  capturedArgs?: string[][];
}): SpawnFn {
  return (args: string[]): ChildProcessLike => {
    opts.capturedArgs?.push(args);
    const child = new EventEmitter() as ChildProcessLike;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;

    // Emit asynchronously so listeners are attached before data flows, matching real child_process behavior.
    queueMicrotask(() => {
      for (const l of opts.stdoutLines) {
        stdout.emit("data", l);
      }
      if (opts.stderr) {
        stderr.emit("data", opts.stderr);
      }
      child.emit("exit", opts.exitCode ?? 0);
    });

    return child;
  };
}

describe("SeasonSessionManager", () => {
  it("spawns the first turn with --output-format stream-json and no --resume, then persists the session id", async () => {
    const capturedArgs: string[][] = [];
    const spawnFn = fakeSpawn({
      capturedArgs,
      stdoutLines: [
        line({
          type: "assistant",
          session_id: "sess-new",
          message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Let's start." }] },
        }),
        line({ type: "result", subtype: "success", is_error: false, session_id: "sess-new" }),
      ],
    });
    const store = new InMemorySessionStore();
    const manager = new SeasonSessionManager(store, spawnFn);

    const result = await manager.sendMessage("season-1", "Here is the canon context bundle...");

    expect(capturedArgs[0]).toContain("--output-format");
    expect(capturedArgs[0]).toContain("stream-json");
    expect(capturedArgs[0]).not.toContain("--resume");
    expect(result.crashed).toBe(false);
    expect(result.sessionId).toBe("sess-new");

    const persisted = await store.load("season-1");
    expect(persisted?.sessionId).toBe("sess-new");
  });

  it("resumes against the recorded session id, then re-persists the id the turn actually reports (which may differ)", async () => {
    const store = new InMemorySessionStore();
    await store.save({ seasonId: "season-2", sessionId: "sess-old", updatedAt: new Date().toISOString() });

    const capturedArgs: string[][] = [];
    const spawnFn = fakeSpawn({
      capturedArgs,
      stdoutLines: [
        line({
          type: "assistant",
          session_id: "sess-forked",
          message: { id: "m2", role: "assistant", content: [{ type: "text", text: "Continuing..." }] },
        }),
        line({ type: "result", subtype: "success", is_error: false, session_id: "sess-forked" }),
      ],
    });
    const manager = new SeasonSessionManager(store, spawnFn);

    const result = await manager.sendMessage("season-2", "next message");

    expect(capturedArgs[0]).toEqual(expect.arrayContaining(["--resume", "sess-old"]));
    expect(result.sessionId).toBe("sess-forked");

    const persisted = await store.load("season-2");
    // The NEW id is persisted, not the old resumed one — session id is never assumed stable across --resume.
    expect(persisted?.sessionId).toBe("sess-forked");
  });

  it("surfaces a non-zero exit as a crashed turn with exit code and captured stderr, never a silent hang (AC-ERROR-1)", async () => {
    const spawnFn = fakeSpawn({
      stdoutLines: [],
      stderr: "Error: something went wrong\n",
      exitCode: 1,
    });
    const store = new InMemorySessionStore();
    const manager = new SeasonSessionManager(store, spawnFn);

    const result = await manager.sendMessage("season-3", "hello");

    expect(result.crashed).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("something went wrong");

    // No session id was learned, so nothing should be persisted for this season.
    const persisted = await store.load("season-3");
    expect(persisted).toBeNull();
  });
});

describe("isValidSeasonId", () => {
  it("accepts alphanumeric, hyphen, and underscore seasonIds", () => {
    expect(isValidSeasonId("season-1_Test")).toBe(true);
    expect(isValidSeasonId("abc123")).toBe(true);
  });

  it("rejects path-traversal-shaped, slash-containing, and empty seasonIds", () => {
    expect(isValidSeasonId("../../etc/passwd")).toBe(false);
    expect(isValidSeasonId("..")).toBe(false);
    expect(isValidSeasonId("a/b")).toBe(false);
    expect(isValidSeasonId("")).toBe(false);
  });
});

describe("FileSessionStore seasonId validation", () => {
  let canonRoot: string;

  beforeEach(async () => {
    canonRoot = await mkdtemp(path.join(tmpdir(), "yts-session-test-"));
  });

  afterEach(async () => {
    await rm(canonRoot, { recursive: true, force: true });
  });

  it.each(["../../etc/passwd", "..", "a/b", ""])(
    "load() rejects path-traversal-shaped seasonId %j instead of resolving outside canonRoot",
    async (badSeasonId) => {
      const store = new FileSessionStore(canonRoot);
      await expect(store.load(badSeasonId)).rejects.toThrow();
    },
  );

  it.each(["../../etc/passwd", "..", "a/b", ""])(
    "save() rejects path-traversal-shaped seasonId %j instead of resolving outside canonRoot",
    async (badSeasonId) => {
      const store = new FileSessionStore(canonRoot);
      await expect(
        store.save({ seasonId: badSeasonId, sessionId: "sess-1", updatedAt: new Date().toISOString() }),
      ).rejects.toThrow();
    },
  );

  it("continues to load/save valid alphanumeric/hyphen/underscore seasonIds exactly as before", async () => {
    const store = new FileSessionStore(canonRoot);
    const record = { seasonId: "season_1-Test", sessionId: "sess-1", updatedAt: new Date().toISOString() };

    await store.save(record);
    const loaded = await store.load("season_1-Test");

    expect(loaded).toEqual(record);
  });
});
