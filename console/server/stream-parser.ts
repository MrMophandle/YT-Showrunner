/**
 * Parses `claude -p --output-format stream-json` stdout into normalized turn
 * events for the Season Chat transcript.
 *
 * Adapted from `.agent-logs/claude_transcript_to_md.py`'s `group_into_turns()`
 * (Python, reads a persisted JSONL transcript file) into TypeScript, operating
 * on the live stream-json event lines emitted by a headless `claude -p` run
 * instead. The grouping rule is the same: a "turn" starts at each user/assistant
 * message event and accumulates trailing tool_result events (which stream-json
 * emits as their own `user` events) until the next message starts a new turn.
 *
 * Deliberately NOT implemented here: subagent-sidecar (`<session>/subagents/*.jsonl`)
 * parsing. season-drafting is single-agent (no Task-tool fan-out) — see the task's
 * Scope Boundaries / Plan Critique for why that mechanism belongs to the deferred
 * Season Desk audit feature instead.
 */

/** Anthropic API usage-block field names (see `.agent-logs/claude_telemetry.py`'s USAGE_KEYS). */
export interface UsageBlock {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

export interface ToolUseBlock {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: unknown;
}

export interface ToolResultEvent {
  raw: unknown;
}

/** One normalized conversational turn, grouped from raw stream-json events. */
export interface NormalizedTurn {
  role: "user" | "assistant";
  text: string;
  thinking: string;
  toolCalls: ToolUseBlock[];
  toolResults: ToolResultEvent[];
  timestamp: string;
  messageId: string;
  usage?: UsageBlock;
}

/** The terminal `result` event stream-json emits at the end of a run. */
export interface ResultEvent {
  subtype: string;
  isError: boolean;
  result?: string;
  sessionId?: string;
  usage?: UsageBlock;
  totalCostUsd?: number;
}

/** A raw line that could not be parsed as JSON — surfaced, never silently dropped (no-silent-failures NFR). */
export interface ParseErrorEvent {
  type: "parse_error";
  lineNumber: number;
  error: string;
  rawLine: string;
}

export interface ParsedStream {
  turns: NormalizedTurn[];
  unknownEvents: unknown[];
  parseErrors: ParseErrorEvent[];
  result: ResultEvent | null;
  /** Session id observed anywhere in the stream — re-read fresh each call, never assumed carried over. */
  sessionId: string | null;
}

/** Parses one raw stdout line into a JSON event, or a ParseErrorEvent if it isn't valid JSON. */
export function parseStreamLine(
  line: string,
  lineNumber: number,
): Record<string, unknown> | ParseErrorEvent {
  try {
    const parsed = JSON.parse(line);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        type: "parse_error",
        lineNumber,
        error: "Parsed value is not a JSON object",
        rawLine: line,
      };
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    return {
      type: "parse_error",
      lineNumber,
      error: err instanceof Error ? err.message : String(err),
      rawLine: line,
    };
  }
}

function isParseError(event: unknown): event is ParseErrorEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { type?: unknown }).type === "parse_error" &&
    "lineNumber" in event
  );
}

function extractContentParts(content: unknown): {
  text: string[];
  thinking: string[];
  toolCalls: ToolUseBlock[];
} {
  const text: string[] = [];
  const thinking: string[] = [];
  const toolCalls: ToolUseBlock[] = [];

  if (typeof content === "string") {
    text.push(content);
    return { text, thinking, toolCalls };
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === "object") {
        const block = item as Record<string, unknown>;
        if (block.type === "tool_use") {
          toolCalls.push(block as unknown as ToolUseBlock);
        } else if (block.type === "text") {
          text.push(typeof block.text === "string" ? block.text : "");
        } else if (block.type === "thinking") {
          thinking.push(typeof block.thinking === "string" ? block.thinking : "");
        }
      }
    }
  }

  return { text, thinking, toolCalls };
}

function hasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (item) =>
        item && typeof item === "object" && (item as Record<string, unknown>).type === "tool_result",
    )
  );
}

/**
 * Groups already-parsed stream-json event objects into NormalizedTurns.
 * Mirrors `group_into_turns()`: a user/assistant message event starts a new
 * turn; a user message whose content is entirely tool_result blocks is
 * appended to the CURRENT turn instead of starting a new one; `result`,
 * `system`, and unrecognized event types are handled separately (see caller).
 */
export function groupIntoTurns(events: Array<Record<string, unknown>>): {
  turns: NormalizedTurn[];
  unknownEvents: unknown[];
} {
  const turns: NormalizedTurn[] = [];
  const unknownEvents: unknown[] = [];
  let current: NormalizedTurn | null = null;

  for (const event of events) {
    const eventType = typeof event.type === "string" ? event.type : "unknown";

    if (eventType === "user" || eventType === "assistant") {
      const message = (event.message ?? {}) as Record<string, unknown>;
      const role = message.role;

      if (!message || (role !== "user" && role !== "assistant")) {
        unknownEvents.push(event);
        continue;
      }

      const content = message.content;

      if (eventType === "user" && hasToolResult(content)) {
        if (current) {
          current.toolResults.push({ raw: event });
          continue;
        }
        // Tool result with no open turn to attach to — surfaced, not dropped.
        unknownEvents.push(event);
        continue;
      }

      const { text, thinking, toolCalls } = extractContentParts(content);

      if (current) {
        turns.push(current);
      }

      current = {
        role: role as "user" | "assistant",
        text: text.join("\n\n"),
        thinking: thinking.join("\n\n"),
        toolCalls,
        toolResults: [],
        timestamp: typeof event.timestamp === "string" ? event.timestamp : "",
        messageId: typeof message.id === "string" ? message.id : "",
        usage: (message.usage as UsageBlock | undefined) ?? undefined,
      };
      continue;
    }

    if (eventType === "system" || eventType === "result" || eventType === "parse_error") {
      // Handled by the caller (parseStreamJson), not part of turn grouping.
      continue;
    }

    unknownEvents.push(event);
  }

  if (current) {
    turns.push(current);
  }

  return { turns, unknownEvents };
}

function toResultEvent(event: Record<string, unknown>): ResultEvent {
  return {
    subtype: typeof event.subtype === "string" ? event.subtype : "unknown",
    isError: Boolean(event.is_error),
    result: typeof event.result === "string" ? event.result : undefined,
    sessionId: typeof event.session_id === "string" ? event.session_id : undefined,
    usage: (event.usage as UsageBlock | undefined) ?? undefined,
    totalCostUsd: typeof event.total_cost_usd === "number" ? event.total_cost_usd : undefined,
  };
}

/**
 * Parses full `claude -p --output-format stream-json` stdout (one JSON object
 * per line) into normalized turns plus the terminal result event and the
 * session id observed in the stream. Malformed lines are surfaced in
 * `parseErrors`, never silently dropped.
 */
export function parseStreamJson(rawText: string): ParsedStream {
  const lines = rawText.split("\n").filter((l) => l.trim().length > 0);
  const events: Array<Record<string, unknown>> = [];
  const parseErrors: ParseErrorEvent[] = [];
  let result: ResultEvent | null = null;
  let sessionId: string | null = null;

  lines.forEach((line, idx) => {
    const parsed = parseStreamLine(line, idx + 1);
    if (isParseError(parsed)) {
      parseErrors.push(parsed);
      return;
    }

    if (typeof parsed.session_id === "string" && parsed.session_id.length > 0) {
      // Re-read fresh from each event — never assume the session id is stable
      // across --resume (task Empirical Unknown #1). Last one observed wins.
      sessionId = parsed.session_id;
    }

    if (parsed.type === "result") {
      result = toResultEvent(parsed);
      if (result.sessionId) {
        sessionId = result.sessionId;
      }
      return;
    }

    events.push(parsed);
  });

  const { turns, unknownEvents } = groupIntoTurns(events);

  return { turns, unknownEvents, parseErrors, result, sessionId };
}
