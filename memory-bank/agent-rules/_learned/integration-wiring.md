---
name: Integration Wiring (learned)
globs: ["**/*.ts", "**/*.tsx"]
paths: ["console/"]
topics: ["integration", "wiring", "dead-code", "completion-criteria"]
priority: low
auto_generated: true
derived_from: [season-chat-conversation-loop]
evidence_count: 1
last_validated: 2026-08-18
---

# Integration Wiring (learned)

- Before marking a task or phase complete, grep every newly-added export for at least one
  real call site OUTSIDE its own test file. A module with passing unit tests and zero
  production importers is not "done" — it is orphaned.
  <!-- evidence: conversational-season-drafting shipped BUILD_COMPLETE with 63/63 tests
       green, yet `context-bundle.ts` (assembleContextBundle / renderContextBundle /
       buildTurnPrompt, 6 passing tests) was imported by nobody. The design decision it
       implemented ("first turn must be context-seeded") was therefore not in effect at
       runtime, and closing that gap required an entire follow-on Level 3 task
       (season-chat-conversation-loop). -->
- Route every entry point that can trigger a stateful side effect (spawning a process,
  writing a session pointer, mutating shared state) through ONE composition function.
  A cross-cutting invariant only holds everywhere if there is a single place it can be
  enforced — otherwise it holds on the path someone tested by hand and silently fails on
  the others.
  <!-- evidence: season-chat-conversation-loop — `POST /reject` called
       `SeasonSessionManager.sendMessage()` directly while `POST /message` composed through
       `buildTurnPrompt()`. A first-ever `/reject` would have cold-started a session with
       no context bundle and no skill. Fixed by routing both through
       `SeasonTurnRunner.runSingleTurn()`. -->
- Treat "all units are individually correct and tested" and "the feature works" as
  independent claims requiring independent evidence. Verify integration by reading the
  call graph, not by trusting a prior task's completion marker.

See also: [[testing-patterns]], [[empirical-verification]]
