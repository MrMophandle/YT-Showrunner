---
name: Testing Patterns (learned)
globs: ["**/*.test.ts", "**/*.test.tsx", "**/*route*", "**/index.ts"]
paths: ["console/"]
topics: ["testing", "tdd", "error-handling", "fixtures"]
priority: medium
auto_generated: true
derived_from: [conversational-season-drafting, season-chat-conversation-loop, headless-draft-writes, transcript-turn-grouping]
evidence_count: 4
last_validated: 2026-08-24
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
- Asserting the *contents* of an argument vector (or any payload handed to an external
  parser) proves nothing about how that parser *consumes* it. A vector can satisfy every
  string assertion and still produce a command that cannot start. Prefer assertions on
  **structural defenses** — a `--` immediately before the positional argument, explicit
  option/value adjacency — over content-only equality checks, and derive them from the
  tool's own documented arity rather than from what the string looks like.
  <!-- evidence: headless-draft-writes — `claude --help` documents
       `--allowedTools <tools...>` as variadic, so it swallowed the positional prompt that
       buildArgs() pushed directly after it. AC-PERM-1/2 asserted the exact allowlist
       string and passed; 103 tests were green; the spawned command could not start at all
       (`Error: Input must be provided…`). Every test injects spawnFn, so no test ever
       handed the vector to a real parser. Fixed with `args.push("--", prompt)` plus
       AC-SPAWN-1 asserting `--` precedes the prompt across the tight, resumed, and
       escape-hatch shapes — a structural assertion a future flag addition cannot
       silently re-break. This is the confirming third instance of this rule's
       mock-boundary theme, not a hypothetical. -->

- Build fixtures from REAL captured output of the tool or service under test, not from
  hand-written data. Capture a real run to a log, then transcribe its actual shapes. A
  hand-invented fixture encodes what you already believe the data looks like, so it
  reliably omits the edge shape that IS the bug — and the resulting test passes against a
  fixture that cannot reproduce the failure it exists to catch.
  <!-- evidence: transcript-turn-grouping — the Claude CLI emits `thinking` blocks
       containing the EMPTY STRING, which is precisely why those rows rendered as a bare
       role label with no content. No hand-written fixture would have used empty thinking
       text; it would have used a plausible placeholder sentence and passed. Fixtures were
       instead transcribed from real captured stdout
       (`.claude-logs/skill-probe-b2-implicit.log`, claude 2.1.229), which also revealed
       one message.id spanning several events and usage growing across ids
       (46640 → 50277 → 50503 → 51344) — the three facts the whole design turned on, two
       of which contradicted the initial assumption. -->

See also: [[security-review]], [[integration-wiring]], [[empirical-verification]],
[[process-hygiene]]
