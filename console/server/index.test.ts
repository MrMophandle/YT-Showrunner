/**
 * Route-boundary tests for the console server. Focused on the seasonId
 * validation gate: seasonId arrives as an unvalidated HTTP route param and
 * the server has no auth/CORS layer in front of it, so an invalid seasonId
 * (path-traversal-shaped, containing a slash, empty, etc.) must be rejected
 * with a clean 4xx response before it reaches FileSessionStore or
 * SeasonEventBus.subscribe — never a 500 crash, never a silent pass-through.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index.js";

describe("GET /api/seasons/:seasonId/events — seasonId validation", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("rejects a path-traversal-shaped seasonId (encoded slashes) with a 4xx, not a crash", async () => {
    const { app } = createApp();

    // Decodes to "../../etc/passwd" once Hono reads the route param.
    const res = await app.request("/api/seasons/..%2F..%2Fetc%2Fpasswd/events");

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("rejects a seasonId containing a raw slash-equivalent traversal token with a 4xx", async () => {
    const { app } = createApp();

    const res = await app.request("/api/seasons/..%2Fescaped/events");

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("does not reject a valid alphanumeric/hyphen/underscore seasonId at the validation gate", async () => {
    const { app } = createApp();

    const res = await app.request("/api/seasons/season_1-Test/events");

    // The SSE stream itself stays open (no terminal status to assert), but the
    // validation gate must not short-circuit it with a 4xx.
    expect(res.status).toBe(200);
    res.body?.cancel();
  });
});
