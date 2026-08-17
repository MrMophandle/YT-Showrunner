# Season Chat Conversation Loop — Design

**Task**: season-chat-conversation-loop
**Date**: 2026-08-17
**Author**: `/bmb:brainstorm` (conversational design session)

## Context

`conversational-season-drafting` shipped 5 phases, 63 green tests, and a clean
typecheck — and an app that cannot accept a typed message. Every unit of the
conversation loop exists and is correct in isolation; three wires between them were
never connected. This design covers only those wires.

The starting position, verified by reading the code rather than the docs:

- `SeasonChat.tsx:94` — `onSubmit` does `preventDefault()` + clear textarea. No POST route exists.
- `context-bundle.ts` — three exported functions, 6 passing tests, zero importers.
- `season-session.ts:53` — `buildArgs()` points at no skill, so `season.draft.json` is never written.
- `index.ts:194` — `/reject` is the only caller of `sendMessage()`, making "Reject with notes" the only working chat input.

## Empirical work done before design lock

The one genuine unknown — how a headless `claude -p` loads a project skill — was settled
with five real runs against the installed CLI (**2.1.229**) before any design was chosen.
This was deliberate: the previous task's reflection called out that its own
LOW-confidence CLI unknowns were folded into a Phase 1 TDD pass rather than probed
first, and recommended a lighter targeted step instead.

| Probe | Result |
|---|---|
| Discovery from `.claude/skills/` | **Yes** — `init` event lists `season-drafting` among 86 `slash_commands` |
| cwd sensitivity | **None** — resolves to project root; discovered from `console/` too |
| Auto-invocation by the model | **No** — un-prefixed prompt never loaded SKILL.md; model used 3 `Bash` calls to reverse-engineer instead |
| `/season-drafting <msg>` prefix | **Loads deterministically** — zero tool calls, exact schema recall |
| `--resume` carrying the skill | **Yes** — resumed turn recalled SKILL.md's atomic-write rule verbatim with read tools disabled |
| Production shape (prefix + multi-line bundle as argument) | **Works** — braided both ledger threads, used verbatim slugs, explicitly refused to fabricate the absent character bible |

The last probe is the important one: it exercised the exact string the server will
build, and the model's refusal to invent the missing character bible is AC-HAPPY-1's
no-fabrication guarantee behaving correctly end-to-end.

**Design consequence**: `buildArgs()` needs no change. No new flag,
no `--append-system-prompt`, no inlined SKILL.md. The skill prefix has the *same
lifetime as the context bundle* — first turn only, off the same
`FileSessionStore.load() === null` signal — so both orphaned wires collapse into one
edit in `buildTurnPrompt()`.

## Approaches Considered

### Where turn composition lives

- **A. A new `SeasonTurnRunner` module both routes compose (chosen).** One door for every
  turn. Owns first-turn detection, bundle assembly, skill prefix, the user echo, and the
  queue. `SeasonSessionManager` stays untouched.
- B. Add the wiring inline in the `/message` route handler. Fewest files — but leaves
  `/reject` on its own path, so the cold-start hole stays open and the queue would have
  to be duplicated or skipped for rejections. Rejected.
- C. Push queueing and bundle assembly down into `SeasonSessionManager`. Puts everything
  behind one existing class — but that class is a clean spawn/resume/persist abstraction
  with 14 tests, and mixing SSE publishing and canon reads into it muddies a boundary
  that is currently correct. Rejected.

### Making the user's message visible

- **A. Server publishes a synthetic `{type:"user"}` event after `startTurn()` (chosen).**
  Renders through the existing `TranscriptTurn` with zero new UI code, appears in every
  connected tab, replays to a tab reconnecting mid-turn.
- B. Client-side optimistic echo. Simpler server, instant render — but invisible to other
  tabs and lost on reload, unlike the reply sitting next to it. Rejected.
- C. No echo. Smallest change, but the transcript reads as a monologue. Rejected.

### Concurrency policy

- A. Single-flight with `409` on a second concurrent POST — least machinery.
- **B. Per-season FIFO queue (chosen by the user).** Nicer when a thought arrives
  mid-turn; costs a queue, a drain loop, a crash policy, and a split HTTP contract.
- C. Allow concurrent turns. Rejected outright — two processes would race on the session
  pointer and both write `season.draft.json`, violating SKILL.md's single-writer rule.

## Decisions

1. **One turn path for every message.** `POST /message` and `POST /reject` both compose
   `SeasonTurnRunner.submit()`. This is what makes creative-doc decision #3 ("first turn
   must be context-seeded, never a cold-start") true at runtime instead of true only on
   the happy path — today a first-ever `/reject` would cold-start a bundle-less,
   skill-less session.

2. **Skill invocation and context bundle share one lifetime.** Both are emitted on the
   first turn only, from `buildTurnPrompt()`, keyed off the absence of a session pointer.
   Empirically justified: `--resume` carries both forward, so re-sending them every turn
   would waste context and change nothing.

   ```ts
   export const SEASON_DRAFTING_SKILL_COMMAND = "/season-drafting";

   if (options.hasExistingSession) return options.userMessage;
   return options.contextBundleText.trim().length === 0
     ? `${SEASON_DRAFTING_SKILL_COMMAND} ${options.userMessage}`
     : `${SEASON_DRAFTING_SKILL_COMMAND} ${options.contextBundleText}\n\n---\n\n${options.userMessage}`;
   ```

   The empty-bundle branch is not decoration: production `./Canon` may not exist yet, and
   without it the prompt degrades to `/season-drafting \n\n---\n\nmsg`.

3. **The user's message is server-published, not client-echoed** — synthetic
   `{type:"user", message:{role:"user", content}}` published immediately after
   `startTurn()`, landing at seq 0. `groupIntoTurns()` already renders it; no new UI code.

4. **Queue on busy, discard on crash.** Per-season FIFO. Nothing in flight → run
   synchronously. Something in flight → enqueue. On crash, drop the pending messages,
   publish the failure, and hand the discarded text back to the composer.

5. **The HTTP contract splits, deliberately.** A queued message's turn has not run when
   its response is sent, so AC-ERROR-1 cannot ride the status code for that path:

   | Situation | Response |
   |---|---|
   | Nothing in flight, turn OK | `200 {crashed:false, exitCode, sessionId}` |
   | Nothing in flight, turn crashes | `502 {error, crashed:true, exitCode}` |
   | Turn in flight | `202 {queued:true, position}` |
   | Queued turn later crashes | SSE `yts_error` event |

   This keeps `/reject`'s existing synchronous contract byte-for-byte intact — verified
   safe, because all three current `/reject` tests pre-seed a session pointer and so
   exercise only the resumed path.

6. **Crashes surface as a dedicated event type, never a fabricated turn.** A
   `{type:"yts_error", …}` event is filtered out client-side before `groupIntoTurns()` and
   rendered as a `role="alert"` banner. Manufacturing an assistant turn to carry an error
   message would put words in the model's mouth — the opposite of the
   graceful-degradation-over-fabrication pattern this codebase already follows in
   `draft-watcher.ts` and `statusline-probe.ts`.

7. **Queued messages are shown, not hidden.** Because `startTurn()` clears the replay
   buffer, a queued message cannot live in the transcript until its own turn begins, so
   pending messages render beneath the composer instead.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Rewiring `/reject` breaks its 3 existing tests | Checked before design lock: all three pre-seed `.yts-session.json`, so they take the resumed branch where prompt and status are unchanged |
| Double session-pointer read (runner for first-turn detection, `sendMessage` for `--resume`) | Accepted. Two cheap reads of the same small file; preferable to altering a `sendMessage()` that is correct and covered by 14 tests |
| Queue adds async branches that outrun their ACs | Crash policy, ordering, and the `202` contract are pinned as AC-ASYNC-1/2 and AC-ERROR-2 before build, not discovered during it |
| Spawned process inherits the operator's global hooks | Observed during probing (a `SessionStart` hook fires inside every spawned turn). Noise only — no behavioral impact seen across five runs. Noted, not addressed here |

## Deferred (explicitly out of scope)

Season Desk audit; DeadLight canon migration; `react-router` 7.x; `vitest` 4.x;
`useSeasonDraft(seasonId)` extraction (this task touches neither polling component, so it
does not fall out for free); cross-turn transcript persistence;
`YTS_STATUSLINE_SNAPSHOT_PATH` wiring.
