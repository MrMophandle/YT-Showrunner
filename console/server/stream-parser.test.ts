import { describe, expect, it } from "vitest";
import { parseStreamJson } from "./stream-parser.js";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe("parseStreamJson", () => {
  it("groups text, thinking, and tool_use blocks into normalized turns, pairing trailing tool_results", () => {
    const stream = [
      line({ type: "system", subtype: "init", session_id: "sess-1" }),
      line({
        type: "assistant",
        session_id: "sess-1",
        message: {
          id: "msg-1",
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Let me consider the threads." },
            { type: "text", text: "Here's a season outline idea." },
            { type: "tool_use", id: "tool-1", name: "Read", input: { file: "continuity-ledger.md" } },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      line({
        type: "user",
        session_id: "sess-1",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ledger contents" }],
        },
      }),
    ].join("\n");

    const parsed = parseStreamJson(stream);

    expect(parsed.turns).toHaveLength(1);
    const turn = parsed.turns[0]!;
    expect(turn.role).toBe("assistant");
    expect(turn.text).toBe("Here's a season outline idea.");
    expect(turn.thinking).toBe("Let me consider the threads.");
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]!.name).toBe("Read");
    expect(turn.toolResults).toHaveLength(1);
    expect(turn.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  it("extracts the terminal result event without discarding its usage block", () => {
    const stream = [
      line({
        type: "assistant",
        session_id: "sess-2",
        message: { id: "msg-1", role: "assistant", content: [{ type: "text", text: "ok" }] },
      }),
      line({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "done",
        session_id: "sess-2",
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 2,
          output_tokens: 8,
        },
        total_cost_usd: 0.01,
      }),
    ].join("\n");

    const parsed = parseStreamJson(stream);

    expect(parsed.result).not.toBeNull();
    expect(parsed.result!.subtype).toBe("success");
    expect(parsed.result!.isError).toBe(false);
    expect(parsed.result!.usage).toEqual({
      input_tokens: 10,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 2,
      output_tokens: 8,
    });
    expect(parsed.sessionId).toBe("sess-2");
  });

  it("surfaces malformed JSON lines as parse errors instead of silently dropping them", () => {
    const stream = [
      line({ type: "assistant", message: { id: "m1", role: "assistant", content: "hi" } }),
      "{not valid json",
      line({ type: "result", subtype: "success", is_error: false, session_id: "sess-3" }),
    ].join("\n");

    const parsed = parseStreamJson(stream);

    expect(parsed.parseErrors).toHaveLength(1);
    expect(parsed.parseErrors[0]!.rawLine).toBe("{not valid json");
    // The rest of the stream is still parsed despite the bad line.
    expect(parsed.turns).toHaveLength(1);
    expect(parsed.result).not.toBeNull();
  });

  it("re-reads the session id from each turn's own output rather than assuming stability across resume", () => {
    const stream = [
      line({
        type: "assistant",
        session_id: "sess-original",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "first" }] },
      }),
      line({ type: "result", subtype: "success", is_error: false, session_id: "sess-forked-on-resume" }),
    ].join("\n");

    const parsed = parseStreamJson(stream);

    // The last-observed session id (from the terminal result) wins, even though
    // an earlier event in the same stream reported a different one.
    expect(parsed.sessionId).toBe("sess-forked-on-resume");
  });
});

/**
 * The event sequence below is modeled on REAL captured CLI output
 * (`claude` 2.1.229, see memory-bank/roadmap/transcript-turn-grouping.md): the
 * CLI emits one event PER CONTENT BLOCK, so a single assistant message spans
 * several events sharing one `message.id`, and it emits `thinking` blocks
 * containing the EMPTY STRING. A hand-invented fixture would not have included
 * that empty-thinking shape, and it is precisely what produced contentless
 * rows in the transcript.
 */
describe("groupIntoTurns — one logical exchange is one turn", () => {
  const U1 = { input_tokens: 46_640 };
  const U2 = { input_tokens: 50_277 };
  const U3 = { input_tokens: 50_503 };
  const U4 = { input_tokens: 51_344 };

  /** Mirrors the real shape: user prompt, then an assistant run of 4 messages across 3 tool round-trips. */
  function realWorldExchange(): string {
    return [
      line({
        type: "user",
        message: { id: "u1", role: "user", content: [{ type: "text", text: "Let's start planning the next season." }] },
        timestamp: "2026-08-22T20:30:00.000Z",
      }),
      // Message A — two events, same id, first carries an EMPTY thinking block.
      line({
        type: "assistant",
        message: { id: "msg-a", role: "assistant", content: [{ type: "thinking", thinking: "" }], usage: U1 },
        timestamp: "2026-08-22T20:30:05.000Z",
      }),
      line({
        type: "assistant",
        message: {
          id: "msg-a",
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: {} }],
          usage: U1,
        },
        timestamp: "2026-08-22T20:30:06.000Z",
      }),
      line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ledger" }] } }),
      // Message B — same pattern, new id, higher usage.
      line({
        type: "assistant",
        message: { id: "msg-b", role: "assistant", content: [{ type: "thinking", thinking: "" }], usage: U2 },
      }),
      line({
        type: "assistant",
        message: {
          id: "msg-b",
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-2", name: "Bash", input: {} }],
          usage: U2,
        },
      }),
      line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-2", content: "characters" }] } }),
      // Message C — a lone tool_use event.
      line({
        type: "assistant",
        message: {
          id: "msg-c",
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-3", name: "Write", input: {} }],
          usage: U3,
        },
      }),
      line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-3", content: "written" }] } }),
      // Message D — the actual reply.
      line({
        type: "assistant",
        message: {
          id: "msg-d",
          role: "assistant",
          content: [{ type: "text", text: "The ledger gives us three live threads." }],
          usage: U4,
        },
      }),
    ].join("\n");
  }

  it("merges a run of consecutive assistant events into ONE turn, accumulating tool calls in stream order (AC-MERGE-1)", () => {
    const parsed = parseStreamJson(realWorldExchange());

    // Before this behavior existed the same stream produced 5 turns: one user
    // plus four assistant, three of which rendered as a bare role label.
    expect(parsed.turns).toHaveLength(2);

    const [userTurn, assistantTurn] = parsed.turns;
    expect(userTurn!.role).toBe("user");
    expect(assistantTurn!.role).toBe("assistant");

    expect(assistantTurn!.toolCalls.map((c) => c.name)).toEqual(["Bash", "Bash", "Write"]);
    expect(assistantTurn!.text).toBe("The ledger gives us three live threads.");
    // Every thinking block in the run was the empty string, so nothing is joined
    // in — this is what stops the contentless rows.
    expect(assistantTurn!.thinking).toBe("");
    expect(assistantTurn!.toolResults).toHaveLength(3);
  });

  it("takes the LAST usage block across a merge, never the first and never a sum (AC-MERGE-2)", () => {
    const parsed = parseStreamJson(realWorldExchange());
    const assistantTurn = parsed.turns[1]!;

    // Each usage block is the FULL context for that request, not a delta, so
    // the most recent measurement is the only correct one. Summing would report
    // ~198k of a 200k window; first-wins would report a stale 46,640.
    expect(assistantTurn.usage).toEqual(U4);
    expect(assistantTurn.usage).not.toEqual(U1);
  });

  it("keeps the FIRST messageId and timestamp so the turn's React key is stable as it grows (AC-MERGE-4)", () => {
    const parsed = parseStreamJson(realWorldExchange());
    const assistantTurn = parsed.turns[1]!;

    // SeasonChat keys transcript rows off messageId. Adopting each newly merged
    // event's id would change the key mid-stream and remount the row.
    expect(assistantTurn.messageId).toBe("msg-a");
    expect(assistantTurn.timestamp).toBe("2026-08-22T20:30:05.000Z");
  });

  it("never merges consecutive USER turns, so SeasonChat's pending-message count stays correct (AC-MERGE-3)", () => {
    // The shape produced when a second message is submitted while a turn is in
    // flight. SeasonChat pops one pending entry per newly observed user turn
    // (AC-ASYNC-2); collapsing these would strand a queued message forever.
    const stream = [
      line({ type: "user", message: { id: "u1", role: "user", content: [{ type: "text", text: "first message" }] } }),
      line({ type: "user", message: { id: "u2", role: "user", content: [{ type: "text", text: "second message" }] } }),
    ].join("\n");

    const parsed = parseStreamJson(stream);

    expect(parsed.turns).toHaveLength(2);
    expect(parsed.turns.map((t) => t.role)).toEqual(["user", "user"]);
    expect(parsed.turns[0]!.text).toBe("first message");
    expect(parsed.turns[1]!.text).toBe("second message");
  });

  it("joins multiple non-empty text and thinking parts across a merge with a blank line (AC-MERGE-1)", () => {
    const stream = [
      line({
        type: "assistant",
        message: { id: "m1", role: "assistant", content: [{ type: "thinking", thinking: "first thought" }] },
      }),
      line({
        type: "assistant",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "opening line" }] },
      }),
      line({
        type: "assistant",
        message: { id: "m2", role: "assistant", content: [{ type: "thinking", thinking: "second thought" }] },
      }),
      line({
        type: "assistant",
        message: { id: "m2", role: "assistant", content: [{ type: "text", text: "closing line" }] },
      }),
    ].join("\n");

    const parsed = parseStreamJson(stream);

    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0]!.text).toBe("opening line\n\nclosing line");
    expect(parsed.turns[0]!.thinking).toBe("first thought\n\nsecond thought");
  });
});
