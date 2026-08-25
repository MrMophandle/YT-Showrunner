/**
 * Renders one chat turn in the Season Chat transcript — the frontend
 * counterpart to `stream-parser.ts`'s `NormalizedTurn`. Text, tool calls, and
 * (when present) thinking are shown; thinking is collapsed by default behind
 * a native `<details>` disclosure so the transcript stays scannable.
 */
import type { NormalizedTurn } from "../../server/stream-parser.js";

export interface TranscriptTurnProps {
  turn: NormalizedTurn;
}

export function TranscriptTurn({ turn }: TranscriptTurnProps) {
  // A turn with nothing to show renders nothing — not a bare role label above
  // empty space. The CLI emits assistant events carrying an empty-string
  // `thinking` block; grouping folds most of them into a sibling event's turn,
  // but a run made up entirely of them still produces a contentless turn.
  //
  // Note this guard lives here and NOT in groupIntoTurns: such a turn can
  // carry the only `usage` block in a stream, so the turn object must survive
  // for computeContextUsage. It just must not draw anything.
  const hasContent = turn.text.length > 0 || turn.thinking.length > 0 || turn.toolCalls.length > 0;
  if (!hasContent) {
    return null;
  }

  return (
    <article
      className={`transcript-turn transcript-turn--${turn.role}`}
      data-testid="transcript-turn"
      aria-label={`${turn.role} turn`}
    >
      <header className="transcript-turn__role">{turn.role}</header>

      {turn.text.length > 0 && <p className="transcript-turn__text">{turn.text}</p>}

      {turn.toolCalls.length > 0 && (
        <ul className="transcript-turn__tool-calls" aria-label="Tool calls">
          {turn.toolCalls.map((call, index) => (
            <li key={call.id ?? index}>{call.name ?? "unknown tool"}</li>
          ))}
        </ul>
      )}

      {turn.thinking.length > 0 && (
        <details className="transcript-turn__thinking">
          <summary>Thinking</summary>
          <p>{turn.thinking}</p>
        </details>
      )}
    </article>
  );
}
