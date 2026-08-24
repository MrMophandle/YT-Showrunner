/**
 * Single source of truth for the console backend's default dev port.
 *
 * Both the Hono server (console/server/index.ts) and the Vite dev-server
 * proxy config (console/vite.config.ts) import this constant instead of
 * hardcoding the literal — this is the ONLY place `6187` may appear as a
 * literal in the console (console-dev-ports task, AC-PORT-3).
 */
export const DEFAULT_CONSOLE_PORT = 6187;
