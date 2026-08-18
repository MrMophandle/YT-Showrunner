---
name: Testing Patterns (learned)
globs: ["**/*.test.ts", "**/*.test.tsx", "**/*route*", "**/index.ts"]
paths: ["console/"]
topics: ["testing", "tdd", "error-handling"]
priority: low
auto_generated: true
derived_from: [conversational-season-drafting, season-chat-conversation-loop]
evidence_count: 2
last_validated: 2026-08-18
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
- When EVERY test in a suite injects a fake for the same external boundary (e.g. a
  `spawnFn`), do NOT write a test that itself performs the effect the AC is meant to
  verify — it proves nothing about the real boundary. Instead: (a) redirect the automated
  guarantee to what IS provable on the caller's side of that boundary, and (b) give the
  boundary-crossing behavior an explicit, one-time manual verification runbook with exact
  commands and exact expected observations, recorded in the spec.
  <!-- evidence: season-chat-conversation-loop AC-HAPPY-4 (the season-drafting skill
       writes season.draft.json). Every test injects spawnFn, so no test can cause a real
       skill invocation; a test that wrote the draft itself would assert nothing. Caught by
       the plan critique (F1) BEFORE Phase 1. Resolution: automated half redirected to
       AC-HAPPY-1 (the composed prompt provably carries the skill invocation), plus a
       manual runbook. The build was explicitly forbidden from claiming the AC from a
       green suite. -->
- Write ACs that describe behavior across a mocked boundary with this automated/manual
  split FROM THE START, rather than discovering the gap during test-writing.

See also: [[security-review]], [[integration-wiring]], [[empirical-verification]]
