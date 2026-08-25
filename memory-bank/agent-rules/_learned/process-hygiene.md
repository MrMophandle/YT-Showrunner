---
name: Process Hygiene (learned)
globs: ["**/*"]
paths: []
topics: ["process", "sub-agents", "git", "workflow", "bookkeeping"]
priority: low
auto_generated: true
derived_from: [conversational-season-drafting, client-styling]
evidence_count: 2
last_validated: 2026-08-24
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
- Tick the Implementation Roadmap checkboxes for each completed file and phase as part of the
  phase-completion step itself, not as a later correction. Thorough Execution State prose does
  not substitute for the checkboxes it should be driving — downstream phase gates read the
  boxes, not the narrative.
  <!-- evidence: client-styling shipped every roadmap item in PR #6 (a75c393, merged as
       d92bfa0) with all six file checkboxes AND Phase 1 still unticked. /bmb:reflect's Step 1
       gate requires all phases [x], so the task came within one gate check of hard-blocking
       its own reflection — despite the work being complete, merged, and verifiable in the
       diff. The boxes had to be reconciled against the merged tree before reflect could run. -->
- Do not let a task's code merge while any MUST acceptance criterion is still open. Check AC
  closure before opening or approving the merge PR, and treat a merge that lands with an open
  AC as a sequencing defect worth warning about rather than a silent no-op.
  <!-- evidence: client-styling's AC-VISUAL-1 ("it actually looks right in a real browser")
       was still open when PR #6 merged to main on 2026-08-23; it was not confirmed until
       2026-08-24. For a full day, shipped code sat against a formally-open MUST AC, with the
       task file at IN_PROGRESS, the roadmap feature at in_progress, and no archive entry —
       and banyan records completion by the archive entry, not by the merge. -->
