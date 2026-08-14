/**
 * Route-boundary tests for the console server. Focused on the seasonId
 * validation gate: seasonId arrives as an unvalidated HTTP route param and
 * the server has no auth/CORS layer in front of it, so an invalid seasonId
 * (path-traversal-shaped, containing a slash, empty, etc.) must be rejected
 * with a clean 4xx response before it reaches FileSessionStore or
 * SeasonEventBus.subscribe — never a 500 crash, never a silent pass-through.
 */
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import type { ChildProcessLike, SpawnFn } from "./season-session.js";

/** Builds a fake claude CLI process that emits the given stdout lines then exits — mirrors season-session.test.ts's fakeSpawn. */
function fakeSpawn(opts: { stdoutLines: string[]; exitCode?: number | null; capturedArgs?: string[][] }): SpawnFn {
  return (args: string[]): ChildProcessLike => {
    opts.capturedArgs?.push(args);
    const child = new EventEmitter() as ChildProcessLike;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;
    queueMicrotask(() => {
      for (const l of opts.stdoutLines) {
        stdout.emit("data", l);
      }
      child.emit("exit", opts.exitCode ?? 0);
    });
    return child;
  };
}

describe("GET /api/seasons/:seasonId/events — seasonId validation", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("rejects a path-traversal-shaped seasonId (encoded slashes) with a 4xx, not a crash", async () => {
    const { app } = createApp();

    // Decodes to "../../etc/passwd" once Hono reads the route param.
    const res = await app.request("/api/seasons/..%2F..%2Fetc%2Fpasswd/events");

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("rejects a seasonId containing a raw slash-equivalent traversal token with a 4xx", async () => {
    const { app } = createApp();

    const res = await app.request("/api/seasons/..%2Fescaped/events");

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("does not reject a valid alphanumeric/hyphen/underscore seasonId at the validation gate", async () => {
    const { app } = createApp();

    const res = await app.request("/api/seasons/season_1-Test/events");

    // The SSE stream itself stays open (no terminal status to assert), but the
    // validation gate must not short-circuit it with a 4xx.
    expect(res.status).toBe(200);
    res.body?.cancel();
  });
});

describe("GET /api/seasons/:seasonId/draft — seasonId validation and no-draft state", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("rejects a path-traversal-shaped seasonId with a 4xx, reusing the same validation gate as /events", async () => {
    const { app } = createApp();

    const res = await app.request("/api/seasons/..%2F..%2Fetc%2Fpasswd/draft");

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("returns 204 for a valid season with no draft file written yet (AC-ENTRY-1's empty state)", async () => {
    const { app } = createApp();

    const res = await app.request("/api/seasons/season_1-Test/draft");

    expect(res.status).toBe(204);
  });
});

describe("POST /api/seasons/:seasonId/approve", () => {
  let canonRoot: string;
  let originalNodeEnv: string | undefined;

  beforeEach(async () => {
    canonRoot = await mkdtemp(path.join(tmpdir(), "yts-approve-test-"));
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await rm(canonRoot, { recursive: true, force: true });
  });

  it.each([
    ["no draft file exists yet", null],
    ["the draft has zero episodes", { seasonNumber: 1, episodes: [], updatedAt: new Date().toISOString() }],
  ])("returns 400 and commits nothing when %s", async (_label, draft) => {
    if (draft) {
      const seasonDir = path.join(canonRoot, "seasons", "season-1");
      await mkdir(seasonDir, { recursive: true });
      await writeFile(path.join(seasonDir, "season.draft.json"), JSON.stringify(draft));
    }

    const { app } = createApp({ canonRoot });
    const res = await app.request("/api/seasons/season-1/approve", { method: "POST" });

    expect(res.status).toBe(400);
  });

  it("commits the current last-good draft to canon and returns the file paths written (AC-HAPPY-4)", async () => {
    const seasonDir = path.join(canonRoot, "seasons", "season-1");
    await mkdir(seasonDir, { recursive: true });
    await writeFile(
      path.join(seasonDir, "season.draft.json"),
      JSON.stringify({
        seasonNumber: 1,
        episodes: [{ title: "Cold Open", logline: "A ship breaks orbit.", threads: [] }],
        updatedAt: new Date().toISOString(),
      }),
    );

    const { app } = createApp({ canonRoot });
    const res = await app.request("/api/seasons/season-1/approve", { method: "POST" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { seasonFile: string; ledgerFile: string };
    expect(body.seasonFile).toContain("season-1.md");
    expect(body.ledgerFile).toContain("continuity-ledger.md");
  });
});

describe("POST /api/seasons/:seasonId/reject", () => {
  let canonRoot: string;
  let originalNodeEnv: string | undefined;

  beforeEach(async () => {
    canonRoot = await mkdtemp(path.join(tmpdir(), "yts-reject-test-"));
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await rm(canonRoot, { recursive: true, force: true });
  });

  it("sends the notes as the next message in the SAME resumed session — no canon file written (AC-HAPPY-5)", async () => {
    const sessionDir = path.join(canonRoot, "seasons", "season-1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, ".yts-session.json"),
      JSON.stringify({ seasonId: "season-1", sessionId: "sess-old", updatedAt: new Date().toISOString() }),
    );

    const capturedArgs: string[][] = [];
    const spawnFn = fakeSpawn({
      capturedArgs,
      stdoutLines: [
        JSON.stringify({
          type: "assistant",
          session_id: "sess-old",
          message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Got it, revising." }] },
        }) + "\n",
        JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "sess-old" }) + "\n",
      ],
    });

    const { app } = createApp({ canonRoot, spawnFn });
    const res = await app.request("/api/seasons/season-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "Please add more tension in episode 2." }),
    });

    expect(res.status).toBe(200);
    // Resumed the SAME persisted session id — never a fresh one.
    expect(capturedArgs[0]).toEqual(expect.arrayContaining(["--resume", "sess-old"]));
    expect(capturedArgs[0]).toContain("Please add more tension in episode 2.");
  });

  it("rejects an empty notes body with a 400 instead of resuming the session", async () => {
    const capturedArgs: string[][] = [];
    const spawnFn = fakeSpawn({ capturedArgs, stdoutLines: [] });
    const { app } = createApp({ canonRoot, spawnFn });

    const res = await app.request("/api/seasons/season-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "   " }),
    });

    expect(res.status).toBe(400);
    expect(capturedArgs).toHaveLength(0);
  });

  it("returns a non-200 error response (not a false-success 200) when the resumed turn crashes (AC-ERROR-1)", async () => {
    const sessionDir = path.join(canonRoot, "seasons", "season-1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, ".yts-session.json"),
      JSON.stringify({ seasonId: "season-1", sessionId: "sess-old", updatedAt: new Date().toISOString() }),
    );

    // Non-zero exit, no terminal `result` event — mirrors season-session.test.ts's crash case.
    const spawnFn = fakeSpawn({ stdoutLines: [], exitCode: 1 });
    const { app } = createApp({ canonRoot, spawnFn });

    const res = await app.request("/api/seasons/season-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "Please add more tension in episode 2." }),
    });

    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = (await res.json()) as { crashed: boolean; exitCode: number | null; error: string };
    expect(body.crashed).toBe(true);
    expect(body.exitCode).toBe(1);
    expect(typeof body.error).toBe("string");
  });
});
