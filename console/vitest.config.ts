import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node", // Default to Node for backend tests (fast, no DOM overhead)
    // Component tests (src/**) need a DOM via jsdom; backend tests stay on Node.
    // This split keeps server tests fast (no DOM, no jsdom library load) and
    // component tests fast (jsdom only when needed) — a key performance win for the test suite.
    // See systemPatterns.md for testing strategy.
    environmentMatchGlobs: [["src/**", "jsdom"]],
    include: ["*.test.ts", "server/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
