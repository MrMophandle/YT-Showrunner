/**
 * Season Chat view — route `/seasons/:seasonId/chat`. Composer + live
 * transcript + three side panels (Draft Preview, Signoff, Diagnostics).
 *
 * Diagnostics is now the real DiagnosticsPanel (Phase 5: real context-usage
 * math from stream-json `usage` blocks + best-effort plan usage via the
 * statusLine probe). Signoff is the real SignoffPanel (Phase 4:
 * approve/reject-with-notes).
 *
 * Message-send wiring (spawning a turn from the composer) is deliberately
 * NOT implemented here: its behavior is defined by ACs that belong to later
 * phases (AC-ERROR-1's retry/crash handling, AC-ASYNC-4's in-flight/queueing
 * rules) — wiring a naive POST now would just be rework once those land.
 * This phase's AC-ENTRY-1 only requires the composer to be present and
 * enabled, which it is.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { groupIntoTurns, type NormalizedTurn } from "../../server/stream-parser.js";
import { computeContextUsage, CONTEXT_WARNING_THRESHOLD_RATIO, CONTEXT_WINDOW_TOKENS, DiagnosticsPanel } from "../components/DiagnosticsPanel.js";
import { DraftPreview } from "../components/DraftPreview.js";
import { SignoffPanel } from "../components/SignoffPanel.js";
import { TranscriptTurn } from "../components/TranscriptTurn.js";

export function SeasonChat() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [rawEvents, setRawEvents] = useState<Array<Record<string, unknown>>>([]);
  const [composerValue, setComposerValue] = useState("");

  useEffect(() => {
    if (!seasonId) return;

    // The server keeps the current-turn buffer independent of subscriber
    // connection state (AC-ASYNC-1); the browser's EventSource itself
    // auto-reconnects on drop, and the server replays missed events via
    // `?since=` on the next connection this component doesn't need to drive
    // that resume logic manually — SeasonEventBus.subscribe (server side)
    // already returns the missed buffer on (re)connect.
    const source = new EventSource(`/api/seasons/${encodeURIComponent(seasonId)}/events`);

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as { seq: number; payload: unknown };
        setRawEvents((prev) => [...prev, parsed.payload as Record<string, unknown>]);
      } catch (err) {
        // Malformed SSE payload — surfaced, never silently dropped.
        // eslint-disable-next-line no-console -- browser-side stream error, no server logger available here
        console.error("SeasonChat: failed to parse SSE event", event.data, err);
      }
    };

    return () => source.close();
  }, [seasonId]);

  // Memoize turn grouping to avoid re-grouping on every render. groupIntoTurns()
  // is O(n) and walks the entire event array, so memoizing prevents unnecessary
  // work when other state (like composer value) changes without affecting rawEvents.
  const turns: NormalizedTurn[] = useMemo(() => groupIntoTurns(rawEvents).turns, [rawEvents]);

  // AC-ERROR-5: the transcript-side half of the context-window warning. The
  // Diagnostics panel's own warning state (rendered inside DiagnosticsPanel)
  // is the primary requirement; this banner reuses the same pure
  // computeContextUsage function against the same `turns` already in scope
  // here, rather than re-deriving usage independently.
  const contextUsage = useMemo(() => computeContextUsage(turns), [turns]);
  // Warning fires once usage crosses 80% of the 200k-token context window (160k tokens).
  // This gives the user a clear margin to wrap up before hitting the hard wall.
  const nearingContextLimit =
    contextUsage !== null && contextUsage.totalTokens / CONTEXT_WINDOW_TOKENS >= CONTEXT_WARNING_THRESHOLD_RATIO;

  if (!seasonId) {
    return <p role="alert">No season selected.</p>;
  }

  return (
    <div className="season-chat">
      {nearingContextLimit && (
        <p role="alert" className="season-chat__context-warning" data-testid="transcript-context-warning">
          This conversation is nearing its context limit — the current turn will still complete normally.
        </p>
      )}

      <section className="season-chat__transcript" aria-label="Transcript" data-testid="transcript">
        {turns.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          turns.map((turn, index) => <TranscriptTurn key={`${turn.messageId || "turn"}-${index}`} turn={turn} />)
        )}
      </section>

      <form
        className="season-chat__composer"
        aria-label="Composer"
        onSubmit={(event) => {
          event.preventDefault();
          setComposerValue("");
        }}
      >
        <label htmlFor="season-chat-composer-input">Message</label>
        <textarea
          id="season-chat-composer-input"
          value={composerValue}
          onChange={(event) => setComposerValue(event.target.value)}
          placeholder="Talk through the season..."
        />
        <button type="submit">Send</button>
      </form>

      <aside className="season-chat__panels">
        <DraftPreview seasonId={seasonId} />

        <SignoffPanel seasonId={seasonId} />

        <DiagnosticsPanel turns={turns} />
      </aside>
    </div>
  );
}
