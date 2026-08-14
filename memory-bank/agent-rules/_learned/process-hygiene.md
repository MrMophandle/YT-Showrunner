---
name: Process Hygiene (learned)
globs: ["**/*"]
paths: []
topics: ["process", "sub-agents", "git"]
priority: low
auto_generated: true
derived_from: [conversational-season-drafting]
evidence_count: 1
last_validated: 2026-08-13
---

# Process Hygiene (learned)

- Sub-agents whose role is "prepare artifacts for the orchestrator to commit" must not run
  `git commit` or `git add` themselves. Leave changes in the worktree and report which
  files were touched; the orchestrator owns the commit boundary.
  <!-- evidence: conversational-season-drafting Phase 5 — the Documentation Agent
       self-committed (ed19399), bundling production files, tests, and doc updates into one
       commit instead of leaving them staged for Step 11. Nothing was lost, but the
       "stage" vs "commit" ambiguity is exploitable under agent autonomy. -->
- A non-blocking code-review recommendation that recurs across phases must be either
  actioned or explicitly recorded as accepted debt before the next phase starts — repeating
  it without a decision produces no remediation.
  <!-- evidence: the shared `useSeasonDraft(seasonId)` hook was recommended at Phase 3,
       repeated at Phase 4, and Phase 5 added a third duplication site. -->
