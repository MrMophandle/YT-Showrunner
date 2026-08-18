---
name: Empirical Verification (learned)
globs: ["**/*"]
paths: []
topics: ["research", "external-apis", "external-tools", "design", "assumptions"]
priority: low
auto_generated: true
derived_from: [season-chat-conversation-loop]
evidence_count: 1
last_validated: 2026-08-18
---

# Empirical Verification (learned)

- Before locking a design that depends on undocumented behavior of an external tool, CLI,
  or API, run a small number (3-5) of real probe calls against the ACTUAL INSTALLED
  VERSION and record the findings in the spec. Do not infer behavior from documentation,
  from a prior version, or from what the behavior "should" be.
  <!-- evidence: season-chat-conversation-loop — 5 probe runs against claude CLI 2.1.229
       settled "does headless `claude -p` auto-discover project skills?" The answer was
       split (auto-DISCOVERY yes, auto-INVOCATION no), which neither the docs nor intuition
       would have produced. It eliminated two candidate implementations outright
       (`--append-system-prompt`, inlining SKILL.md) and reduced the fix to a
       `/season-drafting ` prompt prefix, leaving `buildArgs()` unchanged. -->
- Do NOT defer an empirical unknown into the first TDD pass. A wrong assumption discovered
  there has already become an implementation rather than a design input, and unwinding it
  costs far more than the probe would have.
  <!-- evidence: the predecessor task (conversational-season-drafting) folded its
       LOW-confidence CLI unknowns into Phase 1's TDD pass and its own reflection
       recommended a lighter targeted probe step instead. season-chat-conversation-loop
       took that recommendation and it paid off directly. -->
- Record probe findings as a table in the task spec (question → finding → evidence) so
  later phases and reviewers can see WHY an approach was chosen, and so the finding is
  re-checkable when the external tool version changes.

See also: [[integration-wiring]], [[testing-patterns]]
