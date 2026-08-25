// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { NormalizedTurn } from "../../server/stream-parser.js";
import { TranscriptTurn } from "./TranscriptTurn.js";

const turn: NormalizedTurn = {
  role: "assistant",
  text: "Here's a proposed episode weaving in the supply-run thread.",
  thinking: "Weighing thread continuity before proposing an episode.",
  toolCalls: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "continuity-ledger.md" } }],
  toolResults: [],
  timestamp: "2026-08-12T00:00:00.000Z",
  messageId: "msg_1",
};

describe("TranscriptTurn", () => {
  it("renders the turn's text and tool call names, and keeps thinking collapsed until expanded", () => {
    render(<TranscriptTurn turn={turn} />);

    expect(
      screen.getByText("Here's a proposed episode weaving in the supply-run thread."),
    ).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();

    // Thinking is present (accessible / testable) but collapsed by default —
    // a native <details> without the `open` attribute.
    const summary = screen.getByText("Thinking");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Weighing thread continuity before proposing an episode.")).toBeInTheDocument();
  });

  it("renders no tool-call list and no thinking block when a turn has neither", () => {
    const plainTurn: NormalizedTurn = {
      role: "user",
      text: "Let's talk about season 2.",
      thinking: "",
      toolCalls: [],
      toolResults: [],
      timestamp: "2026-08-12T00:00:00.000Z",
      messageId: "msg_0",
    };

    render(<TranscriptTurn turn={plainTurn} />);

    expect(screen.getByText("Let's talk about season 2.")).toBeInTheDocument();
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  });

  it("renders nothing at all for a turn with no text, no thinking, and no tool calls (AC-EMPTY-1)", () => {
    // The CLI emits assistant events carrying an EMPTY-STRING thinking block.
    // Grouping folds most of these into a sibling event's turn, but a run made
    // up entirely of them still yields a contentless turn — which previously
    // rendered as a bare "ASSISTANT" label above nothing.
    const emptyTurn: NormalizedTurn = {
      role: "assistant",
      text: "",
      thinking: "",
      toolCalls: [],
      toolResults: [],
      timestamp: "2026-08-12T00:00:00.000Z",
      messageId: "msg_empty",
      // Usage is deliberately present: an otherwise-empty event can carry the
      // only usage block in a stream, which is exactly why suppression belongs
      // here at render time and NOT in groupIntoTurns. The turn object must
      // survive for computeContextUsage; it just must not draw anything.
      usage: { input_tokens: 46_640 },
    };

    const { container } = render(<TranscriptTurn turn={emptyTurn} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("transcript-turn")).not.toBeInTheDocument();
    expect(screen.queryByText("assistant")).not.toBeInTheDocument();
  });

  it("still renders a turn that has only tool calls, since the tool chips are real content", () => {
    const toolOnlyTurn: NormalizedTurn = {
      role: "assistant",
      text: "",
      thinking: "",
      toolCalls: [{ type: "tool_use", id: "toolu_9", name: "Write", input: {} }],
      toolResults: [],
      timestamp: "2026-08-12T00:00:00.000Z",
      messageId: "msg_tools",
    };

    render(<TranscriptTurn turn={toolOnlyTurn} />);

    expect(screen.getByTestId("transcript-turn")).toBeInTheDocument();
    expect(screen.getByText("Write")).toBeInTheDocument();
  });
});
