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
