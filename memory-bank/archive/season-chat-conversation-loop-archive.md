# Archive: Season Chat Conversation Loop

## Metadata
- Task: season-chat-conversation-loop
- Complexity: Level 3 (3 build phases)
- Started: 2026-08-17
- Completed: 2026-08-18
- Roadmap Link: `season-chat-conversation-loop` (version `next`)
- Branch: `feature/season-chat-conversation-loop`
- Predecessor: `conversational-season-drafting` (Level 4)

## Summary

Closed the three integration wires that the predecessor task `conversational-season-drafting`
left disconnected. Every component of the drafting loop existed and was unit-tested (63/63
green) at the end of that task, yet the Season Chat app could not hold a conversation at
all — the defects were entirely in the wiring *between* correct units:

1. **The composer was a no-op** — `SeasonChat.tsx`'s `onSubmit` called `preventDefault()`
   and cleared the textarea; no POST route for sending a message existed.
2. **`context-bundle.ts` was orphaned** — `assembleContextBundle()`,
   `renderContextBundle()`, and `buildTurnPrompt()` were exported and tested but imported
   by nobody, so design decision #3 ("first turn must be context-seeded, never a
   cold-start") was not in effect at runtime.
3. **The `season-drafting` skill was never invoked** — nothing pointed the spawned
   headless `claude -p` process at the skill that maintains `season.draft.json`, so Draft
   Preview and Approve had no input.

The fix routes **both** message-bearing routes through a single `SeasonTurnRunner` that
owns first-turn prompt composition and a per-season FIFO queue. This also closed a latent
cold-start hole where a first-ever `POST /reject` would have created a session with no
context bundle and no skill.

## Requirements

### Original Requirements
- Add `POST /api/seasons/:seasonId/message` so the composer can actually send
- Give the app one turn-composition path instead of two divergent ones
- Seed the first turn with verbatim canon context and load the drafting skill
- Wire the composer with in-flight, pending, and error states
- Never report a crashed turn as a success

### Success Criteria
- [✓] User's typed message appears in the transcript, followed by the model's reply
      streaming in token-group by token-group
- [✓] `<canonRoot>/seasons/<seasonId>/.yts-session.json` re-persisted every turn
- [ ] `season.draft.json` written by the skill and rendered by Draft Preview —
      **UNVERIFIED**, see AC-HAPPY-4 below
- [✓] Reply events appear as the process emits them (no wait for turn completion)

### Acceptance Criteria (12 total — 11 automated, 1 manual by design)
- [✓] AC-ENTRY-1 — composer issues `POST /message`, clears, disables `Send` in flight
- [✓] AC-HAPPY-1 — first turn carries `/season-drafting` + byte-for-byte ledger text;
      absent source files omitted entirely rather than rendered as empty headings
- [✓] AC-HAPPY-2 — later turns `--resume` with the bare message (no bundle, no prefix)
- [✓] AC-HAPPY-3 — server publishes a synthetic user event after `startTurn()`
- [ ] AC-HAPPY-4 — skill maintains `season.draft.json` — **UNVERIFIED AT ARCHIVE TIME.**
      This AC was correctly carved out as manual-only (the suite cannot prove it — see
      Design Decisions), but the required evidence was never recorded. See
      "AC-HAPPY-4 evidence gap" below. **This is the one unproven link in the chain**:
      it is the AC that establishes the app does the thing it exists to do.
- [✓] AC-ASYNC-1 — messages queue FIFO; exactly one process per season per server instance
- [✓] AC-ASYNC-2 — queued messages visible while pending, and rendered exactly once
- [✓] AC-ERROR-1 — crashed turn returns `502` with `{error, crashed, exitCode}`, never `200`
- [✓] AC-ERROR-2 — crash publishes `yts_error`, discards the queue, restores discarded
      text to the composer joined in queue order
- [✓] AC-ERROR-3 — invalid `seasonId` / malformed body / empty message rejected `400`
      with no spawn, allowlist enforced at all three boundaries
- [✓] AC-INTEGRATION-1 — both routes share one turn path; `SignoffPanel` treats `202` as
      a distinct "notes queued" state
- [✓] AC-VERIFY-1 — all 63 pre-existing tests still pass unmodified; typecheck and
      `build:client` clean

## Implementation

### Approach
Integration-weighted TDD across three phases matching the natural seams (server core →
HTTP surface → UI). The single most consequential structural choice was collapsing both
entry points onto one composition function, which is what makes the "first turn is always
seeded" invariant hold unconditionally rather than only on the path someone tested by hand.

### Key Components

1. **`SeasonTurnRunner`** (new)
   - Purpose: owns first-turn prompt composition, the synthetic user echo, the per-season
     FIFO queue, the drain loop, and the crash-discard policy
   - Files: `console/server/turn-runner.ts`, `console/server/turn-runner.test.ts`
   - Exposes `submit()` (queued, `202`-capable) and `submitAwait()` (preserves `/reject`'s
     historical synchronous contract), both composing through shared
     `runSingleTurn()` / `handleTurnOutcome()`

2. **First-turn prompt composition** (extended)
   - Purpose: emit the `/season-drafting` skill invocation and the context bundle only
     when `store.load(seasonId) === null` — two orphaned wires collapsed into one edit
   - Files: `console/server/context-bundle.ts` (`SEASON_DRAFTING_SKILL_COMMAND`),
     `console/server/context-bundle.test.ts`

3. **HTTP surface** (extended)
   - Purpose: new `POST /api/seasons/:seasonId/message`; `/reject` rewired through the
     runner, closing the cold-start hole
   - Files: `console/server/index.ts`, `console/server/index.test.ts`

4. **Client wiring** (extended)
   - Purpose: composer submit, in-flight/pending/error state, pending list with FIFO drop
     on incoming user turn, `yts_error` alert with discarded-text restoration
   - Files: `console/src/pages/SeasonChat.tsx`, `console/src/pages/SeasonChat.test.tsx`,
     `console/src/components/SignoffPanel.tsx`, `console/src/components/SignoffPanel.test.tsx`

### Design Decisions

- **Single shared turn path** — both routes compose through one runner rather than
  `/reject` keeping its direct `sendMessage()` call. This is the decision most responsible
  for the task achieving its stated goal rather than adding a working path beside a broken one.
- **First-turn-only skill prefix sharing the context bundle's lifetime** — both keyed off
  the same `store.load() === null` signal, empirically justified by the probe showing
  `--resume` carries the skill forward.
- **Server-published synthetic user echo** over client-side optimistic rendering — every
  connected tab sees the same state and reconnection-replay works; it is also what makes
  the pending-list FIFO-drop mechanism correct.
- **Queue-on-busy (`202` + position) with discard-queue-on-crash** — draining into a
  session of uncertain state would be worse than losing typed text, and the text is
  recoverable via composer restoration.
- **`/season-drafting ` prefix chosen by empirical probing**, not `--append-system-prompt`
  or inlined SKILL.md. Five real probe runs against the installed CLI (**2.1.229**) settled
  the unknown before design lock: skills are auto-**discovered** from `.claude/skills/` but
  **not** auto-invoked; the slash-command prefix loads the skill deterministically with zero
  tool calls; `--resume` carries it forward. `buildArgs()` needed no change at all.
- **AC-HAPPY-4 carved out as manual verification** — every test in this suite injects
  `spawnFn`, so no automated test can cause a real skill to write a real draft file, and a
  test that writes the draft itself would assert nothing about skill invocation. The
  automated guarantee was redirected to AC-HAPPY-1 (the composed prompt provably carries
  the invocation), which the suite genuinely can prove.

Reference: `memory-bank/creative/season-chat-conversation-loop-design.md`

## Plan Critique

Backend `anthropic` (same-provider self-critique — no Codex companion installed).
Verdict **REVISE**: 5 findings (2 high, 2 medium, 1 low), all applied to the spec **before
Phase 1 started**. F1 (AC-HAPPY-4 unverifiable across a mocked boundary) and F2 (`/reject`
acquiring a `202` that `SignoffPanel.tsx:89`'s exact `res.status === 200` check would
render as "The turn failed to complete", inviting a resend that double-queues) were both
real defects that would otherwise have shipped silently.

## Testing

- Tests added: **26** (63 → **89** across 14 files)
  - Phase 1: 12 (10 turn-runner + 2 context-bundle; plan estimated ~10)
  - Phase 2: 7 (matched plan exactly)
  - Phase 3: 7 (6 SeasonChat + 1 SignoffPanel; matched plan exactly)
- All tests passing: ✅ 89/89
- `npm run typecheck`: clean · `npm run build:client`: clean · no lint script defined
- RED→GREEN confirmed each phase (Phase 1 RED at 11 failing → GREEN 75/75)
- AC-HAPPY-4 **not** verified — see the evidence gap below. It was correctly excluded
  from the automated suite, but the substitute manual evidence was never captured.

### AC-HAPPY-4 evidence gap (found during archive, recorded honestly)

The task spec was explicit (`tasks/season-chat-conversation-loop.md:130`): the manual
runbook must be *"run once at the end of Phase 3 and recorded in Execution State with the
observed output."* At archive time that evidence does not exist:

| Check | Result |
|---|---|
| Phase 3 Execution State runbook entry + observed output | **Absent** (Steps 0.5/0.6/3/7/8/9/10 recorded; no runbook step) |
| `season.draft.json` anywhere in the repo | **None found** |
| `.yts-session.json` anywhere in the repo | **None found** |
| Are those artifacts gitignored? | **No** — and the tree is clean, so they are not merely untracked |
| Runbook target path `console/fixtures/canon/seasons/2/` | **Does not exist** — fixtures contain only `seasons/season-1/` |
| `seasonId` consistency | Runbook says `2`; fixtures and `App.tsx:10`'s redirect both say `season-1` |

It may have been run against a different canon root and cleaned up, but no trace remains.
The reflection document states AC-HAPPY-4 was "verified manually per task spec"; that claim
is **unsupported by any recorded evidence**, and the first version of this archive repeated
it. Corrected here rather than left standing.

**Consequence**: the automated suite proves the composed prompt carries the
`/season-drafting` invocation (AC-HAPPY-1), and 5 planning-time probe runs proved the CLI
loads a skill from that prefix. What remains unproven is the end-to-end link — that this
server, spawning this process, causes the skill to write a draft this app then renders.
Closing it is follow-up #1 and the first thing the pending UAT walk should target.

## Files Changed

- `console/server/turn-runner.ts` — new: `SeasonTurnRunner` (+232)
- `console/server/turn-runner.test.ts` — new: runner unit tests (+371)
- `console/server/context-bundle.ts` — skill prefix + `SEASON_DRAFTING_SKILL_COMMAND` (+18/-)
- `console/server/context-bundle.test.ts` — prefix behavior incl. empty-bundle branch (+37/-)
- `console/server/index.ts` — `POST /message`, runner construction, `/reject` rewire (+85/-)
- `console/server/index.test.ts` — `/message` contracts + cold-start `/reject` (+291/-)
- `console/src/pages/SeasonChat.tsx` — composer wiring, pending list, error alert (+142/-)
- `console/src/pages/SeasonChat.test.tsx` — new: composer tests (+173)
- `console/src/components/SignoffPanel.tsx` — distinct `202` "notes queued" state (+13/-)
- `console/src/components/SignoffPanel.test.tsx` — `202` state test (+25)
- `memory-bank/techContext.md` — endpoint rows, per-phase scope sections
- `memory-bank/systemPatterns.md` — Pattern #8: Per-Season Single-Flight Queue with
  Crash-Discard Policy (extended each phase, incl. Client-Level Usage)

Totals vs `origin/main`: 17 files, +2544 / −53.

## Implementation Timeline

| Commit | Date | Phase |
|---|---|---|
| `d332622` | 2026-08-17 | brainstorm — design approved (feature + task + creative) |
| `a3b9c7a` | 2026-08-17 | Phase 1: turn runner + prompt composition |
| `34e08d0` | 2026-08-17 | Phase 2: documentation (docs-only) |
| `84c9e81` | 2026-08-17 | Phase 2: routes — `POST /message` + `/reject` rewire |
| `7d376da` | 2026-08-18 | Phase 3: composer wiring (client) |
| `287da8a` | 2026-08-18 | reflection |

## Lessons Learned

- **A fully unit-tested module with zero real importers is not a smaller version of
  "done" — it is a specific, checkable failure mode.** The fix ("grep every new export for
  a call site outside its own test file") is cheap enough to run every phase.
- **Route every entry point that triggers a stateful side effect through one composition
  function.** It is the cheapest way to guarantee a cross-cutting invariant holds
  everywhere, not just on the path someone happened to test by hand.
- **When a suite mocks the exact boundary an AC describes behavior across**, redirect the
  automated guarantee to what is provable on the caller's side and give the
  boundary-crossing behavior an explicit one-time manual runbook. Do not let a green suite
  imply coverage it does not have, and do not fake coverage with a test that performs the
  effect it is supposed to be checking.
- **Settle undocumented external-tool behavior with a handful of real probe runs before
  design lock.** Five runs eliminated two candidate implementations outright and pinned the
  exact string shape shipped.
- **A pre-build plan-critique gate is high-leverage** for second-order, cross-file
  consequences of a design decision — the `202`/`SignoffPanel` bug was three files away
  from the decision that caused it.

Reference: `memory-bank/reflection/season-chat-conversation-loop-reflection.md`

## Build Quality Signals

- 0 commit-guard FAILs across 3 phases (Guard & Recovery Log empty)
- 0 blocking code-review findings (predecessor Level 4 task shipped 2)
- 0 sub-agent re-invocations / fix-pass re-dispatches
- 13 sub-agent dispatches total (12 build quartet + 1 plan critique) vs the predecessor's 22

## References
- Task plan: `memory-bank/tasks/season-chat-conversation-loop.md`
- Reflection: `memory-bank/reflection/season-chat-conversation-loop-reflection.md`
- Creative: `memory-bank/creative/season-chat-conversation-loop-design.md`
- Roadmap feature: `memory-bank/roadmap/season-chat-conversation-loop.md`
- Predecessor archive: `memory-bank/archive/conversational-season-drafting-archive.md`
- Timeline: `git log --oneline main..feature/season-chat-conversation-loop`

## Follow-up

1. **Close the AC-HAPPY-4 evidence gap — highest priority.** Run the runbook and record
   the observed output. Settle the `seasonId` inconsistency first (`season-1` vs `2`): it
   may be a stale runbook, or it may mean `/approve`'s write path has never been exercised.
   This is the single unproven link between "the tests pass" and "the app works," and it is
   the natural first target of the pending UAT walk.
2. **Immediate-crash data-loss edge case** (from Phase 3 code review, non-blocking): a
   crash of a *just-submitted* message does not restore that message to the composer —
   only the remaining queue is restored via `discardedMessages`. Narrow but real; the
   reflection explicitly asked that this be tracked rather than allowed to fade at archive.
3. **UAT was never run.** This task closed the loop that makes the app interactive for the
   first time, so a real walk (compose → send → see reply stream → draft appears) is now
   possible for the first time in the project's history. Blocked on one-time setup: no
   journey doc, no `uat-config.md`, no `ux-patterns.md` exist yet.
4. **`.agent-logs/claude/by-task/<slug>/` indexing is still unpopulated** — this was the
   second consecutive reflection forced to fall back to date-directory scanning. Should not
   be deferred a third time.
5. **`productBrief.md` is stale, not just incomplete** — it still reads *"Greenfield —
   repository currently contains only a LICENSE file; no source tree established yet"* and
   `Stage: Concept`, alongside placeholder personas and NFRs. Every Level 2-4 plan reads
   this file as product context, so the staleness actively misinforms planning.
6. **Plan-critique independence**: the seam runs `configured:anthropic` (same model family
   critiquing its own plan). It has performed well twice; worth revisiting before assuming
   the quality bar holds on a harder task.
