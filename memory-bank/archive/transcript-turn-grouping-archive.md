# Archive: Transcript Turn Grouping

## Metadata
- Task: transcript-turn-grouping
- Complexity: Level 2
- Roadmap feature: transcript-turn-grouping
- Completed: 2026-08-24
- Branch: `feature/transcript-turn-grouping` (rebased onto `origin/main` 2026-08-24)
- Reflection: `memory-bank/reflection/transcript-turn-grouping-reflection.md`

> ## ✅ All six MUST acceptance criteria closed
>
> This archive was originally written with **AC-VISUAL-1 open** — recorded honestly as an
> unverified MUST rather than inferred from a green suite. It was **closed the same day**
> (2026-08-24) by driving a real turn through the UI at the user's request. See
> § AC-VISUAL-1 — Closed for the evidence.
>
> The sequencing worked as `_learned/process-hygiene.md` prescribes: archiving under
> `push-and-pr` merges nothing, so the open MUST rode visibly on PR #9 as a DO-NOT-MERGE
> callout until it was actually closed — never a silent pass, and never a merge against an
> open criterion.

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
| **AC-VISUAL-1 the transcript actually reads correctly** | ✅ | real browser + real turn, below |

## AC-VISUAL-1 — Closed

**Why it was open at first.** The `.uat-canon` SSE buffer holding the original 9-row exchange
was destroyed mid-build: `stream-parser.ts` is server code, the dev server runs under
`tsx watch`, and an in-memory buffer does not survive a restart — so editing the fix restarted
the process holding the only evidence for it. Rather than infer a pass from a green suite, the
build recorded it open.

**How it was closed** (2026-08-24). Stale watchers killed by PID, both servers restarted from
known-good config, and one real turn driven through the UI. Prompt chosen to force multiple
tool calls, since a single-event reply would exercise no merging at all.

The SSE replay buffer, read back raw, contained **4 assistant events across 2 message ids**
with 2 interleaved `tool_result` user events — including a `thinking(0)` **empty-string
block**, the exact shape that motivated the fix, appearing again in fresh live traffic. Under
the old per-event grouping that renders **5 rows**, three textless and one a bare label.

**Observed: 2 rows** — one `USER`, one `ASSISTANT` carrying both `Read` chips *and* the reply
text. No bare labels, no empty rows, 0 console errors.
Screenshot: `.claude-logs/ac-visual-1-pass-20260824.jpg`.

**The token math was discriminated, not eyeballed.** The four usage blocks totalled
59646 / 59646 / 59646 / 60367 — and each candidate semantics predicts a *different* number,
so the observation identifies exactly one:

| Semantics | Would display | Verdict |
|---|---|---|
| Sum | **239,305** | 120% of a 200k window — the false over-limit alarm the design predicted |
| First-write-wins | **59,646** | stale |
| **Last-write-wins** | **60,367** | ✅ **matches the screen exactly** |

Diagnostics read **60,367 / 200,000 (30%)**. The "roughly 4×" prediction for a summing bug
was accurate (239,305 / 60,367 ≈ 3.96×). This is a positive identification of last-write-wins
in the running app rather than a merely plausible total.

One incidental finding: `uat-config.md` documents the server start as
`YTS_CANON_ROOT=console/.uat-canon npm run dev:server --prefix console`, but that relative
path resolves against the `--prefix` directory and would land at `console/console/.uat-canon`.
An absolute path was used instead. Worth fixing in `uat-config.md`.

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
  AC-VISUAL-1 "verified in spirit" was real. The task file instead named what was proven, what
  was not, exactly why, and handed the next verifier a specific cheap check — which is
  precisely what made closing it later a ten-minute job with an unambiguous result. The
  discipline paid off twice: once by not shipping a false PASS, and again by making the real
  verification cheap and mechanical when it happened.
- **The predicted failure signature was correct.** The design argued a summing bug would show
  "roughly 4×" the true total. When measured, a sum would have shown 239,305 against an actual
  60,367 — 3.96×. Writing down what a specific bug *would look like* turned the eventual check
  from a judgment call into a lookup.
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
