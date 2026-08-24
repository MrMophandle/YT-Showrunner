// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { computeContextUsage, CONTEXT_WINDOW_TOKENS, DiagnosticsPanel } from "./DiagnosticsPanel.js";
import type { NormalizedTurn } from "../../server/stream-parser.js";

function turnWithUsage(usage: Partial<NormalizedTurn["usage"]>): NormalizedTurn {
  return {
    role: "assistant",
    text: "",
    thinking: "",
    toolCalls: [],
    toolResults: [],
    timestamp: "2026-08-12T00:00:00.000Z",
    messageId: "msg-1",
    usage: usage as NormalizedTurn["usage"],
  };
}

describe("computeContextUsage", () => {
  it("sums the four usage fields (input + cache_read + cache_creation + output) from the most recent turn carrying a usage block, matching USAGE_KEYS semantics", () => {
    const turns: NormalizedTurn[] = [
      turnWithUsage({ input_tokens: 100, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 20 }),
      turnWithUsage({ input_tokens: 300, cache_read_input_tokens: 40, cache_creation_input_tokens: 0, output_tokens: 60 }),
    ];

    const result = computeContextUsage(turns);

    expect(result).toEqual({ totalTokens: 400, turnIndex: 1 });
  });

  it("reports the SAME total whether assistant events arrive as separate turns or merged into one (AC-MERGE-2)", () => {
    // The invariant that protects the token math across the turn-grouping
    // change. Real usage progression from captured CLI output: each block is
    // the FULL context for that request, not a delta, so the most recent
    // measurement is the answer regardless of how turns are grouped.
    const unmerged: NormalizedTurn[] = [
      turnWithUsage({ input_tokens: 46_640 }),
      turnWithUsage({ input_tokens: 50_277 }),
      turnWithUsage({ input_tokens: 50_503 }),
      turnWithUsage({ input_tokens: 51_344 }),
    ];
    // Merging keeps the LAST usage block, so one turn carries 51,344.
    const merged: NormalizedTurn[] = [turnWithUsage({ input_tokens: 51_344 })];

    expect(computeContextUsage(unmerged)?.totalTokens).toBe(51_344);
    expect(computeContextUsage(merged)?.totalTokens).toBe(51_344);
    expect(computeContextUsage(merged)?.totalTokens).toBe(computeContextUsage(unmerged)?.totalTokens);

    // Guards the two wrong merge rules explicitly: summing would report
    // 198,764 of a 200,000 window (a false near-limit warning), and
    // first-write-wins would report a stale 46,640.
    const summed = 46_640 + 50_277 + 50_503 + 51_344;
    expect(computeContextUsage(merged)?.totalTokens).not.toBe(summed);
    expect(computeContextUsage(merged)?.totalTokens).not.toBe(46_640);
  });

  it("returns null when no turn carries a usage block yet", () => {
    const turns: NormalizedTurn[] = [
      { role: "user", text: "hi", thinking: "", toolCalls: [], toolResults: [], timestamp: "", messageId: "m1" },
    ];

    expect(computeContextUsage(turns)).toBeNull();
  });
});

describe("DiagnosticsPanel", () => {
  const noSnapshotFetch = vi.fn(async () =>
    new Response(JSON.stringify({ status: "unavailable", reason: "no_snapshot" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;

  it("renders real context usage computed from turn usage blocks, not a character-count estimate (AC-HAPPY-6)", async () => {
    const turns: NormalizedTurn[] = [
      turnWithUsage({ input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 200 }),
    ];

    render(<DiagnosticsPanel turns={turns} fetchFn={noSnapshotFetch} />);

    expect(screen.getByTestId("diagnostics-panel")).toBeInTheDocument();
    expect(screen.getByText(/1,?200/)).toBeInTheDocument();
  });

  it("renders plan usage as explicitly unavailable with a reason when no statusline snapshot exists, and never blocks context usage from rendering (AC-ERROR-6)", async () => {
    const turns: NormalizedTurn[] = [turnWithUsage({ input_tokens: 500, output_tokens: 100 })];

    render(<DiagnosticsPanel turns={turns} fetchFn={noSnapshotFetch} />);

    await waitFor(() => expect(screen.getByTestId("plan-usage-unavailable")).toBeInTheDocument());
    expect(screen.queryByTestId("plan-usage-value")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-usage-unavailable").textContent).toMatch(/no snapshot/i);
    // Context usage must still render even though plan usage is unavailable.
    expect(screen.getByText(/600/)).toBeInTheDocument();
  });

  it("shows a visible warning once context usage crosses the warning threshold of the context window (AC-ERROR-5)", () => {
    const warningTokens = Math.ceil(CONTEXT_WINDOW_TOKENS * 0.85);
    const turns: NormalizedTurn[] = [turnWithUsage({ input_tokens: warningTokens, output_tokens: 0 })];

    render(<DiagnosticsPanel turns={turns} fetchFn={noSnapshotFetch} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent).toMatch(/nearing|approaching|limit/i);
  });

  it("does not show the warning when context usage is well under the threshold", () => {
    const turns: NormalizedTurn[] = [turnWithUsage({ input_tokens: 100, output_tokens: 50 })];

    render(<DiagnosticsPanel turns={turns} fetchFn={noSnapshotFetch} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
