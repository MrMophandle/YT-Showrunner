import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Explicit RTL cleanup between tests — this project doesn't enable Vitest's
// `test.globals`, so RTL's auto-cleanup (which relies on a global afterEach)
// isn't picked up automatically.
afterEach(() => {
  cleanup();
});
