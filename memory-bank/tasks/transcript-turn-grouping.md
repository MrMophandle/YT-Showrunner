---
slug: transcript-turn-grouping
legacy_id:
feature: transcript-turn-grouping
status: IN_PROGRESS
---

# transcript-turn-grouping: Transcript Turn Grouping

**Complexity**: Level 2
**Status**: REFLECTION_COMPLETE — all merge ACs proven by tests built from real captured CLI
shapes; **AC-VISUAL-1 not re-observed in the DOM** (see § Phase 1 for why, and it is an
honest gap, not a pass)
**Reflection**: `memory-bank/reflection/transcript-turn-grouping-reflection.md`
**Roadmap**: transcript-turn-grouping
**Branch**: feature/transcript-turn-grouping (rebased onto `origin/main` 2026-08-24; the
`feature/client-styling` parent it was stacked on has since merged)
**Worktree**: N/A (in-repo checkout)

## Task Description

Make one logical exchange render as one transcript turn. See
`memory-bank/roadmap/transcript-turn-grouping.md` for the measured evidence (9 rows for one
exchange, 3 of them completely empty), the real captured CLI event shapes, and the two hazards
this design navigates: the context-usage token math and `SeasonChat`'s user-turn counting.

**Branch note**: cut off `feature/client-styling` rather than `origin/main`, by explicit user
choice — the stylesheet has to be present to verify the merged transcript actually reads
correctly. Merge the styling PR first; this branch's PR will show its commits until then.

## Specification

**Feature Type**: Bug fix (UI correctness) — changes how existing data is grouped for display
**Creative Phase Required**: No — design settled with the user pre-planning (Level 2)

### Invocation Method

- **Location**: Season Chat transcript, route `/seasons/:seasonId/chat`
- **Navigation**: both dev servers per `memory-bank/uat-config.md`; the `console/.uat-canon`
  event buffer already contains a multi-tool exchange, so no new turn is needed to see it

### Success Criteria

- **User sees**: one `USER` row followed by one `ASSISTANT` row carrying accumulated tool
  chips and the reply text — not 8 near-empty labeled rows
- **User can verify at**: the transcript itself, and Diagnostics' reported context usage being
  unchanged
- **Data persisted**: none — display-layer grouping only, no file or session change

### Acceptance Criteria

#### AC-MERGE-1: Consecutive assistant events become one turn
**Priority**: MUST
**Given** a stream in which several `assistant` events arrive in sequence (with `tool_result`
`user` events interleaved, as the real CLI emits)
**When** `groupIntoTurns` processes them
**Then** they produce a **single** assistant turn whose `toolCalls` contains every tool call
in stream order, and whose `text`/`thinking` are the non-empty parts joined with `\n\n`.

#### AC-MERGE-2: Usage is last-write-wins across a merge
**Priority**: MUST
**Given** merged assistant events carrying different `usage` blocks (the real pattern:
46640 → 50277 → 50503 → 51344)
**When** the merged turn is inspected
**Then** its `usage` is the **last** block seen, never the first and never a sum — so
`computeContextUsage` reports the most recent full-context measurement.
**And** a test asserts `computeContextUsage` over the merged shape returns the same total it
returns for the unmerged shape, pinning "this refactor changes no reported number".

#### AC-MERGE-3: User turns never merge
**Priority**: MUST
**Given** two consecutive non-`tool_result` `user` events (the shape produced when a second
message is submitted while a turn is in flight)
**When** grouping runs
**Then** they remain **two distinct** user turns.
**Why this is a MUST, not a nicety**: `SeasonChat` pops one pending-message entry per newly
observed user turn (AC-ASYNC-2 of `season-chat-conversation-loop`). Collapsing user turns
would silently desync that queue and strand a queued message in the composer.

#### AC-MERGE-4: Turn identity is stable while the turn grows
**Priority**: MUST
**Given** an assistant turn that is merged into as more events arrive
**When** `messageId` and `timestamp` are inspected
**Then** both hold the **first** merged event's values, so the React key derived from
`messageId` does not change mid-stream and remount the row.

#### AC-EMPTY-1: A contentless turn renders nothing
**Priority**: MUST
**Given** a turn with no text, no thinking, and no tool calls
**When** `TranscriptTurn` renders it
**Then** it renders **nothing at all** — no role label, no empty article.
**And** the turn object itself is **not** dropped by `groupIntoTurns`, because an otherwise
empty event can carry the only `usage` block (real data: the `thinking(0)` events carry
46640). Suppression is a render concern; discarding it in the parser could destroy token data.

#### AC-REGRESSION-1: No regression
**Priority**: MUST
**Given** the 105 tests passing on `feature/client-styling`
**When** the suite runs after this change
**Then** all pre-existing tests pass. The existing grouping test
(`stream-parser.test.ts:9`) uses a single assistant event carrying all three block types, so
it has nothing to merge and must pass **unmodified**. `typecheck` and `build:client` clean.

#### AC-VISUAL-1: The transcript actually reads correctly
**Priority**: MUST
**Given** the styled console and the existing `.uat-canon` event buffer
**When** `/seasons/season-1/chat` is opened
**Then** the 9 rows collapse to 2 (one user, one assistant with 4 tool chips and the reply),
no row shows a bare label, and **Diagnostics still reports the same context total as before
the change**.

**Manual, by design.** jsdom applies no layout, and the row-count improvement is a visual
judgment. The token-total half of this AC is also asserted automatically by AC-MERGE-2 —
belt and braces, since that number is the one thing a display refactor must not move.

## Test Strategy

### Approach
TDD on the parser: this is pure-function behavior with a precise contract, so each AC above
maps to a failing test first. The merge cases are built from the **real captured event shapes**
in `.claude-logs/skill-probe-b2-implicit.log`, not invented ones — the empty-`thinking` block
in particular is a shape a hand-written fixture would not have thought to include.

### File Organization
- `console/server/stream-parser.test.ts` — AC-MERGE-1/2/3/4
- `console/src/components/TranscriptTurn.test.tsx` — AC-EMPTY-1
- `console/src/components/DiagnosticsPanel.test.tsx` — the AC-MERGE-2 cross-check that the
  reported total is unmoved

### What NOT to Test
- Class names or computed layout (jsdom computes neither)
- The exact `\n\n` join whitespace beyond one representative assertion

## Implementation Roadmap

### Extended Source Files
- [x] `console/server/stream-parser.ts` — merge consecutive assistant events in
      `groupIntoTurns`; field semantics per AC-MERGE-1/2/4
- [x] `console/server/stream-parser.test.ts` — AC-MERGE-1/2/3/4
- [x] `console/src/components/TranscriptTurn.tsx` — return `null` for a contentless turn
- [x] `console/src/components/TranscriptTurn.test.tsx` — AC-EMPTY-1
- [x] `console/src/components/DiagnosticsPanel.test.tsx` — unmoved-total cross-check
- [x] `console/src/styles.css` — **no change needed**. This item was conditional ("adjust if
      needed"); once contentless turns stopped rendering, the existing
      `.transcript-turn--assistant + .transcript-turn--assistant` label rule worked as
      written, because real sibling adjacency now matches what the reader sees. This is
      precisely the case the rejected CSS-only alternative could not reach (`display: none`
      leaves the hidden element in the sibling chain; returning `null` removes it).
- [x] `memory-bank/techContext.md` — record the turn-grouping contract

### Phases
- [x] Phase 1: Merge logic + empty-turn render guard (single phase — the parser change and the
      render guard are two halves of one observable outcome; shipping either alone leaves the
      transcript still wrong)

## Creative Phases
- [x] None required — design settled with the user before planning (Level 2)

## Execution State

**Build Status**: IDLE
**Current Phase**: REFLECT → ARCHIVE
**Current Step**: Step 4 - Git Commit - COMPLETE
**Reflection Document**: `memory-bank/reflection/transcript-turn-grouping-reflection.md`
**Phase Being Built**: N/A — single phase complete
**Phase Number**: 1 of 1 (complete)
**Is Multi-Phase**: NO
**Last Completed**: REFLECT — reflection document written and committed (2026-08-24)
**Can Resume**: NO — no implementation or reflection work remains
**Resume From**: N/A

### Active Sub-Agents
(none)

### Completed Steps
- User reported the symptom from the styled console; read the live DOM to characterize it
  (9 rows, 7 textless, 3 fully empty) rather than reasoning from the code alone
- Read real captured CLI stream-json (`skill-probe-b2-implicit.log`) to establish actual event
  shapes: one message id spanning multiple events, empty-string `thinking` blocks, and usage
  constant within an id but growing across ids
- Traced the two hazards before designing: `computeContextUsage`'s most-recent-wins semantics
  (settles usage as last-write-wins) and `SeasonChat`'s user-turn counting (forbids merging
  user turns)
- Confirmed the consumer set is small: `groupIntoTurns` is used only by `SeasonChat.tsx`;
  `season-session.ts` uses `parseStreamJson` for the session id and parse errors, never turns
- Probed a CSS-only alternative live in the browser and **rejected it**: `:has()` hides empty
  rows, but `display: none` does not remove an element from sibling relationships, so
  `.transcript-turn--assistant + .transcript-turn--assistant` still matched through the hidden
  row and suppressed the first assistant label too

### Phase 1 (2026-08-23)

**TDD, RED first.** 8 new tests written before any implementation; the suite was watched
failing for the right reasons:

- AC-MERGE-1 → `expected length 2, got 7` — the real captured event sequence produced **7
  turns**, confirming the per-content-block split empirically rather than by reading code
- AC-MERGE-2 → `expected { input_tokens: 46640 } to deeply equal { input_tokens: 51344 }` —
  pinned that current behavior is **first-write-wins** on usage
- AC-MERGE-1 (join case) → `expected length 1, got 4`
- AC-EMPTY-1 → `TranscriptTurn` rendered a bare role label

AC-MERGE-3 (user turns never merge) and AC-MERGE-4 (first messageId) passed at RED, correctly
— nothing merged yet, so they were guards from the start rather than drivers.

**Implementation**: in `groupIntoTurns`, a run of consecutive assistant events folds into the
open turn — `text`/`thinking` joined via a new `joinNonEmpty()` (which also fixes a latent
issue where an empty block left stray separators), `toolCalls` appended, `usage`
last-write-wins guarded by `if (usage)`, `messageId`/`timestamp` left at their first values.
User turns fall through to the original new-turn path untouched. `TranscriptTurn` returns
`null` when text, thinking, and tool calls are all empty.

**Verification**: **113/113** tests across 14 files (105 pre-existing + 8 new), all
pre-existing tests **unmodified** — including `stream-parser.test.ts:9`, which passes
untouched because its single assistant event has nothing to merge. `typecheck` clean,
`build:client` clean.

### AC-VISUAL-1 — NOT verified in the browser. Honest gap.

The `.uat-canon` SSE event buffer that held the 9-row exchange **was lost mid-build**: the
stale server from the 2026-08-22 walk runs under `tsx watch`, so editing `stream-parser.ts`
restarted it and cleared its in-memory buffer. The transcript now correctly shows "No messages
yet." — zero rows because there are zero events, not because merging removed them.

Confirmed the environment is otherwise healthy after the restart: Draft Preview still polls
and renders both episodes, Approve is enabled, the grid shell still computes, 0 console
errors. So the app works; there is simply nothing in the transcript to look at.

**What this means for the claim**: the 9 → 2 row collapse is proven by
`stream-parser.test.ts`'s real-shape fixture (7 turns → 2 for the identical event sequence),
**not** re-observed in the DOM. That is a strong automated proof of the grouping contract, and
it is still not the same thing as having seen it. Recorded as open rather than inferred.

Driving one real turn through the UI would close it — deliberately not done here because it
spawns a real `claude -p` and spends tokens the user did not ask to spend. The pre-change
Diagnostics reading for that buffer was **56,478 / 200,000 (28%)** per the
`headless-draft-writes` AC-VERIFY-1 evidence; whoever drives the next turn should confirm the
reported total still tracks the most recent usage block and has not inflated (a sum would show
roughly 4× that) — the sharpest single check that the merge is correct in the running app.

### Rebase onto `origin/main` + re-verification (2026-08-24, at `/bmb:reflect`)

The branch was cut off `feature/client-styling` while that work was still open. Both it and
`task/console-dev-ports` have since merged (PRs #8 and #7), leaving this branch 12 commits
behind `origin/main`. Sync-Before-Resume rebased it; `git merge-tree` predicted a clean merge
first, and the rebase was clean in fact — the stacking dependency dissolved on its own, since
the parent's commits were already in `main`.

Re-verified **after** the rebase, because it pulled in `console-dev-ports`' changes to
`console/` (`ports.ts`, `vite.config.ts`, `vitest.config.ts`, `server/index.ts`):

- **115/115 tests green across 15 files** — 113 from this branch's own verification plus the
  2 `ports.test.ts` tests that arrived with the rebase. No pre-existing test modified.
- `typecheck` clean, `build:client` clean (37 modules, 8.56 kB CSS, 173.86 kB JS).

The merge logic is therefore proven green against current `main`, not only against the
now-historical `client-styling` tip it was written on.

**Correction to the stale-process note below**: the ports moved to 61XX when
`console-dev-ports` merged. Server is now 6187 and Vite 6173 — the 8787/5173/5174 figures
below are pre-rebase and no longer apply.

### Resumption Notes
**Notes**: No implementation work remains. One real turn through the UI closes AC-VISUAL-1 and
would confirm both the 2-row transcript and the un-inflated Diagnostics total.

**Stale processes**: the 2026-08-22 server still owns port 8787 (now restarted onto this
branch's code by `tsx watch`) and an old Vite owns 5173, so this build's Vite is on 5174.
Kill both by PID before the next UAT run.
