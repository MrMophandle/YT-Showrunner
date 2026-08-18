// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SeasonChat } from "./SeasonChat.js";

/** A fake `EventSource` the test can push SSE payloads through directly. */
function createFakeEventSource() {
  return {
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    close: vi.fn(),
  };
}

function pushSseEvent(
  source: ReturnType<typeof createFakeEventSource>,
  seq: number,
  payload: Record<string, unknown>,
) {
  act(() => {
    source.onmessage?.({ data: JSON.stringify({ seq, payload }) } as MessageEvent<string>);
  });
}

/** Default fetchFn: 204 for `/draft` (DraftPreview + SignoffPanel polling), 200 for `/message`. */
function defaultFetchFn(status = 200) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/draft")) {
      return new Response(null, { status: 204 });
    }
    if (url.includes("/message")) {
      return new Response(JSON.stringify(status === 202 ? { queued: true, position: 1 } : { started: true }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

function renderSeasonChat(props: { fetchFn?: typeof fetch; eventSourceFactory?: () => ReturnType<typeof createFakeEventSource> }) {
  const capturedSources: Array<ReturnType<typeof createFakeEventSource>> = [];
  const eventSourceFactory = vi.fn(() => {
    const source = props.eventSourceFactory ? props.eventSourceFactory() : createFakeEventSource();
    capturedSources.push(source);
    return source;
  });

  render(
    <MemoryRouter initialEntries={["/seasons/season-1/chat"]}>
      <Routes>
        <Route
          path="/seasons/:seasonId/chat"
          element={<SeasonChat fetchFn={props.fetchFn ?? defaultFetchFn()} eventSourceFactory={eventSourceFactory} />}
        />
      </Routes>
    </MemoryRouter>,
  );

  return {
    getSource: () => {
      const source = capturedSources[0];
      if (!source) throw new Error("EventSource was never constructed");
      return source;
    },
  };
}

describe("SeasonChat composer", () => {
  it("POSTs the trimmed message to /message on submit and clears the textarea (AC-ENTRY-1)", async () => {
    const fetchFn = defaultFetchFn(200);
    renderSeasonChat({ fetchFn });

    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "  Hello there  " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith(
        "/api/seasons/season-1/message",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ message: "Hello there" }) }),
      ),
    );
    expect(screen.getByLabelText(/message/i)).toHaveValue("");
  });

  it("disables Send while the submit request is in flight, then re-enables it", async () => {
    let resolveFetch: ((res: Response) => void) | undefined;
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/draft")) return new Response(null, { status: 204 });
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as unknown as typeof fetch;

    renderSeasonChat({ fetchFn });

    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /send/i })).toBeDisabled());

    await act(async () => {
      resolveFetch?.(new Response(JSON.stringify({ started: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /send/i })).toBeEnabled());
  });

  it("adds the message to a rendered pending list when the server responds 202 queued (AC-ASYNC-2)", async () => {
    const fetchFn = defaultFetchFn(202);
    renderSeasonChat({ fetchFn });

    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "Queued msg" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByTestId("pending-messages")).toBeInTheDocument());
    expect(screen.getByTestId("pending-message")).toHaveTextContent("Queued msg");
  });

  it("removes the oldest pending entry once a new user turn appears via SSE (AC-ASYNC-2)", async () => {
    const fetchFn = defaultFetchFn(202);
    const { getSource } = renderSeasonChat({ fetchFn });

    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "Queued msg" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.getByTestId("pending-messages")).toBeInTheDocument());

    pushSseEvent(getSource(), 1, { type: "user", message: { role: "user", content: "Queued msg" } });

    await waitFor(() => expect(screen.queryByTestId("pending-messages")).not.toBeInTheDocument());
    expect(screen.getByTestId("transcript")).toHaveTextContent("Queued msg");
  });

  it("renders a yts_error SSE event as an alert (AC-ERROR-2)", async () => {
    const { getSource } = renderSeasonChat({ fetchFn: defaultFetchFn(200) });

    pushSseEvent(getSource(), 1, {
      type: "yts_error",
      error: "claude crashed unexpectedly",
      crashed: true,
      exitCode: 1,
      discardedMessages: [],
    });

    await waitFor(() => expect(screen.getByRole("alert", { name: "" })).toBeInTheDocument());
    expect(screen.getByText(/claude crashed unexpectedly/)).toBeInTheDocument();
  });

  it("restores discardedMessages from a yts_error event into the composer, joined in order and appended to existing text (AC-ERROR-2)", async () => {
    const { getSource } = renderSeasonChat({ fetchFn: defaultFetchFn(200) });

    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "foo" } });

    pushSseEvent(getSource(), 1, {
      type: "yts_error",
      error: "claude crashed",
      crashed: true,
      exitCode: 1,
      discardedMessages: ["bar", "baz"],
    });

    await waitFor(() => {
      const value = (screen.getByLabelText(/message/i) as HTMLTextAreaElement).value;
      expect(value).toContain("foo");
      expect(value).toContain("bar\n\nbaz");
      expect(value.indexOf("foo")).toBeLessThan(value.indexOf("bar"));
    });
  });
});
