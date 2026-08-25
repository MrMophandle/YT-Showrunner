# Archive: Transcript Turn Grouping

## Metadata
- Task: transcript-turn-grouping
- Complexity: Level 2
- Roadmap feature: transcript-turn-grouping
- Completed: 2026-08-24
- Branch: `feature/transcript-turn-grouping` (rebased onto `origin/main` 2026-08-24)
- Reflection: `memory-bank/reflection/transcript-turn-grouping-reflection.md`

> ## ⚠️ Archived with one MUST acceptance criterion OPEN
>
> **AC-VISUAL-1 was never verified in the DOM.** This archive records the task as complete
> because its implementation and reflection are complete and the PR is open for review — it
> does **not** assert that all six MUST criteria are closed. Five are. The sixth is open, by
> deliberate record rather than by oversight.
>
> `_learned/process-hygiene.md` carries a rule (from `client-styling`) that says not to let
> code merge while a MUST AC is open. That rule is respected here precisely because archiving
> under `push-and-pr` **opens a PR and merges nothing** — the merge decision stays with a
> human who can see this callout. Close AC-VISUAL-1 before merging. See § Open Verification.

## Summary

The Season Chat transcript rendered one logical exchange — a user prompt, three tool
round-trips, and a reply — as **9 rows**, 7 of them carrying no text and 3 carrying nothing
at all but a bare `ASSISTANT` label. Reported by the user looking at the freshly styled
console: *"what is all that Assistant BASH Assistant BASH stuff?"*

The cause was a mismatch between two units that look identical from the outside. The Claude
CLI emits one stream-json `assistant` event **per content block** (several events sharing one
`message.id`), while `groupIntoTurns` created one turn **per event**. One API message became
several rows; one exchange became nine.

## Solution

Two halves of one observable outcome, shipped as a single phase:

**Parser (`groupIntoTurns`)** — a run of consecutive assistant events folds into the open
turn. `tool_result` user events continue to attach to the current turn, so tool round-trips
do not break a run. Field semantics, each chosen against a specific hazard:

| Field | Rule | Why |
|---|---|---|
| `text` / `thinking` | join non-empty parts with `\n\n` | new `joinNonEmpty()`; the CLI emits empty-string `thinking` blocks, and a naive join leaves stray separators that render as a contentless row |
| `toolCalls` | append in stream order | accumulates every chip onto one row |
| `usage` | **last-write-wins**, guarded by `if (usage)` | each block is the *full* context for its request, not a delta |
| `messageId` / `timestamp` | keep the **first** value | React keys off `messageId`; changing it mid-stream would remount a growing row |

**Component (`TranscriptTurn`)** — returns `null` when text, thinking, and tool calls are all
empty.

### The two hazards this design navigated

1. **The token math.** `computeContextUsage` walks turns backwards and returns the first
   usage block it finds, because each block measures full context rather than an increment.
   Summing merged blocks would have reported ~198k of a 200k window and fired a false
   near-limit warning; keeping the first would have reported a stale, too-low number.
   Last-write-wins reproduces the pre-change number exactly — on the real captured data,
   46640 → 50277 → 50503 → 51344 yields 51344 either way. **The merge moves no reported
   number**, and AC-MERGE-2 pins that with a test.

2. **`SeasonChat`'s user-turn counting.** It pops one pending-message queue entry per newly
   observed user turn (AC-ASYNC-2 of `season-chat-conversation-loop`). Merging two
   consecutive user turns would silently desync that queue and strand a queued message in the
   composer forever. Hence *assistant runs merge, user turns never* — an invariant with its
   own MUST criterion (AC-MERGE-3) and its own test, not a passing note in a comment.

### Suppression lives in the component, not the parser

Deliberately **not** implemented by dropping empty turns in `groupIntoTurns`. An otherwise
contentless event can carry the only `usage` block in a stream — in the real capture, the
`thinking(0)` events carry 46640 — so discarding it in the parser would silently destroy
token accounting. The turn survives for the math and simply does not render.

### The CSS-only alternative, killed empirically

`:has()` to hide empty rows was probed live in the browser and rejected: `display: none` does
not remove an element from **sibling relationships**, so
`.transcript-turn--assistant + .transcript-turn--assistant` still matched *through* the
hidden row and suppressed the label on the first real assistant row too. Adjacent-sibling
combinators operate on the DOM tree, not the render tree. This also retroactively justified
the render guard as *necessary*, not merely tidier — and it is why `styles.css` needed no
change at all once `TranscriptTurn` returned `null`: real sibling adjacency finally matched
what the reader sees.

## Files Changed

| File | Change |
|---|---|
| `console/server/stream-parser.ts` | assistant-run merge in `groupIntoTurns`; new `joinNonEmpty()`; extensive contract comments (+73/−17) |
| `console/server/stream-parser.test.ts` | AC-MERGE-1/2/3/4 from real captured event shapes (+164) |
| `console/src/components/TranscriptTurn.tsx` | return `null` for a contentless turn (+13) |
| `console/src/components/TranscriptTurn.test.tsx` | AC-EMPTY-1 (+44) |
| `console/src/components/DiagnosticsPanel.test.tsx` | unmoved-total cross-check for AC-MERGE-2 (+26) |
| `console/src/styles.css` | **no change needed** — conditional roadmap item; the existing label rule worked once contentless rows stopped rendering |
| `memory-bank/techContext.md` | records the turn-grouping contract (+23) |
| `memory-bank/productBrief.md` | story-shaping session captured as the primary user flow (+99) |

## Verification

Re-run on 2026-08-24 **after** rebasing onto `origin/main`, because the rebase pulled
`console-dev-ports`' changes into `console/`:

- **115/115 tests green across 15 files** — 113 from this branch's own build plus the 2
  `ports.test.ts` tests that arrived with the rebase.
- **Every pre-existing test passed unmodified**, including `stream-parser.test.ts:9`, whose
  single assistant event has nothing to merge (AC-REGRESSION-1).
- `typecheck` clean; `build:client` clean (37 modules, 8.56 kB CSS, 173.86 kB JS).

### Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| AC-MERGE-1 consecutive assistant events become one turn | ✅ | RED at `expected length 2, got 7` |
| AC-MERGE-2 usage last-write-wins, reported total unmoved | ✅ | RED at `{ input_tokens: 46640 }` vs `51344` |
| AC-MERGE-3 user turns never merge | ✅ | guard test, passed at RED by design |
| AC-MERGE-4 stable `messageId`/`timestamp` | ✅ | guard test, passed at RED by design |
| AC-EMPTY-1 contentless turn renders nothing | ✅ | RED at a rendered bare role label |
| AC-REGRESSION-1 no regression | ✅ | 115/115, typecheck + build clean |
| **AC-VISUAL-1 the transcript actually reads correctly** | ❌ **OPEN** | see below |

## Open Verification — AC-VISUAL-1

The `.uat-canon` SSE buffer holding the original 9-row exchange **was destroyed mid-build**.
`stream-parser.ts` is server code, the dev server runs under `tsx watch`, and an in-memory
buffer does not survive a process restart — so editing the fix restarted the process holding
the only evidence available to verify it. The transcript now reads "No messages yet.": zero
rows because there are zero events, **not** because merging worked.

The 7→2 turn collapse is proven by `stream-parser.test.ts`'s fixture, built from the
identical real captured event sequence. That is strong evidence of the grouping contract, and
it is still not the same as having observed the DOM. Recorded as open rather than inferred.

**To close it** — drive one real Season Chat turn through the UI and check two things:

1. The exchange renders as **2 rows** (one user, one assistant carrying the tool chips and
   the reply), with no row showing a bare label.
2. **Diagnostics' reported context total tracks the most recent usage block and has not
   inflated.** The pre-change reading for that buffer was **56,478 / 200,000 (28%)** per
   `headless-draft-writes` AC-VERIFY-1. A summing bug would show roughly **4×** that — this
   is the sharpest single check that the merge is correct in the running app.

Not done during the build because it spawns a real `claude -p` and spends tokens the user did
not ask to spend. Note the ports moved to **6187** (server) and **6173** (Vite) when
`console-dev-ports` merged; kill stale watchers by PID first.

## Learning Consolidation

Purely additive — no rules merged, retired, expired, or pruned. Two topic files amended:

- **`testing-patterns.md`** — evidence 3 → 4. New bullet: build fixtures from real captured
  production output. Hand-invented fixtures reliably omit the edge shape that *is* the bug —
  here, an empty-string `thinking` block nobody would have thought to write.
- **`process-hygiene.md`** — evidence 2 → 3, **promoted `low` → `medium`** at the threshold.
  New bullet on durable verification fixtures under file-watching servers, plus confirming
  second-instance evidence on two bullets `client-styling` contributed (unticked roadmap
  checkboxes; archiving with a MUST AC still open).

## Notes

- **The most valuable output of this task is a judgment call, not a code change.** With
  115/115 green and a fixture built from real captured shapes, the temptation to call
  AC-VISUAL-1 "verified in spirit" was real. The task file instead names what is proven, what
  is not, exactly why, and hands the next verifier a specific cheap check. That artifact is
  worth more than a false PASS.
- **The branch was stacked on `feature/client-styling` by explicit user choice**, so the
  merged transcript could be judged with styles present rather than only by row count. The
  known cost — a rebase once the parent merged — materialized exactly as predicted when both
  `client-styling` and `console-dev-ports` landed first. It resolved cleanly (`git merge-tree`
  predicted no conflicts; the rebase confirmed it), but partly because the branches touched
  disjoint files. The rationale was sound and the cost was bounded and foreseen.
- **Level 2 held up under a real edge case.** The change altered the semantics of a type two
  components consume (`NormalizedTurn`, read by `TranscriptTurn` and `computeContextUsage`).
  That stayed Level 2 because the consumer set was small and **actually enumerated** rather
  than assumed — `season-session.ts` was checked and uses `parseStreamJson` only for the
  session id and parse errors, never turns.
