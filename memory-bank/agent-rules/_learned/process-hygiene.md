---
name: Process Hygiene (learned)
globs: ["**/*"]
paths: []
topics: ["process", "sub-agents", "git", "workflow", "bookkeeping", "verification"]
priority: medium
auto_generated: true
derived_from: [conversational-season-drafting, client-styling, transcript-turn-grouping]
evidence_count: 3
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
  <!-- evidence (2nd instance): transcript-turn-grouping repeated it exactly — /bmb:build
       shipped all five roadmap files and the single phase, then left every checkbox
       unticked; /bmb:reflect reconciled them again. Two consecutive tasks, same slip, so
       this is a systematic gap in the build step rather than one operator's oversight. -->
- Do not let a task's code merge while any MUST acceptance criterion is still open. Check AC
  closure before opening or approving the merge PR, and treat a merge that lands with an open
  AC as a sequencing defect worth warning about rather than a silent no-op.
  <!-- evidence: client-styling's AC-VISUAL-1 ("it actually looks right in a real browser")
       was still open when PR #6 merged to main on 2026-08-23; it was not confirmed until
       2026-08-24. For a full day, shipped code sat against a formally-open MUST AC, with the
       task file at IN_PROGRESS, the roadmap feature at in_progress, and no archive entry —
       and banyan records completion by the archive entry, not by the merge. -->
  <!-- evidence (2nd instance): transcript-turn-grouping archived on 2026-08-24 with
       AC-VISUAL-1 still open, and this rule worked as intended. Archiving under
       `push-and-pr` merges nothing, so the open MUST rode visibly on PR #9 as a
       DO-NOT-MERGE callout instead of being silently passed — and it was closed the same
       day by a real browser walk, before any merge. The distinction that makes this
       workable: ARCHIVING with an open AC is recoverable, MERGING with one is not. Prefer
       carrying an open MUST loudly on the PR over either faking the pass or blocking the
       archive. -->

- When an acceptance criterion can only be closed by observation, write down IN ADVANCE what
  each candidate outcome would look like numerically. A check whose expected values are
  precomputed becomes a lookup anyone can perform; one that is not becomes a judgment call
  that tends to get skipped or fudged.
  <!-- evidence: transcript-turn-grouping predicted that a usage-summing bug would show
       "roughly 4x" the true context total. When AC-VISUAL-1 was finally driven in a real
       browser, the three candidate semantics predicted 239,305 (sum) / 59,646 (first-wins) /
       60,367 (last-wins) — all distinct, so the observed 60,367 positively IDENTIFIED
       last-write-wins rather than merely looking plausible. The predicted ratio was accurate
       to 3.96x. Precomputing the signature turned a subjective "does this number look right?"
       into an unambiguous match. -->

- Verification evidence that lives only in a running process's memory is not durable, and a
  file-watching dev server (`tsx watch`, `nodemon`, Vite HMR) will destroy it the moment you
  edit the code under test. Before touching any watched file, snapshot manually-populated
  runtime state — SSE/replay buffers, in-memory sessions, seeded caches — to a disk fixture
  the implementation's edit/restart cycle cannot reach.
  <!-- evidence: transcript-turn-grouping — a manual browser walk on 2026-08-22 populated
       the `.uat-canon` SSE buffer with the exact 9-row exchange AC-VISUAL-1 needed to be
       re-observed against. `stream-parser.ts` is server code under `tsx watch`, so the
       first edit to the fix restarted the server and cleared the buffer. The fix and the
       evidence needed to verify it competed for the same process; implementing the fix
       necessarily destroyed the proof. The AC shipped open. -->

