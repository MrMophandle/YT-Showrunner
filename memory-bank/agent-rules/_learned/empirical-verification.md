---
name: Empirical Verification (learned)
globs: ["**/*"]
paths: []
topics: ["research", "external-apis", "external-tools", "design", "assumptions", "debugging", "attribution"]
priority: low
auto_generated: true
derived_from: [season-chat-conversation-loop, headless-draft-writes]
evidence_count: 2
last_validated: 2026-08-22
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
- Before attributing a failure to the ENVIRONMENT (sandbox, CI, container, nested process)
  rather than to the code, name the single variable being isolated and verify the control
  actually removes it. A "control" that still carries the flag, arg, or config under
  suspicion reproduces the bug and reads as exonerating the code. "It fails even for a
  trivial input" proves nothing when the trivial input travels with the same suspect flag.
  <!-- evidence: headless-draft-writes — the Phase 2 build's control was
       `claude -p --output-format stream-json --verbose --allowedTools "Read,Write,Bash(mv *)"
       "hello there"`, which carries the very flag under suspicion. It reproduced the real
       defect (a variadic option swallowing the positional prompt) and was read as proving a
       nested-sandbox artifact. A true control — the same command minus --allowedTools —
       succeeds fine nested in an agent's Bash sandbox. The misdiagnosis was written into the
       task file AND survived a full reflection; it was caught only when a human ran the
       runbook from a normal terminal the next day and hit the identical error. -->
- When a call into an external tool fails, consult that tool's own documented arity and
  contract (`--help`, type signature, option cardinality) as the FIRST evidence — before
  reaching for environmental explanations. A variadic option consuming an adjacent
  positional argument looks exactly like an environment failure from the caller's side, and
  one line of `--help` settles in seconds what a sandbox theory can obscure for days.

See also: [[integration-wiring]], [[testing-patterns]]
