---
version: next
status: completed
priority: medium
complexity: 2
linked_tasks: [transcript-turn-grouping]
created: 2026-08-23
completed: 2026-08-24
---

> **Completed 2026-08-24.** The only linked task (`transcript-turn-grouping`) is archived at
> `memory-bank/archive/transcript-turn-grouping-archive.md`. **All six MUST acceptance
> criteria are closed** — five by tests built from real captured CLI shapes, and AC-VISUAL-1
> by a real browser walk against a real `claude -p` turn on 2026-08-24 (9→2 row collapse
> observed; Diagnostics positively identified last-write-wins at 60,367, where a summing bug
> would have shown 239,305).

# Transcript Turn Grouping

Make one logical exchange render as one transcript turn. Today `groupIntoTurns` creates a
turn per stream-json **message event**, and the Claude CLI emits a separate `assistant` event
per content block — so a single exchange in which the model reads canon three times and writes
the draft renders as 8 near-empty rows, each with its own "ASSISTANT" label, with the real
reply only in the last one.

## Evidence (measured, not inferred)

Reported by the user looking at the styled console on 2026-08-23 ("what is all that Assistant
BASH Assistant BASH stuff?"). Read live from the DOM at `/seasons/season-1/chat`, replaying
the 2026-08-22 event buffer — 9 rows for one exchange:

| Row | Label | Content |
|---|---|---|
| 1 | USER | "Let's start planning the next season…" |
| 2 | ASSISTANT | **nothing** |
| 3 | ASSISTANT | `Bash` |
| 4 | ASSISTANT | `Bash` |
| 5 | ASSISTANT | **nothing** |
| 6 | ASSISTANT | `Write` |
| 7 | ASSISTANT | `Bash` |
| 8 | ASSISTANT | **nothing** |
| 9 | ASSISTANT | the actual reply |

7 of 8 assistant rows carry no text; 3 carry nothing at all.

The event shapes were then read from real captured CLI output
(`.claude-logs/skill-probe-b2-implicit.log`, `claude` 2.1.229) rather than assumed:

```
1 assistant id=XmSVLFhJ  usage=46640  [thinking(0)]      <- empty-string thinking block
2 assistant id=XmSVLFhJ  usage=46640  [tool_use:Bash]    <- SAME message id
3 user                                [tool_result]
4 assistant id=jzeaC59R  usage=50277  [thinking(0)]
5 assistant id=jzeaC59R  usage=50277  [tool_use:Bash]
6 user                                [tool_result]
7 assistant id=DSstULub  usage=50503  [tool_use:Bash]
8 user                                [tool_result]
9 assistant id=2mqcBTFN  usage=51344  [text(135)]
```

Three facts this settled, two of which contradicted the initial assumption:

1. **The CLI splits one assistant message across several events, keeping the same
   `message.id`.** Events 1–2 are one API message, not two turns.
2. **The blank rows are `thinking` blocks containing the empty string.** Nothing extractable,
   so the row renders a role label and nothing else. Not a mystery and not a styling artifact.
3. **`usage` is identical within a message id and grows across ids**
   (46640 → 50277 → 50503 → 51344). This is what makes the merge safe — see below.

## The token-math hazard, and why the chosen merge is safe

`computeContextUsage` (`DiagnosticsPanel.tsx`) walks turns backwards and returns the **first
turn carrying a usage block**, because each block is the *full* context for that request, not
an incremental delta. So:

- **Summing** merged usage blocks would be meaningless (adding full-context measurements).
- **First-write-wins** would report stale, too-low usage.
- **Last-write-wins** is correct, and on the real data above yields 51344 — identical to what
  the current per-event grouping reports. **The merge changes no reported number.**

## The second hazard: never merge user turns

`SeasonChat` counts user-role turns to decide when to pop its pending-message queue
(AC-ASYNC-2 of `season-chat-conversation-loop`). If a merge ever collapsed two consecutive
**user** turns, that queue would silently desync and a queued message would linger in the
composer forever. Assistant runs merge; user turns must never. This is an invariant with its
own test, not a passing note.

## Approved design decisions

- **Merge consecutive assistant events into one logical turn**, regardless of `message.id` —
  one user message plus all the model's work and its reply is one exchange, which is what a
  reader wants. `tool_result` user events continue to attach to the open turn without
  breaking the run.
- **Field semantics**: `text`/`thinking` concatenate non-empty parts with `\n\n`; `toolCalls`
  append; `usage` last-write-wins; `messageId` and `timestamp` keep the **first** value —
  React keys off `messageId`, so changing it while the turn grows would remount the row
  mid-stream.
- **Blank-row suppression lives in the component, not the parser.** `TranscriptTurn` returns
  `null` for a turn with no text, no thinking, and no tool calls. Deliberately not done by
  dropping turns in `groupIntoTurns`: an otherwise-empty event can carry the only `usage`
  block (the `thinking(0)` events carry 46640), so dropping there could discard token data.
  The turn survives for the math and simply does not render.

**Complexity rationale**: Level 2 — a contained change to one pure function plus a
render-guard in one component, with a well-understood consumer set (two call sites, both
read). No new architecture, no new dependency, no server behavior change. Not Level 1 because
it alters the semantics of a type two components depend on and touches the input to the
context-usage math.

## Scope boundaries

**Out of scope**: rendering tool-call *arguments* or results (chips stay name-only);
collapsing or virtualizing long transcripts; streaming-progress indicators; any change to
`computeContextUsage` itself; the `react-router` v7 bump.
