/**
 * Commits an approved SeasonDraft to canon (AC-HAPPY-4). Two writes, both
 * atomic (temp-file + rename), matching `FileSessionStore.save`'s pattern in
 * `season-session.ts`:
 *
 *  1. A rendered markdown slate at `<canonRoot>/seasons/<seasonId>/season-<n>.md`.
 *  2. A dated section appended to `<canonRoot>/continuity-ledger.md` listing
 *     the threads the approved episodes addressed.
 *
 * This is a pure "commit exactly what's already in the draft" operation —
 * no regeneration, no second model call. Fuzzy-matching/removing entries
 * from the ledger's existing "Unresolved Threads" section is deliberately
 * out of scope (unreliable without a real cross-reference step); this
 * module only ever appends.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidSeasonId } from "./season-session.js";
import type { SeasonDraft } from "./draft-watcher.js";

export interface CommitDraftOptions {
  canonRoot: string;
  seasonId: string;
  draft: SeasonDraft;
  /** Injectable for tests — defaults to the real fs/promises equivalents. */
  mkdirFn?: (dir: string) => Promise<unknown>;
  writeFileFn?: (filePath: string, data: string) => Promise<void>;
  renameFn?: (from: string, to: string) => Promise<void>;
  readFileFn?: (filePath: string) => Promise<string>;
}

export interface CommitDraftResult {
  seasonFile: string;
  ledgerFile: string;
}

function renderSeasonMarkdown(draft: SeasonDraft): string {
  const lines = [`# Season ${draft.seasonNumber}`, ""];
  draft.episodes.forEach((episode, index) => {
    lines.push(`## Episode ${index + 1}: ${episode.title}`, "", episode.logline, "");
    if (episode.threads.length > 0) {
      lines.push(`Threads: ${episode.threads.join(", ")}`, "");
    }
  });
  return lines.join("\n");
}

function renderLedgerSection(draft: SeasonDraft, approvedAtDate: string): string {
  const lines = [`## Season ${draft.seasonNumber} — Approved ${approvedAtDate}`, ""];
  for (const episode of draft.episodes) {
    const threadsPart = episode.threads.length > 0 ? `: ${episode.threads.join(", ")}` : "";
    lines.push(`- Episode "${episode.title}"${threadsPart}`);
  }
  return lines.join("\n") + "\n";
}

async function atomicWrite(
  finalPath: string,
  content: string,
  writeFileFn: (filePath: string, data: string) => Promise<void>,
  renameFn: (from: string, to: string) => Promise<void>,
  mkdirFn: (dir: string) => Promise<unknown>,
): Promise<void> {
  const dir = path.dirname(finalPath);
  await mkdirFn(dir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFileFn(tmpPath, content);
  await renameFn(tmpPath, finalPath);
}

export async function commitDraftToCanon(options: CommitDraftOptions): Promise<CommitDraftResult> {
  if (!isValidSeasonId(options.seasonId)) {
    throw new Error(`Invalid seasonId: ${JSON.stringify(options.seasonId)}`);
  }

  const mkdirFn = options.mkdirFn ?? ((dir: string) => mkdir(dir, { recursive: true }));
  const writeFileFn = options.writeFileFn ?? ((filePath: string, data: string) => writeFile(filePath, data, "utf-8"));
  const renameFn = options.renameFn ?? rename;
  const readFileFn = options.readFileFn ?? ((filePath: string) => readFile(filePath, "utf-8"));

  const seasonFile = path.join(
    options.canonRoot,
    "seasons",
    options.seasonId,
    `season-${options.draft.seasonNumber}.md`,
  );
  const ledgerFile = path.join(options.canonRoot, "continuity-ledger.md");

  await atomicWrite(seasonFile, renderSeasonMarkdown(options.draft), writeFileFn, renameFn, mkdirFn);

  let existingLedger = "";
  try {
    existingLedger = await readFileFn(ledgerFile);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
    // No ledger yet — starting fresh is expected, not an error.
  }

  const approvedAtDate = new Date().toISOString().slice(0, 10);
  const section = renderLedgerSection(options.draft, approvedAtDate);
  const newLedgerContent = existingLedger.trim().length > 0 ? `${existingLedger.trimEnd()}\n\n${section}` : section;

  await atomicWrite(ledgerFile, newLedgerContent, writeFileFn, renameFn, mkdirFn);

  return { seasonFile, ledgerFile };
}
