// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DraftPreview } from "./DraftPreview.js";

describe("DraftPreview", () => {
  it("shows the no-draft empty state, then reflects the draft file once it appears — no reload, no user action (AC-HAPPY-3, AC-ENTRY-1)", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        // First poll: skill hasn't written a draft yet.
        return new Response(null, { status: 204 });
      }
      // Second poll: skill has written the draft file.
      return new Response(
        JSON.stringify({
          seasonNumber: 2,
          episodes: [{ title: "Cold Open", logline: "A ship breaks orbit.", threads: ["supply-run-saboteur"] }],
          updatedAt: "2026-08-12T00:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    render(<DraftPreview seasonId="season-2" pollIntervalMs={10} fetchFn={fetchFn} />);

    expect(screen.getByText(/no draft yet/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Cold Open")).toBeInTheDocument());
    expect(fetchFn).toHaveBeenCalledWith("/api/seasons/season-2/draft");
  });
});
