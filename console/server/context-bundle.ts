/**
 * Assembles the canon context bundle handed to the first turn of a season's
 * drafting conversation (design doc decision 3: "First turn must be
 * context-seeded, never a cold-start").
 *
 * Reads real files from a configurable canon root — series overview,
 * character bibles, previous season summaries, and `continuity-ledger.md`'s
 * unresolved threads — and assembles them into a single prompt-prependable
 * string. Missing *optional* files (e.g. no previous seasons yet) are omitted
 * cleanly; nothing is ever fabricated to fill a gap (AC-HAPPY-1).
 *
 * Canon root convention (fixture-backed for this task; the real canon
 * migration is out of scope — see the task's Scope Boundaries):
 *   <canonRoot>/series-overview.md
 *   <canonRoot>/characters/*.md          (character bibles, one file each)
 *   <canonRoot>/seasons/<n>/season-*.md  (previous season summaries)
 *   <canonRoot>/continuity-ledger.md     (unresolved threads, read verbatim)
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isValidSeasonId } from "./season-session.js";

export interface NamedDoc {
  name: string;
  content: string;
}

export interface ContextBundle {
  seriesOverview: string | null;
  characterBibles: NamedDoc[];
  previousSeasonSummaries: NamedDoc[];
  /** Verbatim content of continuity-ledger.md, or null if the file doesn't exist. */
  unresolvedThreads: string | null;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/** Reads every regular file directly inside `dirPath`, or [] if the directory doesn't exist. */
async function readDirAsDocs(dirPath: string): Promise<NamedDoc[]> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }

  const docs: NamedDoc[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const content = await readFile(path.join(dirPath, entry.name), "utf-8");
    docs.push({ name: entry.name, content });
  }
  return docs;
}

/** Reads every `season-*.md` summary under each `<canonRoot>/seasons/<n>` directory, sorted by directory name. */
async function readPreviousSeasonSummaries(canonRoot: string): Promise<NamedDoc[]> {
  const seasonsDir = path.join(canonRoot, "seasons");
  let seasonDirs;
  try {
    seasonDirs = await readdir(seasonsDir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }

  const summaries: NamedDoc[] = [];
  for (const dirEntry of seasonDirs.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dirEntry.isDirectory()) continue;
    const dirPath = path.join(seasonsDir, dirEntry.name);
    const files = await readdir(dirPath, { withFileTypes: true });
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || !file.name.startsWith("season-") || !file.name.endsWith(".md")) continue;
      const content = await readFile(path.join(dirPath, file.name), "utf-8");
      summaries.push({ name: `${dirEntry.name}/${file.name}`, content });
    }
  }
  return summaries;
}

/**
 * Reads the canon files under `canonRoot` and assembles them into a
 * `ContextBundle`. `seasonId` is validated via `isValidSeasonId` (defense in
 * depth, matching `FileSessionStore`'s convention) even though this function
 * does not currently construct a season-scoped path from it beyond the
 * `seasons/<n>/` directories already covered by `readPreviousSeasonSummaries`.
 */
export async function assembleContextBundle(canonRoot: string, seasonId: string): Promise<ContextBundle> {
  if (!isValidSeasonId(seasonId)) {
    throw new Error(`Invalid seasonId: ${JSON.stringify(seasonId)}`);
  }

  const [seriesOverview, characterBibles, previousSeasonSummaries, unresolvedThreads] = await Promise.all([
    readFileIfExists(path.join(canonRoot, "series-overview.md")),
    readDirAsDocs(path.join(canonRoot, "characters")),
    readPreviousSeasonSummaries(canonRoot),
    readFileIfExists(path.join(canonRoot, "continuity-ledger.md")),
  ]);

  return { seriesOverview, characterBibles, previousSeasonSummaries, unresolvedThreads };
}

/**
 * Serializes a `ContextBundle` into the plain-text form prepended to the
 * first turn's prompt. Sections whose source file was absent are omitted
 * entirely — never rendered as an empty heading or a fabricated placeholder.
 */
export function renderContextBundle(bundle: ContextBundle): string {
  const sections: string[] = [];

  if (bundle.seriesOverview !== null) {
    sections.push(`## Series Overview\n\n${bundle.seriesOverview.trim()}`);
  }

  if (bundle.characterBibles.length > 0) {
    const bibles = bundle.characterBibles.map((doc) => doc.content.trim()).join("\n\n---\n\n");
    sections.push(`## Character Bibles\n\n${bibles}`);
  }

  if (bundle.previousSeasonSummaries.length > 0) {
    const summaries = bundle.previousSeasonSummaries.map((doc) => doc.content.trim()).join("\n\n---\n\n");
    sections.push(`## Previous Seasons\n\n${summaries}`);
  }

  if (bundle.unresolvedThreads !== null) {
    // Verbatim — this is the authoritative unresolved-thread text (AC-HAPPY-1); never
    // summarized or rewritten.
    sections.push(`## Continuity Ledger — Unresolved Threads (verbatim)\n\n${bundle.unresolvedThreads.trim()}`);
  }

  return sections.join("\n\n");
}

/**
 * Slash-command prefix that invokes the season-drafting skill inside the
 * headless `claude -p` process. Prepended to every first-turn prompt (never a
 * resumed turn) so the spawned process loads the skill before seeing any
 * canon context or the user's message.
 */
export const SEASON_DRAFTING_SKILL_COMMAND = "/season-drafting";

export interface BuildTurnPromptOptions {
  /** True when a session id has already been recorded for this season (a resumed turn). */
  hasExistingSession: boolean;
  /** Pre-rendered context bundle text (see `renderContextBundle`). Ignored on resumed turns. */
  contextBundleText: string;
  userMessage: string;
  /**
   * Absolute show-level canon root (holds `series-overview.md`, `characters/`,
   * `continuity-ledger.md`) — NOT season-scoped. Stated on the first turn only
   * (AC-PATH-1); ignored on resumed turns, since the resumed session already
   * carries it (AC-PATH-3).
   */
  canonRoot: string;
  /**
   * The route's authoritative season id. Used to state the absolute resolved
   * draft path on the first turn — verbatim, regardless of what season number
   * the conversation itself discusses (AC-SEASON-1). Ignored on resumed turns.
   */
  seasonId: string;
}

/** Builds the absolute path to a season's draft file under `canonRoot`, using `seasonId` verbatim. */
function resolveDraftPath(canonRoot: string, seasonId: string): string {
  return path.join(canonRoot, "seasons", seasonId, "season.draft.json");
}

/**
 * Plain-text statement of the show canon root and the resolved draft path,
 * prepended ahead of the context bundle on the first turn only. The two facts
 * are stated distinctly (AC-PATH-2) — the canon root is show-scoped (read
 * canon from here), the draft path is season-scoped (write the draft here) —
 * never merged into a single path string.
 */
function renderPathFacts(canonRoot: string, seasonId: string): string {
  const draftPath = resolveDraftPath(canonRoot, seasonId);
  return (
    `The show canon root for this run is: ${canonRoot}\n` +
    `This is the SHOW-level canon root (holding series-overview.md, characters/, and continuity-ledger.md) — it is NOT season-scoped.\n\n` +
    `The season you are drafting is "${seasonId}" (authoritative — this is the season selected in the console, regardless of what season number comes up in conversation).\n` +
    `Write and maintain the draft file at this exact absolute path: ${draftPath}`
  );
}

/**
 * Decides the actual prompt string sent to `runTurn`/`SeasonSessionManager.sendMessage`:
 * the context bundle precedes the user's message on the first turn only; every
 * later (resumed) turn sends just the user's message, since the bundle already
 * lives in the resumed session's history (AC-HAPPY-2). First turns are also
 * prefixed with `SEASON_DRAFTING_SKILL_COMMAND` so the headless process loads
 * the season-drafting skill before anything else — including when the bundle
 * itself is empty (no canon files yet), in which case the prefix still leads
 * straight into the user's message with no fabricated bundle section.
 */
export function buildTurnPrompt(options: BuildTurnPromptOptions): string {
  if (options.hasExistingSession) {
    return options.userMessage;
  }

  const pathFacts = renderPathFacts(options.canonRoot, options.seasonId);
  const bundleAndPathFacts =
    options.contextBundleText.trim().length === 0
      ? pathFacts
      : `${pathFacts}\n\n---\n\n${options.contextBundleText}`;

  return `${SEASON_DRAFTING_SKILL_COMMAND} ${bundleAndPathFacts}\n\n---\n\n${options.userMessage}`;
}
