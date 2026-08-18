/**
 * Unit tests for SeasonTurnRunner — the per-season FIFO queue + prompt
 * composition layer that both `/message` and `/reject` routes call into
 * (Phase 2). Uses the same fake-spawnFn injection idiom as
 * season-session.test.ts and index.test.ts, but with manual control over
 * when each spawned child "completes" so tests can assert on state
 * (single-flight, queue position, synthetic echo ordering) precisely at the
 * moment a turn is still in flight.
 */
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEASON_DRAFTING_SKILL_COMMAND } from "./context-bundle.js";
import { InMemorySessionStore, SeasonSessionManager, type ChildProcessLike, type SpawnFn } from "./season-session.js";
import { SeasonEventBus, type SeasonStreamEvent } from "./sse.js";
import { SeasonTurnRunner, type SubmitResult } from "./turn-runner.js";

function line(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

/**
 * A spawnFn that hands back a controllable fake child process without ever
 * auto-completing it. Tests decide exactly when (and whether) a spawned
 * "turn" resolves by calling `completeChild`, so ordering/timing assertions
 * (e.g. "before the turn resolves") are deterministic rather than racing a
 * queued microtask.
 */
function makeControllableSpawn(): {
  spawnFn: SpawnFn;
  capturedArgs: string[][];
  children: ChildProcessLike[];
} {
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

/**
 * `submit()` returns as soon as a turn is kicked off, well before the
 * process is actually spawned (prompt composition involves real async I/O —
 * `store.load`, and `assembleContextBundle`'s file reads on first turns).
 * Polls until the expected number of child processes has been spawned so
 * tests can then deterministically drive each child to completion.
 */
async function waitForChildren(children: ChildProcessLike[], count: number): Promise<void> {
  const deadline = Date.now() + 2000;
  while (children.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${count} spawned children (got ${children.length})`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Waits until at least `count` events matching `predicate` have been seen. */
async function waitForEvent(
  seen: SeasonStreamEvent[],
  predicate: (event: SeasonStreamEvent) => boolean,
  count = 1,
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (seen.filter(predicate).length < count) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for expected event");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Non-null child access with a clear failure message instead of a TS2532/undefined crash. */
function getChild(children: ChildProcessLike[], index: number): ChildProcessLike {
  const child = children[index];
  if (!child) {
    throw new Error(`Expected a spawned child at index ${index}, only got ${children.length}`);
  }
  return child;
}

/** Narrows a `SubmitResult` to the "queued" branch, or fails the test with a clear message. */
function expectQueued(result: SubmitResult): asserts result is { status: "queued"; queuePosition: number } {
  expect(result.status).toBe("queued");
}

function successLines(sessionId: string, text = "ok"): string[] {
  return [
    line({
      type: "assistant",
      session_id: sessionId,
      message: { id: "m1", role: "assistant", content: [{ type: "text", text }] },
    }),
    line({ type: "result", subtype: "success", is_error: false, session_id: sessionId }),
  ];
}

describe("SeasonTurnRunner", () => {
  let canonRoot: string;

  beforeEach(async () => {
    canonRoot = await mkdtemp(path.join(tmpdir(), "yts-turn-runner-"));
    await writeFile(path.join(canonRoot, "series-overview.md"), "# Fixture Series\n\nSome overview text.", "utf-8");
  });

  afterEach(async () => {
    await rm(canonRoot, { recursive: true, force: true });
  });

  it("assembles the context bundle and prefixes the skill command on the first turn (no existing session)", async () => {
    const { spawnFn, capturedArgs, children } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    const result = await runner.submit("season-1", "Let's start breaking season 1.");
    expect(result.status).toBe("started");

    await waitForChildren(children, 1);
    completeChild(getChild(children, 0), { stdoutLines: successLines("sess-1"), exitCode: 0 });
    // Allow the async drain chain to settle.
    await new Promise((resolve) => setImmediate(resolve));

    const firstArgs = capturedArgs[0] ?? [];
    const prompt = firstArgs[firstArgs.length - 1];
    expect(prompt).toContain(SEASON_DRAFTING_SKILL_COMMAND);
    expect(prompt).toContain("Fixture Series");
    expect(prompt).toContain("Let's start breaking season 1.");
    expect(firstArgs).not.toContain("--resume");
  });

  it("sends only the raw user message on a resumed turn — never re-sending the bundle or skill prefix (violation-attempt)", async () => {
    const { spawnFn, capturedArgs, children } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    await store.save({ seasonId: "season-2", sessionId: "sess-old", updatedAt: new Date().toISOString() });
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    await runner.submit("season-2", "What about the missing captain thread?");
    await waitForChildren(children, 1);
    completeChild(getChild(children, 0), { stdoutLines: successLines("sess-old"), exitCode: 0 });
    await new Promise((resolve) => setImmediate(resolve));

    const firstArgs = capturedArgs[0] ?? [];
    const prompt = firstArgs[firstArgs.length - 1];
    expect(prompt).toBe("What about the missing captain thread?");
    expect(prompt).not.toContain(SEASON_DRAFTING_SKILL_COMMAND);
    expect(prompt).not.toContain("Fixture Series");
    expect(firstArgs).toEqual(expect.arrayContaining(["--resume", "sess-old"]));
  });

  it("publishes a synthetic user echo synchronously right after startTurn(), before the turn resolves (AC-HAPPY-3)", async () => {
    const { spawnFn, children } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    const seen: SeasonStreamEvent[] = [];
    eventBus.subscribe("season-3", (event) => seen.push(event));

    await runner.submit("season-3", "Draft episode one.");

    // The synthetic echo is published synchronously inside submit()'s call to
    // startTurn()+publish(), before any of the async prompt-composition work
    // (store.load / assembleContextBundle) or the spawn itself has happened —
    // i.e. strictly before the turn resolves.
    const echo = seen.find(
      (e) => (e.payload as { type?: string }).type === "user",
    );
    expect(echo).toBeDefined();
    expect(echo?.payload).toEqual({
      type: "user",
      message: { role: "user", content: "Draft episode one." },
    });

    await waitForChildren(children, 1);
    completeChild(getChild(children, 0), { stdoutLines: successLines("sess-3"), exitCode: 0 });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("never re-sends the composed prompt (bundle/skill-prefix) as the echo's content — echo carries the raw user message only", async () => {
    const { spawnFn, children } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    const seen: SeasonStreamEvent[] = [];
    eventBus.subscribe("season-4", (event) => seen.push(event));

    await runner.submit("season-4", "Draft episode one.");

    const echo = seen.find((e) => (e.payload as { type?: string }).type === "user") as SeasonStreamEvent;
    const content = (echo.payload as { message: { content: string } }).message.content;
    expect(content).not.toContain(SEASON_DRAFTING_SKILL_COMMAND);
    expect(content).not.toContain("Fixture Series");
    expect(content).toBe("Draft episode one.");

    await waitForChildren(children, 1);
    completeChild(getChild(children, 0), { stdoutLines: successLines("sess-4"), exitCode: 0 });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("runs a turn immediately when none is in flight, and queues a second submit for the SAME season with a 1-based position, never spawning a second process while one is in flight", async () => {
    const { spawnFn, capturedArgs, children } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    const first = await runner.submit("season-5", "first message");
    const second = await runner.submit("season-5", "second message");

    expect(first.status).toBe("started");
    expectQueued(second);
    expect(second.queuePosition).toBe(1);

    await waitForChildren(children, 1);
    // Exactly one spawn happened — the queued message did NOT trigger a second process.
    expect(capturedArgs).toHaveLength(1);
    expect(children).toHaveLength(1);

    completeChild(getChild(children, 0), { stdoutLines: successLines("sess-5"), exitCode: 0 });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("drains the queued message as the next turn once the in-flight turn resolves, giving it its own synthetic echo", async () => {
    const { spawnFn, capturedArgs, children } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    const seen: SeasonStreamEvent[] = [];
    eventBus.subscribe("season-6", (event) => seen.push(event));

    await runner.submit("season-6", "first message");
    await runner.submit("season-6", "second message");

    await waitForChildren(children, 1);
    completeChild(getChild(children, 0), { stdoutLines: successLines("sess-6"), exitCode: 0 });
    // Let the drain loop kick off the next turn.
    await waitForChildren(children, 2);

    const secondArgs = capturedArgs[1] ?? [];
    const secondPrompt = secondArgs[secondArgs.length - 1];
    expect(secondPrompt).toBe("second message");

    await waitForEvent(seen, (e) => (e.payload as { type?: string }).type === "user", 2);
    const echoes = seen.filter((e) => (e.payload as { type?: string }).type === "user");
    expect(echoes).toHaveLength(2);
    const secondEcho = echoes[1];
    expect((secondEcho?.payload as { message: { content: string } }).message.content).toBe("second message");

    completeChild(getChild(children, 1), { stdoutLines: successLines("sess-6"), exitCode: 0 });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("discards the entire queue and publishes a yts_error event (FIFO order) when the in-flight turn crashes — discarded messages never spawn a process (violation-attempt)", async () => {
    const { spawnFn, capturedArgs, children } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    const seen: SeasonStreamEvent[] = [];
    eventBus.subscribe("season-7", (event) => seen.push(event));

    await runner.submit("season-7", "first message");
    const second = await runner.submit("season-7", "second message");
    const third = await runner.submit("season-7", "third message");
    expectQueued(second);
    expect(second.queuePosition).toBe(1);
    expectQueued(third);
    expect(third.queuePosition).toBe(2);

    await waitForChildren(children, 1);
    // Crash: non-zero exit, no terminal result event — mirrors season-session.test.ts's crash case.
    completeChild(getChild(children, 0), { stdoutLines: [], exitCode: 1 });
    await waitForEvent(seen, (e) => (e.payload as { type?: string }).type === "yts_error");

    // Only ONE spawn ever happened — the two discarded messages never triggered a process.
    expect(capturedArgs).toHaveLength(1);
    expect(children).toHaveLength(1);

    const errorEvent = seen.find((e) => (e.payload as { type?: string }).type === "yts_error");
    expect(errorEvent).toBeDefined();
    const payload = errorEvent?.payload as {
      type: string;
      error: string;
      crashed: boolean;
      exitCode: number | null;
      discardedMessages: string[];
    };
    expect(payload.crashed).toBe(true);
    expect(payload.exitCode).toBe(1);
    expect(typeof payload.error).toBe("string");
    expect(payload.discardedMessages).toEqual(["second message", "third message"]);
  });

  it("allows a fresh submit for the same season after a crash (the crash does not permanently wedge the season)", async () => {
    const { spawnFn, capturedArgs, children } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    await runner.submit("season-8", "first message");
    await waitForChildren(children, 1);
    completeChild(getChild(children, 0), { stdoutLines: [], exitCode: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const next = await runner.submit("season-8", "retry message");
    expect(next.status).toBe("started");
    await waitForChildren(children, 2);
    expect(capturedArgs).toHaveLength(2);

    completeChild(getChild(children, 1), { stdoutLines: successLines("sess-8"), exitCode: 0 });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("keeps different seasons independent — an in-flight turn for season A does not block or interact with season B", async () => {
    const { spawnFn, capturedArgs, children } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    const resultA = await runner.submit("season-a", "message for A");
    const resultB = await runner.submit("season-b", "message for B");

    expect(resultA.status).toBe("started");
    expect(resultB.status).toBe("started");
    await waitForChildren(children, 2);
    expect(capturedArgs).toHaveLength(2);
    expect(children).toHaveLength(2);

    completeChild(getChild(children, 0), { stdoutLines: successLines("sess-a"), exitCode: 0 });
    completeChild(getChild(children, 1), { stdoutLines: successLines("sess-b"), exitCode: 0 });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("rejects a path-traversal-shaped seasonId instead of resolving outside the canon root (defense in depth)", async () => {
    const { spawnFn } = makeControllableSpawn();
    const store = new InMemorySessionStore();
    const sessionManager = new SeasonSessionManager(store, spawnFn);
    const eventBus = new SeasonEventBus();
    const runner = new SeasonTurnRunner({ sessionManager, store, eventBus, canonRoot });

    await expect(runner.submit("../../etc/passwd", "hi")).rejects.toThrow();
  });
});
