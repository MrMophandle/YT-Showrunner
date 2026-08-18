/**
 * Season Chat view — route `/seasons/:seasonId/chat`. Composer + live
 * transcript + three side panels (Draft Preview, Signoff, Diagnostics).
 *
 * Diagnostics is now the real DiagnosticsPanel (Phase 5: real context-usage
 * math from stream-json `usage` blocks + best-effort plan usage via the
 * statusLine probe). Signoff is the real SignoffPanel (Phase 4:
 * approve/reject-with-notes).
 *
 * Phase 3: the composer now actually sends (AC-ENTRY-1), tracks
 * client-local "pending" (queued-behind-an-in-flight-turn) messages until
 * their synthetic user echo arrives over SSE (AC-ASYNC-2), and surfaces
 * `yts_error` crash events with their discarded messages restored into the
 * composer (AC-ERROR-2).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { groupIntoTurns, type NormalizedTurn } from "../../server/stream-parser.js";
import { computeContextUsage, CONTEXT_WARNING_THRESHOLD_RATIO, CONTEXT_WINDOW_TOKENS, DiagnosticsPanel } from "../components/DiagnosticsPanel.js";
import { DraftPreview } from "../components/DraftPreview.js";
import { SignoffPanel } from "../components/SignoffPanel.js";
import { TranscriptTurn } from "../components/TranscriptTurn.js";

/** Minimal surface of `EventSource` this component depends on — lets tests inject a fake. */
interface EventSourceLike {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  close: () => void;
}

export interface SeasonChatProps {
  /** Injectable for tests — defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Injectable for tests — defaults to constructing a real `EventSource`. */
  eventSourceFactory?: (url: string) => EventSourceLike;
}

export function SeasonChat({ fetchFn = fetch, eventSourceFactory = (url: string) => new EventSource(url) }: SeasonChatProps = {}) {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [rawEvents, setRawEvents] = useState<Array<Record<string, unknown>>>([]);
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<string[]>([]);

  useEffect(() => {
    if (!seasonId) return;

    // The server keeps the current-turn buffer independent of subscriber
    // connection state (AC-ASYNC-1); the browser's EventSource itself
    // auto-reconnects on drop, and the server replays missed events via
    // `?since=` on the next connection this component doesn't need to drive
    // that resume logic manually — SeasonEventBus.subscribe (server side)
    // already returns the missed buffer on (re)connect.
    const source = eventSourceFactory(`/api/seasons/${encodeURIComponent(seasonId)}/events`);

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
    // eventSourceFactory is intentionally excluded: its default value is a fresh
    // closure on every render (default params are re-evaluated per call), and
    // re-running this effect on every render would tear down and reopen the SSE
    // connection constantly. The factory only needs to be read once, at the
    // point this effect (re)establishes the connection for a given seasonId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);

  // Memoize turn grouping to avoid re-grouping on every render. groupIntoTurns()
  // is O(n) and walks the entire event array, so memoizing prevents unnecessary
  // work when other state (like composer value) changes without affecting rawEvents.
  const turns: NormalizedTurn[] = useMemo(() => groupIntoTurns(rawEvents).turns, [rawEvents]);

  // AC-ASYNC-2: drop the oldest pending entry each time a NEW user-role turn
  // appears in `turns`. The server drains queued messages strictly FIFO, so
  // oldest-pending-out matches oldest-turn-in — no identity/content matching
  // needed. A ref tracks the user-turn count as of the last time we checked,
  // so we only pop once per newly-arrived turn.
  const lastUserTurnCountRef = useRef(0);
  useEffect(() => {
    const userTurnCount = turns.filter((turn) => turn.role === "user").length;
    const newUserTurns = userTurnCount - lastUserTurnCountRef.current;
    if (newUserTurns > 0) {
      setPendingMessages((prev) => prev.slice(newUserTurns));
    }
    lastUserTurnCountRef.current = userTurnCount;
  }, [turns]);

  // AC-ERROR-2: surface each `yts_error` SSE event once — restore its
  // discardedMessages (joined in array order) into the composer, appended to
  // whatever the user has already typed since, and clear the pending list
  // (the server already discarded those queued turns). A ref counts how many
  // yts_error events have been processed so re-renders don't re-append.
  const ytsErrors = useMemo(
    () => rawEvents.filter((event) => event.type === "yts_error"),
    [rawEvents],
  );
  const processedYtsErrorCountRef = useRef(0);
  useEffect(() => {
    if (ytsErrors.length <= processedYtsErrorCountRef.current) return;
    const newErrors = ytsErrors.slice(processedYtsErrorCountRef.current);
    const restoredText = newErrors
      .flatMap((event) => (Array.isArray(event.discardedMessages) ? (event.discardedMessages as string[]) : []))
      .join("\n\n");
    if (restoredText.length > 0) {
      setComposerValue((prev) => (prev.length > 0 ? `${prev}\n${restoredText}` : restoredText));
    }
    setPendingMessages([]);
    processedYtsErrorCountRef.current = ytsErrors.length;
  }, [ytsErrors]);

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

  // AC-ENTRY-1: send the trimmed composer value to the turn-runner. A 202
  // means the turn was queued behind one already in flight (AC-ASYNC-2) — the
  // message goes on the pending list until its echo arrives over SSE. A 200
  // means the turn started immediately; it's never added to pending, its
  // echo will simply appear in the transcript directly.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = composerValue.trim();
    setComposerValue("");
    if (trimmed.length === 0) return;

    setSending(true);
    void fetchFn(`/api/seasons/${encodeURIComponent(seasonId)}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed }),
    })
      .then((res) => {
        if (res.status === 202) {
          setPendingMessages((prev) => [...prev, trimmed]);
        }
      })
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <div className="season-chat">
      {nearingContextLimit && (
        <p role="alert" className="season-chat__context-warning" data-testid="transcript-context-warning">
          This conversation is nearing its context limit — the current turn will still complete normally.
        </p>
      )}

      {ytsErrors.length > 0 && (
        <div className="season-chat__errors" data-testid="yts-errors">
          {ytsErrors.map((event, index) => (
            <p role="alert" key={index}>
              {typeof event.error === "string" ? event.error : "The season-drafting process crashed."}
            </p>
          ))}
        </div>
      )}

      <section className="season-chat__transcript" aria-label="Transcript" data-testid="transcript">
        {turns.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          turns.map((turn, index) => <TranscriptTurn key={`${turn.messageId || "turn"}-${index}`} turn={turn} />)
        )}
      </section>

      <form className="season-chat__composer" aria-label="Composer" onSubmit={handleSubmit}>
        <label htmlFor="season-chat-composer-input">Message</label>
        <textarea
          id="season-chat-composer-input"
          value={composerValue}
          onChange={(event) => setComposerValue(event.target.value)}
          placeholder="Talk through the season..."
        />
        <button type="submit" disabled={sending}>
          Send
        </button>
      </form>

      {pendingMessages.length > 0 && (
        <ul className="season-chat__pending" aria-label="Pending messages" data-testid="pending-messages">
          {pendingMessages.map((message, index) => (
            <li key={index} data-testid="pending-message">
              {message}
            </li>
          ))}
        </ul>
      )}

      <aside className="season-chat__panels">
        <DraftPreview seasonId={seasonId} fetchFn={fetchFn} />

        <SignoffPanel seasonId={seasonId} fetchFn={fetchFn} />

        <DiagnosticsPanel turns={turns} fetchFn={fetchFn} />
      </aside>
    </div>
  );
}
