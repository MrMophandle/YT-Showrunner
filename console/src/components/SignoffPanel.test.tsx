// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SignoffPanel } from "./SignoffPanel.js";

describe("SignoffPanel", () => {
  it("keeps Approve disabled with no draft, then enables it once the draft has at least one episode", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        // First poll: no draft written yet.
        return new Response(null, { status: 204 });
      }
      // Second poll: a draft with one episode has appeared.
      return new Response(
        JSON.stringify({
          seasonNumber: 2,
          episodes: [{ title: "Cold Open", logline: "A ship breaks orbit.", threads: [] }],
          updatedAt: "2026-08-12T00:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    render(<SignoffPanel seasonId="season-2" pollIntervalMs={10} fetchFn={fetchFn} />);

    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("button", { name: /approve/i })).toBeEnabled());
  });

  it("shows an inline error instead of the success message when the reject turn crashes (AC-ERROR-1)", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/draft")) {
        return new Response(null, { status: 204 });
      }
      if (url.includes("/reject") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "Turn crashed", crashed: true, exitCode: 1 }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(<SignoffPanel seasonId="season-2" pollIntervalMs={10} fetchFn={fetchFn} />);

    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: "Please revise episode 2." } });
    fireEvent.click(screen.getByRole("button", { name: /reject with notes/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/fail|crash|error/i);
    expect(screen.queryByText(/notes sent/i)).not.toBeInTheDocument();
  });
});
