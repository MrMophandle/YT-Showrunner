---
name: Testing Patterns (learned)
globs: ["**/*.test.ts", "**/*.test.tsx", "**/*route*", "**/index.ts"]
paths: ["console/"]
topics: ["testing", "tdd", "error-handling"]
priority: low
auto_generated: true
derived_from: [conversational-season-drafting]
evidence_count: 1
last_validated: 2026-08-13
---

# Testing Patterns (learned)

- For any route or handler whose contract includes "must never return false success,"
  write a test that simulates the actual failure mode (process crash, non-zero exit,
  thrown exception) and asserts on the specific non-2xx status and error shape — not just
  the happy-path 200 response.
  <!-- evidence: conversational-season-drafting Phase 4 — POST /reject returned 200 on a
       crashed headless turn, violating AC-ERROR-1. Caught at code review, not by the TDD
       pass. Fixed to 502 + {error, crashed, exitCode}. -->
- When an acceptance criterion is phrased as a negative guarantee ("never fabricates",
  "never surfaces a torn read", "never auto-commits"), derive at least one test that
  attempts to violate it directly.

See also: [[security-review]]
