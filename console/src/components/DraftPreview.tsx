/**
 * Live season-slate-in-progress view. The skill is the sole writer of
 * `season.draft.json`; this panel polls the server's read-only draft
 * endpoint (backed by `draft-watcher.ts`'s torn-read-safe `DraftWatcher`) and
 * re-renders whenever a new draft appears — no reload, no user action
 * (AC-HAPPY-3). A 204 (no draft yet) or any non-200 poll simply leaves the
 * last-rendered state alone rather than clearing it, mirroring the
 * watcher's own last-good-on-bad-read behavior (AC-ASYNC-3).
 */
import { useEffect, useState } from "react";
import type { SeasonDraft } from "../../server/draft-watcher.js";

export interface DraftPreviewProps {
  seasonId: string;
  /** Poll interval in ms — defaults to 1000ms to satisfy the sub-1s AC-HAPPY-3 target with margin. */
  pollIntervalMs?: number;
  /** Injectable for tests — defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}

export function DraftPreview({ seasonId, pollIntervalMs = 1000, fetchFn = fetch }: DraftPreviewProps) {
  const [draft, setDraft] = useState<SeasonDraft | null>(null);

  useEffect(() => {
    // The `cancelled` flag prevents state updates after the component unmounts.
    // This is necessary because setDraft() would throw a warning if we tried to
    // update state after the effect cleanup ran (component unmounted or deps changed).
    let cancelled = false;

    const poll = async () => {
      const res = await fetchFn(`/api/seasons/${encodeURIComponent(seasonId)}/draft`);
      if (cancelled) return;
      if (res.status === 200) {
        const data = (await res.json()) as SeasonDraft;
        if (!cancelled) setDraft(data);
      }
      // 204 (no draft yet) or any other status: keep showing whatever we already have (AC-ASYNC-3).
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [seasonId, pollIntervalMs, fetchFn]);

  if (!draft) {
    return (
      <section className="panel draft-preview" data-testid="draft-preview" aria-label="Draft Preview">
        <h3>Draft Preview</h3>
        <p className="draft-preview__empty">No draft yet.</p>
      </section>
    );
  }

  return (
    <section className="panel draft-preview" data-testid="draft-preview" aria-label="Draft Preview">
      <h3>Draft Preview — Season {draft.seasonNumber}</h3>
      <ul className="draft-preview__episodes">
        {draft.episodes.map((episode, index) => (
          <li className="draft-preview__episode" key={`${episode.title}-${index}`}>
            <strong className="draft-preview__title">{episode.title}</strong>
            <p className="draft-preview__logline">{episode.logline}</p>
            {episode.threads.length > 0 && (
              <ul className="draft-preview__threads" aria-label="Threads">
                {episode.threads.map((thread) => (
                  <li key={thread}>{thread}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
