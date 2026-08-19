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

/**
 * Permission posture for the spawned `claude -p` process.
 * - "tight" (default): an explicit `--allowedTools` allowlist — the narrowest grant
 *   that permits the season-drafting skill to read canon and atomically write
 *   `season.draft.json` (temp file + rename).
 * - "dangerously-skip-permissions": opt-in escape hatch via YTS_PERMISSION_MODE.
 */
export type PermissionMode = "tight" | "dangerously-skip-permissions";

/**
 * The tight `--allowedTools` allowlist, passed to the CLI as a single
 * comma-separated string arg (no documented prior-art in this repo for
 * repeated-flag vs. comma-separated syntax, so comma-separated is chosen as
 * the simplest form `claude -p --allowedTools` accepts).
 *
 * Sized for exactly what the season-drafting skill needs (see SKILL.md's
 * "write atomically" convention, mirroring FileSessionStore.save):
 * - `Read`   — read canon files under YTS_CANON_ROOT.
 * - `Write`  — write the temp draft file.
 * - `Bash(mv *)` — narrowly-scoped rename-into-place step for the atomic
 *   write; NOT a bare `Bash` grant, so the process cannot run arbitrary
 *   shell commands. Space-separated (not colon-separated) to match this
 *   repo's existing Bash-permission-pattern precedent (`.claude/settings.local.json`,
 *   e.g. `"Bash(git status *)"`, `"Bash(git diff *)"`) and the CLI's own
 *   `--help` example (`"Bash(git *) Edit"`).
 */
export const ALLOWED_TOOLS: readonly string[] = ["Read", "Write", "Bash(mv *)"];

/** Documented opt-in token for YTS_PERMISSION_MODE (AC-PERM-3). Any other value, unset, or empty keeps "tight". */
const DANGEROUSLY_SKIP_PERMISSIONS_TOKEN = "dangerously-skip-permissions";

/** Reads YTS_PERMISSION_MODE fresh on every call (not memoized) so tests can stub the env per-case. */
export function resolvePermissionMode(): PermissionMode {
  return process.env.YTS_PERMISSION_MODE === DANGEROUSLY_SKIP_PERMISSIONS_TOKEN
    ? "dangerously-skip-permissions"
    : "tight";
}

/** Logs a one-line startup warning naming the reduced safety posture when the escape hatch is active; no-op otherwise. */
export function warnIfPermissionsDisabled(mode: PermissionMode): void {
  if (mode === "dangerously-skip-permissions") {
    console.warn(
      "[season-session] YTS_PERMISSION_MODE=dangerously-skip-permissions is set — " +
        "spawned `claude -p` processes will run with ALL permission checks disabled " +
        "(reduced safety posture). Unset YTS_PERMISSION_MODE to restore the tight --allowedTools allowlist.",
    );
  }
}

// Resolved once at module load — this module is only ever imported by the long-lived
// server process, not per-turn, so module-load time is process-startup time.
const defaultPermissionMode = resolvePermissionMode();
warnIfPermissionsDisabled(defaultPermissionMode);

export function buildArgs(
  prompt: string,
  resumeSessionId?: string | null,
  permissionMode: PermissionMode = defaultPermissionMode,
): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  if (permissionMode === "dangerously-skip-permissions") {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--allowedTools", ALLOWED_TOOLS.join(","));
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
