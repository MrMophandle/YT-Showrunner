/**
 * Watches a season's draft file for the Draft Preview panel.
 *
 * The season-drafting skill (`.claude/skills/season-drafting/SKILL.md`) is the
 * SOLE writer of `<CANON_ROOT>/seasons/<seasonId>/season.draft.json`, and it
 * writes atomically (temp-file + rename), matching `FileSessionStore.save` in
 * `season-session.ts`. This watcher only ever reads. Per AC-ASYNC-3, a
 * partial/unparseable read (which should be rare given the atomic-write
 * convention, but must never be trusted blindly) is discarded and retried on
 * the next poll rather than surfaced to the UI — the panel keeps showing the
 * last-good draft it already had in memory.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isValidSeasonId } from "./season-session.js";

export interface SeasonDraftEpisode {
  title: string;
  logline: string;
  threads: string[];
}

export interface SeasonDraft {
  seasonNumber: number;
  episodes: SeasonDraftEpisode[];
  updatedAt: string;
}

/**
 * Structural validation of a parsed draft — guards against a well-formed-JSON-but-wrong-shape read.
 * This is crucial for the "last-good-state" pattern: a torn write mid-rename could produce valid
 * JSON that fails validation, and we must not crash on it — just retry on the next poll.
 */
function isSeasonDraft(value: unknown): value is SeasonDraft {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.seasonNumber !== "number") return false;
  if (typeof candidate.updatedAt !== "string") return false;
  if (candidate.episodes === undefined) return true;
  return Array.isArray(candidate.episodes);
}

/** Normalizes a validated draft — an omitted `episodes` field reads as no episodes yet. */
function normalize(draft: SeasonDraft): SeasonDraft {
  return { ...draft, episodes: draft.episodes ?? [] };
}

type DraftListener = (draft: SeasonDraft) => void;

export interface DraftWatcherOptions {
  canonRoot: string;
  seasonId: string;
  /** Poll interval for `start()`; irrelevant when only calling `pollOnce()` directly (e.g. in tests). */
  intervalMs?: number;
  /** Injectable for tests — defaults to `fs/promises`' `readFile`. */
  readFileFn?: (filePath: string) => Promise<string>;
}

export interface PollResult {
  /** True only when this poll produced a NEW valid draft (torn/missing reads are never "updated"). */
  updated: boolean;
  /** The current last-good draft, or null if none has ever been read successfully. */
  draft: SeasonDraft | null;
}

/**
 * Polls a season's `season.draft.json`, keeping the last successfully parsed
 * draft in memory and never surfacing a torn or missing read as a change.
 */
export class DraftWatcher {
  private readonly filePath: string;
  private readonly readFileFn: (filePath: string) => Promise<string>;
  private lastGood: SeasonDraft | null = null;
  private readonly listeners = new Set<DraftListener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DraftWatcherOptions) {
    if (!isValidSeasonId(options.seasonId)) {
      throw new Error(`Invalid seasonId: ${JSON.stringify(options.seasonId)}`);
    }
    this.filePath = path.join(options.canonRoot, "seasons", options.seasonId, "season.draft.json");
    this.readFileFn = options.readFileFn ?? ((filePath) => readFile(filePath, "utf-8"));
    this.intervalMs = options.intervalMs ?? 500;
  }

  private readonly intervalMs: number;

  getLastGood(): SeasonDraft | null {
    return this.lastGood;
  }

  onUpdate(listener: DraftListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Reads the draft file once. A missing file (no draft written yet), an
   * unparseable read (torn write caught mid-rename), or a structurally
   * invalid draft are all treated the same way: keep serving `lastGood`,
   * report `updated: false`, and let the next poll retry — never throw, never
   * clear a good draft on a bad read (AC-ASYNC-3).
   */
  async pollOnce(): Promise<PollResult> {
    let raw: string;
    try {
      raw = await this.readFileFn(this.filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { updated: false, draft: this.lastGood };
      }
      // Any other read failure (permissions, I/O error) is surfaced, never swallowed.
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Torn/partial read (or genuinely malformed file) — discard, keep last-good, retry next poll.
      return { updated: false, draft: this.lastGood };
    }

    if (!isSeasonDraft(parsed)) {
      return { updated: false, draft: this.lastGood };
    }

    this.lastGood = normalize(parsed);
    for (const listener of this.listeners) {
      listener(this.lastGood);
    }
    return { updated: true, draft: this.lastGood };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.pollOnce().catch((err) => {
        // No silent failures: surface via a synthetic error listener path is
        // overkill for a background poll — log so it isn't lost.
        // eslint-disable-next-line no-console -- watcher background-loop failure, not a request-path log
        console.error(`draft-watcher: poll failed for ${this.filePath}`, err);
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
