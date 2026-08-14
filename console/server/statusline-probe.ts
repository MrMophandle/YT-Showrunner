/**
 * Best-effort read of a statusLine rate-limit snapshot for the Diagnostics
 * panel's plan-usage figure (AC-ERROR-6, AC-ERROR-2).
 *
 * Plan usage (5-hour / 7-day rolling Max-plan rate limits) is only exposed
 * via Claude Code's `statusLine` mechanism in *interactive* sessions —
 * headless `claude -p` spawns (season-session.ts) have no path to it. This
 * module therefore does NOT produce a snapshot itself; it only reads one
 * that some other interactive session may have written to a well-known
 * location. There is no live statusLine integration in this repo to test
 * against — this is an explicitly-flagged LOW-confidence empirical unknown
 * (see the task's Creative Exploration Needed #2), validated here via a
 * documented fallback shape, never a real `claude` CLI call. Tests exercise
 * this function purely against fixture/injected reads.
 *
 * Snapshot path: configurable via `YTS_STATUSLINE_SNAPSHOT_PATH`, mirroring
 * the `YTS_CANON_ROOT` / `YTS_CONSOLE_PORT` env-var convention in
 * `index.ts`. Default: `<os.tmpdir()>/yts-statusline-snapshot.json` — a
 * per-machine scratch location, since no interactive statusLine hook exists
 * yet to write it anywhere else. Whatever writes this file in the future is
 * OUT OF SCOPE for this task (see AC-ERROR-6's "no snapshot exists yet" is
 * an explicitly acceptable outcome).
 */

import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Snapshot shape a future interactive statusLine hook would write. Every field beyond `asOf` is optional — read defensively, never fabricated. */
export interface StatuslineSnapshot {
  asOf: string;
  fiveHourPercentUsed?: number;
  sevenDayPercentUsed?: number;
  resetsAt?: string;
}

/** Snapshots older than this are shown as "stale" (with their as-of time) rather than treated as current — AC-ERROR-6. Chosen to comfortably exceed the gap between statusLine renders in an active interactive session while still catching an abandoned/dead session's last snapshot. */
export const STATUSLINE_FRESHNESS_WINDOW_MS = 15 * 60 * 1000;

export const DEFAULT_STATUSLINE_SNAPSHOT_PATH = path.join(tmpdir(), "yts-statusline-snapshot.json");

export type StatuslineProbeResult =
  | ({ status: "fresh" } & StatuslineSnapshot)
  | ({ status: "stale" } & StatuslineSnapshot)
  | { status: "unavailable"; reason: "no_snapshot" | "unreadable" };

export interface ReadStatuslineOptions {
  /** Overrides DEFAULT_STATUSLINE_SNAPSHOT_PATH — used by tests to point at an isolated fixture path. */
  snapshotPath?: string;
  /** Injectable for tests — defaults to `fs/promises`' `readFile`, matching the DI pattern in draft-watcher.ts / canon-commit.ts. */
  readFileFn?: (filePath: string) => Promise<string>;
  /** Injectable clock for deterministic freshness-window tests. */
  now?: () => Date;
  freshnessWindowMs?: number;
}

/**
 * Type guard: ensures a parsed value matches StatuslineSnapshot shape.
 * All fields beyond `asOf` are optional — read defensively, never assume they exist.
 * Returns false for any type mismatch, missing `asOf`, or invalid optional fields.
 */
function isStatuslineSnapshot(value: unknown): value is StatuslineSnapshot {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.asOf !== "string" || candidate.asOf.length === 0) return false;
  if (candidate.fiveHourPercentUsed !== undefined && typeof candidate.fiveHourPercentUsed !== "number") return false;
  if (candidate.sevenDayPercentUsed !== undefined && typeof candidate.sevenDayPercentUsed !== "number") return false;
  if (candidate.resetsAt !== undefined && typeof candidate.resetsAt !== "string") return false;
  return true;
}

/**
 * Reads and validates the statusLine snapshot file. Never fabricates a
 * value: a missing file, an unparseable/malformed read, or an invalid
 * `asOf` timestamp all resolve to `status: "unavailable"` rather than
 * throwing or guessing — the caller (the `/api/statusline` route,
 * DiagnosticsPanel) must be able to render an explicit unavailable state
 * without a try/catch of its own.
 */
export async function readStatuslineSnapshot(options: ReadStatuslineOptions = {}): Promise<StatuslineProbeResult> {
  const snapshotPath = options.snapshotPath ?? DEFAULT_STATUSLINE_SNAPSHOT_PATH;
  const readFileFn = options.readFileFn ?? ((filePath: string) => readFile(filePath, "utf-8"));
  const now = options.now ?? (() => new Date());
  const freshnessWindowMs = options.freshnessWindowMs ?? STATUSLINE_FRESHNESS_WINDOW_MS;

  let raw: string;
  try {
    raw = await readFileFn(snapshotPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: "unavailable", reason: "no_snapshot" };
    }
    // Any other read failure (permissions, I/O error) — still an "unavailable" outcome to the
    // caller (AC-ERROR-6 never distinguishes causes to the user beyond the reason tag), never thrown.
    return { status: "unavailable", reason: "unreadable" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "unavailable", reason: "unreadable" };
  }

  if (!isStatuslineSnapshot(parsed)) {
    return { status: "unavailable", reason: "unreadable" };
  }

  const asOfMs = Date.parse(parsed.asOf);
  if (Number.isNaN(asOfMs)) {
    return { status: "unavailable", reason: "unreadable" };
  }

  const ageMs = now().getTime() - asOfMs;
  const status = ageMs > freshnessWindowMs ? "stale" : "fresh";
  return { status, ...parsed };
}
