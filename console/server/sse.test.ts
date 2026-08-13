import { describe, expect, it } from "vitest";
import { SeasonEventBus, formatSseMessage } from "./sse.js";

describe("SeasonEventBus", () => {
  it("delivers published events live to a subscriber", () => {
    const bus = new SeasonEventBus();
    const received: unknown[] = [];
    bus.subscribe("season-1", (event) => received.push(event.payload));

    bus.publish("season-1", { type: "text", text: "hello" });
    bus.publish("season-1", { type: "text", text: "world" });

    expect(received).toEqual([{ type: "text", text: "hello" }, { type: "text", text: "world" }]);
  });

  it("gives a late subscriber the current turn's buffered events from the point they connect (AC-ASYNC-1)", () => {
    const bus = new SeasonEventBus();

    // Events published before anyone is subscribed — simulates the headless
    // process running server-side, independent of any browser connection.
    bus.startTurn("season-2");
    bus.publish("season-2", { type: "text", text: "first" });
    bus.publish("season-2", { type: "text", text: "second" });

    const { missed } = bus.subscribe("season-2", () => {});

    expect(missed.map((e) => e.payload)).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
  });

  it("does not replay events from a prior turn once a new turn starts", () => {
    const bus = new SeasonEventBus();

    bus.startTurn("season-3");
    bus.publish("season-3", { type: "text", text: "old turn" });

    bus.startTurn("season-3");
    bus.publish("season-3", { type: "text", text: "new turn" });

    const { missed } = bus.subscribe("season-3", () => {});

    expect(missed.map((e) => e.payload)).toEqual([{ type: "text", text: "new turn" }]);
  });

  it("formats an SSE wire message as a data: line with a trailing blank line", () => {
    const message = formatSseMessage({ seq: 0, payload: { type: "text", text: "hi" } });
    expect(message).toBe('data: {"seq":0,"payload":{"type":"text","text":"hi"}}\n\n');
  });
});
