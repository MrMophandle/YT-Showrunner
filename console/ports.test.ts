/**
 * Regression test for the shared DEFAULT_CONSOLE_PORT constant
 * (console-dev-ports task, AC-PORT-3). Guards against a second hardcoded
 * port literal being reintroduced into the server or the Vite config: both
 * must resolve to the same value as this module exports when no
 * YTS_CONSOLE_PORT override is set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEY = "YTS_CONSOLE_PORT";

describe("DEFAULT_CONSOLE_PORT", () => {
  const originalEnv = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    vi.resetModules();
  });

  it("is a positive number", async () => {
    const { DEFAULT_CONSOLE_PORT } = await import("./ports.js");
    expect(typeof DEFAULT_CONSOLE_PORT).toBe("number");
    expect(DEFAULT_CONSOLE_PORT).toBeGreaterThan(0);
  });

  it("is the single default both the server and the Vite proxy resolve to", async () => {
    const { DEFAULT_CONSOLE_PORT } = await import("./ports.js");
    const { PORT: serverPort } = await import("./server/index.js");
    const { SERVER_PORT: viteProxyPort } = await import("./vite.config.js");

    expect(serverPort).toBe(DEFAULT_CONSOLE_PORT);
    expect(viteProxyPort).toBe(DEFAULT_CONSOLE_PORT);
  });
});
