/**
 * Spawns and tracks headless `claude -p --output-format stream-json` processes
 * for a season's drafting conversation, threading `--resume <session-id>`
 * across turns.
 *
 * Per the task's Empirical Unknown #1: a resumed print-mode run may fork to a
 * NEW session id rather than reusing the old one. This module never assumes
 * the session id is stable across `--resume` — it re-reads the session id from
 * each turn's own stream-json output (via stream-parser's `sessionId`) and
 * re-persists it after every turn, first-turn or resumed.
 *
 * The headless process's lifecycle is intentionally NOT coupled to any SSE
 * subscriber's connection state (AC-ASYNC-1) — `runTurn` runs to completion
 * (or crash) regardless of whether anything is listening to `onEvent`.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, rename, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseStreamJson, parseStreamLine, type ParsedStream } from "./stream-parser.js";

/** Narrow structural interface a fake process in tests must satisfy. Node's real ChildProcess conforms to it. */
export interface ChildProcessLike extends EventEmitter {
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
}

export type SpawnFn = (args: string[]) => ChildProcessLike;

function defaultSpawn(args: string[]): ChildProcessLike {
  return nodeSpawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] }) as unknown as ChildProcessLike;
}

export interface RunTurnOptions {
  seasonId: string;
  /** Full context bundle on the first turn, or just the user's message on later turns — caller's responsibility. */
  prompt: string;
  /** Session id to resume, or null/undefined to start a fresh session. */
  resumeSessionId?: string | null;
  spawnFn?: SpawnFn;
  /** Called with each raw stream-json event object as soon as its line arrives, for live SSE broadcast. */
  onEvent?: (rawEvent: unknown) => void;
}

export interface RunTurnResult extends ParsedStream {
  exitCode: number | null;
  /** True when the process exited non-zero, died, or closed its stream without a terminal result event (AC-ERROR-1). */
  crashed: boolean;
  stderr: string;
}

function buildArgs(prompt: string, resumeSessionId?: string | null): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  args.push(prompt);
  return args;
}

/** Spawns one headless turn, streams parsed events live via onEvent, and resolves once the process exits. */
export function runTurn(options: RunTurnOptions): Promise<RunTurnResult> {
  const spawnFn = options.spawnFn ?? defaultSpawn;
  const args = buildArgs(options.prompt, options.resumeSessionId);
  const child = spawnFn(args);

  let stdout = "";
  let stderr = "";
  let lineBuffer = "";
  let nextLineNumber = 1;

  const consumeLines = (chunk: string) => {
    lineBuffer += chunk;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      if (options.onEvent) {
        const parsed = parseStreamLine(line, nextLineNumber);
        options.onEvent(parsed);
      }
      nextLineNumber += 1;
    }
  };

  child.stdout?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    stdout += text;
    consumeLines(text);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  return new Promise<RunTurnResult>((resolve) => {
    child.on("error", (err: Error) => {
      // Process failed to even spawn — surfaced as a crash with exit code null, never a silent hang.
      resolve({
        turns: [],
        unknownEvents: [],
        parseErrors: [],
        result: null,
        sessionId: null,
        exitCode: null,
        crashed: true,
        stderr: stderr || err.message,
      });
    });

    child.on("exit", (code: number | null) => {
      // Flush any trailing partial line — best-effort; malformed trailing data
      // is still surfaced by parseStreamJson's parseErrors, not swallowed.
      if (lineBuffer.trim().length > 0) {
        stdout += "\n" + lineBuffer;
      }

      const parsed = parseStreamJson(stdout);
      const crashed = code !== 0 || parsed.result === null;

      resolve({
        ...parsed,
        exitCode: code,
        crashed,
        stderr,
      });
    });
  });
}

export interface SessionRecord {
  seasonId: string;
  sessionId: string | null;
  updatedAt: string;
}

export interface SessionStore {
  load(seasonId: string): Promise<SessionRecord | null>;
  save(record: SessionRecord): Promise<void>;
}

/** In-memory SessionStore — used by tests and as a building block; production wiring uses FileSessionStore. */
export class InMemorySessionStore implements SessionStore {
  private records = new Map<string, SessionRecord>();

  async load(seasonId: string): Promise<SessionRecord | null> {
    return this.records.get(seasonId) ?? null;
  }

  async save(record: SessionRecord): Promise<void> {
    this.records.set(record.seasonId, record);
  }
}

/**
 * Whitelists the shape of a seasonId before it is ever joined into a
 * filesystem path or used as an event-bus channel key. seasonId is sourced
 * from an HTTP route param (no auth/CORS gate in front of this server), so a
 * value like `../../etc/passwd` must never reach `path.join` or `FileSessionStore`
 * unvalidated — see FileSessionStore.pointerPath.
 */
export function isValidSeasonId(seasonId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(seasonId);
}

/**
 * Persists the session pointer to `<canonRoot>/seasons/<seasonId>/.yts-session.json`,
 * atomically (temp-file + rename), per the design doc's single-writer file convention.
 */
export class FileSessionStore implements SessionStore {
  constructor(private readonly canonRoot: string) {}

  private pointerPath(seasonId: string): string {
    if (!isValidSeasonId(seasonId)) {
      throw new Error(`Invalid seasonId: ${JSON.stringify(seasonId)}`);
    }
    return path.join(this.canonRoot, "seasons", seasonId, ".yts-session.json");
  }

  async load(seasonId: string): Promise<SessionRecord | null> {
    try {
      const raw = await readFile(this.pointerPath(seasonId), "utf-8");
      return JSON.parse(raw) as SessionRecord;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  async save(record: SessionRecord): Promise<void> {
    const finalPath = this.pointerPath(record.seasonId);
    const dir = path.dirname(finalPath);
    await mkdir(dir, { recursive: true });
    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(record, null, 2), "utf-8");
    await rename(tmpPath, finalPath);
  }
}

export interface SendMessageOptions {
  onEvent?: (rawEvent: unknown) => void;
  spawnFn?: SpawnFn;
}

/**
 * Ties `runTurn` to a `SessionStore`: loads the recorded session id (if any),
 * spawns with `--resume` against it when present, then re-persists whatever
 * session id the turn's own output reports — even if it differs from the one
 * that was resumed (see the module docstring).
 */
export class SeasonSessionManager {
  constructor(
    private readonly store: SessionStore,
    private readonly spawnFn?: SpawnFn,
  ) {}

  async sendMessage(
    seasonId: string,
    prompt: string,
    options: SendMessageOptions = {},
  ): Promise<RunTurnResult> {
    if (!isValidSeasonId(seasonId)) {
      throw new Error(`Invalid seasonId: ${JSON.stringify(seasonId)}`);
    }

    const existing = await this.store.load(seasonId);
    const resumeSessionId = existing?.sessionId ?? null;

    const result = await runTurn({
      seasonId,
      prompt,
      resumeSessionId,
      spawnFn: options.spawnFn ?? this.spawnFn,
      onEvent: options.onEvent,
    });

    if (result.sessionId) {
      await this.store.save({
        seasonId,
        sessionId: result.sessionId,
        updatedAt: new Date().toISOString(),
      });
    }

    return result;
  }
}
