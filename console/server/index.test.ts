/**
 * Route-boundary tests for the console server. Focused on the seasonId
 * validation gate: seasonId arrives as an unvalidated HTTP route param and
 * the server has no auth/CORS layer in front of it, so an invalid seasonId
 * (path-traversal-shaped, containing a slash, empty, etc.) must be rejected
 * with a clean 4xx response before it reaches FileSessionStore or
 * SeasonEventBus.subscribe — never a 500 crash, never a silent pass-through.
 */
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index.js";
import type { ChildProcessLike, SpawnFn } from "./season-session.js";

/**
 * Polls until `filePath` exists. Used to let a background turn's
 * fire-and-forget session-pointer write (`FileSessionStore.save`'s
 * mkdir+writeFile+rename) settle before a test ends, so the next test's tmp
 * dir removal doesn't race a still-pending fs write into an unhandled
 * rejection.
 */
async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      await access(filePath);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for file: ${filePath}`);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

/**
 * Gives a background turn's async tail (fs writes via the libuv threadpool,
 * not just microtasks) real wall-clock time to settle before a test ends —
 * for cases like a pre-seeded session pointer where `waitForFile` above would
 * return immediately (the file already existed) without actually waiting for
 * the in-flight rewrite to land.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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

/** Builds a fake claude CLI process that never auto-completes — tests control exactly when it "exits" via `completeChild`. */
function controllableSpawn(): { spawnFn: SpawnFn; capturedArgs: string[][]; children: ChildProcessLike[] } {
  const capturedArgs: string[][] = [];
  const children: ChildProcessLike[] = [];
  const spawnFn: SpawnFn = (args: string[]): ChildProcessLike => {
    capturedArgs.push(args);
    const child = new EventEmitter() as ChildProcessLike;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    children.push(child);
    return child;
  };
  return { spawnFn, capturedArgs, children };
}

function completeChild(child: ChildProcessLike, opts: { stdoutLines?: string[]; exitCode?: number | null }): void {
  for (const l of opts.stdoutLines ?? []) {
    child.stdout?.emit("data", l);
  }
  child.emit("exit", opts.exitCode ?? 0);
}

async function waitForChildren(children: ChildProcessLike[], count: number): Promise<void> {
  const deadline = Date.now() + 2000;
  while (children.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${count} spawned children (got ${children.length})`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function successLine(sessionId: string, text = "ok"): string {
  return (
    JSON.stringify({
      type: "assistant",
      session_id: sessionId,
      message: { id: "m1", role: "assistant", content: [{ type: "text", text }] },
    }) + "\n"
  );
}

function resultLine(sessionId: string): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: sessionId }) + "\n";
}

describe("POST /api/seasons/:seasonId/message", () => {
  let canonRoot: string;
  let originalNodeEnv: string | undefined;

  beforeEach(async () => {
    canonRoot = await mkdtemp(path.join(tmpdir(), "yts-message-test-"));
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    // maxRetries: the runner's background session-pointer write (mkdir+writeFile+rename
    // inside FileSessionStore.save) can still be settling after a test's assertions
    // finish, since these tests intentionally do not await full turn completion —
    // retry past a transient ENOTEMPTY instead of racing it.
    await rm(canonRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("accepts immediately when nothing is in flight (200 {started:true}) and spawns a first-turn prompt with the skill prefix", async () => {
    const capturedArgs: string[][] = [];
    const spawnFn = fakeSpawn({
      capturedArgs,
      stdoutLines: [successLine("sess-new"), resultLine("sess-new")],
    });
    const { app } = createApp({ canonRoot, spawnFn });

    const res = await app.request("/api/seasons/season-1/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Let's start season 1." }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { started: boolean };
    expect(body).toEqual({ started: true });

    // submit() returns before the async prompt composition (store.load, canon file
    // reads) + spawn happens — poll until the spawn actually occurs.
    const deadline = Date.now() + 2000;
    while (capturedArgs.length < 1) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for spawn");
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(capturedArgs).toHaveLength(1);
    const firstArgs = capturedArgs[0] ?? [];
    const prompt = firstArgs[firstArgs.length - 1];
    expect(prompt).toContain("Let's start season 1.");

    // Let the background turn (its session-pointer write included) fully settle before
    // the test ends, so afterEach's tmp-dir removal doesn't race a still-pending fs
    // write and produce an unhandled rejection in FileSessionStore.save.
    await waitForFile(path.join(canonRoot, "seasons", "season-1", ".yts-session.json"));
  });

  it("returns 202 {queued:true, position} when a turn is already in flight for that season, without spawning a second process", async () => {
    const { spawnFn, capturedArgs, children } = controllableSpawn();
    const { app } = createApp({ canonRoot, spawnFn });

    const firstReqPromise = app.request("/api/seasons/season-1/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "first" }),
    });

    await waitForChildren(children, 1);

    const secondRes = await app.request("/api/seasons/season-1/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "second" }),
    });

    expect(secondRes.status).toBe(202);
    const secondBody = (await secondRes.json()) as { queued: boolean; position: number };
    expect(secondBody).toEqual({ queued: true, position: 1 });
    expect(children).toHaveLength(1);
    expect(capturedArgs).toHaveLength(1);

    const child = children[0];
    if (!child) throw new Error("expected a spawned child");
    completeChild(child, { stdoutLines: [successLine("sess-1"), resultLine("sess-1")], exitCode: 0 });
    await firstReqPromise;
    // Let the first turn's session-pointer write settle before the test ends (see
    // waitForFile's docstring) — the drained second (queued) turn is left in flight
    // deliberately (its own child is never completed), which is fine since nothing
    // awaits or rejects on it.
    await waitForFile(path.join(canonRoot, "seasons", "season-1", ".yts-session.json"));
  });

  it("rejects an empty/whitespace-only message with a 400, without spawning a process", async () => {
    const capturedArgs: string[][] = [];
    const spawnFn = fakeSpawn({ capturedArgs, stdoutLines: [] });
    const { app } = createApp({ canonRoot, spawnFn });

    const res = await app.request("/api/seasons/season-1/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });

    expect(res.status).toBe(400);
    expect(capturedArgs).toHaveLength(0);
  });

  it("rejects an invalid JSON body with a 400", async () => {
    const capturedArgs: string[][] = [];
    const spawnFn = fakeSpawn({ capturedArgs, stdoutLines: [] });
    const { app } = createApp({ canonRoot, spawnFn });

    const res = await app.request("/api/seasons/season-1/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });

    expect(res.status).toBe(400);
    expect(capturedArgs).toHaveLength(0);
  });

  it("rejects a path-traversal-shaped seasonId with a 4xx, without spawning a process", async () => {
    const capturedArgs: string[][] = [];
    const spawnFn = fakeSpawn({ capturedArgs, stdoutLines: [] });
    const { app } = createApp({ canonRoot, spawnFn });

    const res = await app.request("/api/seasons/..%2F..%2Fetc%2Fpasswd/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(capturedArgs).toHaveLength(0);
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
    // See the /message describe block's afterEach for why maxRetries is needed here too.
    await rm(canonRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

  it("composes the same first-turn context bundle + skill prefix as /message on a cold-start reject (no prior session) — AC-INTEGRATION-1", async () => {
    await writeFile(
      path.join(canonRoot, "continuity-ledger.md"),
      "## Unresolved Threads\n\n- The missing captain's fate is never addressed.",
    );

    const capturedArgs: string[][] = [];
    const spawnFn = fakeSpawn({
      capturedArgs,
      stdoutLines: [successLine("sess-cold"), resultLine("sess-cold")],
    });

    const { app } = createApp({ canonRoot, spawnFn });
    const res = await app.request("/api/seasons/season-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "Please revise the pacing." }),
    });

    expect(res.status).toBe(200);
    expect(capturedArgs).toHaveLength(1);
    const firstArgs = capturedArgs[0] ?? [];
    const prompt = firstArgs[firstArgs.length - 1];
    expect(prompt).toContain("/season-drafting");
    expect(prompt).toContain("The missing captain's fate is never addressed.");
    expect(prompt).toContain("Please revise the pacing.");
    expect(firstArgs).not.toContain("--resume");
  });

  it("returns 202 {queued:true, position} when a turn is already in flight for that season — shares the same single-flight queue as /message", async () => {
    const sessionDir = path.join(canonRoot, "seasons", "season-1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, ".yts-session.json"),
      JSON.stringify({ seasonId: "season-1", sessionId: "sess-old", updatedAt: new Date().toISOString() }),
    );

    const { spawnFn, capturedArgs, children } = controllableSpawn();
    const { app } = createApp({ canonRoot, spawnFn });

    const firstReqPromise = app.request("/api/seasons/season-1/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "first" }),
    });

    await waitForChildren(children, 1);

    const rejectRes = await app.request("/api/seasons/season-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "please revise" }),
    });

    expect(rejectRes.status).toBe(202);
    const rejectBody = (await rejectRes.json()) as { queued: boolean; position: number };
    expect(rejectBody).toEqual({ queued: true, position: 1 });
    expect(children).toHaveLength(1);
    expect(capturedArgs).toHaveLength(1);

    const child = children[0];
    if (!child) throw new Error("expected a spawned child");
    completeChild(child, { stdoutLines: [successLine("sess-old"), resultLine("sess-old")], exitCode: 0 });
    await firstReqPromise;
    // The session pointer file already exists (pre-seeded above), so waitForFile
    // would return immediately without waiting for this turn's rewrite — settle()
    // gives the background fs write real wall-clock time before the test ends.
    await settle();
  });
});
