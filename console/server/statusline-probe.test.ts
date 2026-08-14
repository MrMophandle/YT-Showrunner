/**
 * statusline-probe tests: fresh / stale / no-snapshot / unreadable paths,
 * all against fixture/injected reads (no real `claude` CLI or statusLine
 * integration — see the module doc for why). Mirrors draft-watcher.test.ts's
 * DI pattern for readFileFn and an injectable clock for deterministic
 * freshness-window assertions.
 */
import { describe, expect, it } from "vitest";
import { readStatuslineSnapshot, STATUSLINE_FRESHNESS_WINDOW_MS } from "./statusline-probe.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");

function fixedReadFileFn(raw: string) {
  return async () => raw;
}

describe("readStatuslineSnapshot", () => {
  it("reads a fresh snapshot (well within the freshness window) and returns its fields verbatim", async () => {
    const snapshot = {
      asOf: "2026-08-12T11:58:00.000Z", // 2 minutes old
      fiveHourPercentUsed: 42,
      sevenDayPercentUsed: 18,
      resetsAt: "2026-08-12T15:00:00.000Z",
    };
    const result = await readStatuslineSnapshot({
      readFileFn: fixedReadFileFn(JSON.stringify(snapshot)),
      now: () => NOW,
    });

    expect(result).toEqual({ status: "fresh", ...snapshot });
  });

  it("reads a snapshot older than the freshness window as stale, still carrying its as-of time (AC-ERROR-6)", async () => {
    const snapshot = {
      asOf: "2026-08-12T11:00:00.000Z", // 60 minutes old — beyond the 15-minute window
      fiveHourPercentUsed: 70,
    };
    const result = await readStatuslineSnapshot({
      readFileFn: fixedReadFileFn(JSON.stringify(snapshot)),
      now: () => NOW,
      freshnessWindowMs: STATUSLINE_FRESHNESS_WINDOW_MS,
    });

    expect(result).toEqual({ status: "stale", ...snapshot });
  });

  it("reports 'no_snapshot' when the snapshot file does not exist yet, never a fabricated value", async () => {
    const readFileFn = async () => {
      const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    };

    const result = await readStatuslineSnapshot({ readFileFn, now: () => NOW });

    expect(result).toEqual({ status: "unavailable", reason: "no_snapshot" });
  });

  it("reports 'unreadable' for a torn/malformed read (invalid JSON), never throwing and never a 0% value", async () => {
    const truncatedJson = '{"asOf": "2026-08-12T11:58'; // torn mid-write
    const result = await readStatuslineSnapshot({
      readFileFn: fixedReadFileFn(truncatedJson),
      now: () => NOW,
    });

    expect(result).toEqual({ status: "unavailable", reason: "unreadable" });
  });

  it("reports 'unreadable' for a structurally invalid snapshot (missing required asOf field)", async () => {
    const result = await readStatuslineSnapshot({
      readFileFn: fixedReadFileFn(JSON.stringify({ fiveHourPercentUsed: 50 })),
      now: () => NOW,
    });

    expect(result).toEqual({ status: "unavailable", reason: "unreadable" });
  });
});
