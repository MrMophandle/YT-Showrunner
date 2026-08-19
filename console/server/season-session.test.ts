import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALLOWED_TOOLS,
  FileSessionStore,
  InMemorySessionStore,
  SeasonSessionManager,
  buildArgs,
  isValidSeasonId,
  resolvePermissionMode,
  warnIfPermissionsDisabled,
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

describe("resolvePermissionMode (AC-PERM-3)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 'tight' when YTS_PERMISSION_MODE is unset", () => {
    vi.stubEnv("YTS_PERMISSION_MODE", undefined as unknown as string);
    expect(resolvePermissionMode()).toBe("tight");
  });

  it("returns 'tight' when YTS_PERMISSION_MODE is empty", () => {
    vi.stubEnv("YTS_PERMISSION_MODE", "");
    expect(resolvePermissionMode()).toBe("tight");
  });

  it("returns 'tight' when YTS_PERMISSION_MODE is any non-opt-in value", () => {
    vi.stubEnv("YTS_PERMISSION_MODE", "yolo");
    expect(resolvePermissionMode()).toBe("tight");
  });

  it("returns 'dangerously-skip-permissions' only for the exact documented opt-in token", () => {
    vi.stubEnv("YTS_PERMISSION_MODE", "dangerously-skip-permissions");
    expect(resolvePermissionMode()).toBe("dangerously-skip-permissions");
  });
});

describe("warnIfPermissionsDisabled (AC-PERM-3 startup warning)", () => {
  it("logs a one-line warning naming the reduced safety posture when the escape hatch is active", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfPermissionsDisabled("dangerously-skip-permissions");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/dangerously-skip-permissions/i);
    warnSpy.mockRestore();
  });

  it("does not log anything when the tight allowlist is in effect", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfPermissionsDisabled("tight");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("buildArgs (AC-PERM-1, AC-PERM-2, AC-PERM-3)", () => {
  it("includes a tight --allowedTools allowlist and no --dangerously-skip-permissions by default", () => {
    const args = buildArgs("hello", null, "tight");

    expect(args).toContain("--allowedTools");
    const idx = args.indexOf("--allowedTools");
    expect(args[idx + 1]).toBe(ALLOWED_TOOLS.join(","));
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("grants only what draft maintenance requires — no bare/blanket Bash or wildcard grant (AC-PERM-2)", () => {
    expect(ALLOWED_TOOLS).not.toContain("Bash");
    expect(ALLOWED_TOOLS).not.toContain("*");
    for (const tool of ALLOWED_TOOLS) {
      if (tool.startsWith("Bash")) {
        expect(tool).not.toBe("Bash");
        // Space-separated command-prefix syntax (matches this repo's existing
        // .claude/settings.local.json precedent and the CLI's documented
        // example) — NOT colon-separated, which the real CLI does not parse
        // as a scoped grant.
        expect(tool).toMatch(/^Bash\([a-z]+ \*\)$/);
        expect(tool).not.toContain(":");
      }
    }
    // Sufficient for canon reads plus a temp-file-then-rename atomic write.
    expect(ALLOWED_TOOLS).toContain("Read");
    expect(ALLOWED_TOOLS).toContain("Write");
    expect(ALLOWED_TOOLS).toContain("Bash(mv *)");
  });

  it("switches to --dangerously-skip-permissions and omits --allowedTools when that mode is passed (AC-PERM-3)", () => {
    const args = buildArgs("hello", null, "dangerously-skip-permissions");

    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--allowedTools");
  });

  it("keeps the pre-existing first-turn/resume argument shape intact (AC-REGRESSION-1)", () => {
    const firstTurn = buildArgs("my prompt", null, "tight");
    expect(firstTurn[0]).toBe("-p");
    expect(firstTurn).toEqual(
      expect.arrayContaining(["--output-format", "stream-json", "--verbose"]),
    );
    expect(firstTurn).not.toContain("--resume");
    expect(firstTurn[firstTurn.length - 1]).toBe("my prompt");

    const resumed = buildArgs("my prompt", "sess-1", "tight");
    expect(resumed).toEqual(expect.arrayContaining(["--resume", "sess-1"]));
    expect(resumed[resumed.length - 1]).toBe("my prompt");
  });
});
