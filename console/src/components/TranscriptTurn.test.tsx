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
});
