---
slug: headless-draft-writes
legacy_id:
feature: headless-draft-writes
status: PLANNED
---

# headless-draft-writes: Headless Draft Writes

**Complexity**: Level 2
**Status**: PLANNED
**Roadmap**: headless-draft-writes
**Branch**: feature/headless-draft-writes
**Worktree**: N/A (in-repo checkout)

## Task Description

Make the spawned headless `claude -p` turn actually able to write
`<canonRoot>/seasons/<seasonId>/season.draft.json`, so Draft Preview renders and Approve
enables. This closes AC-HAPPY-4 of `season-chat-conversation-loop`, which was recorded as
**UNVERIFIED** at archive and then proven **failing** by a live browser walk on 2026-08-19.

Three defects compound; fixing any one alone changes nothing observable.

### Defect 1 — the process has no write permission

`buildArgs()` (`console/server/season-session.ts:53`) emits:

```
["-p", "--output-format", "stream-json", "--verbose", prompt]
```

No `--allowedTools`, no `--permission-mode`. Every `Write` the skill attempts is blocked.
So is `echo $YTS_CANON_ROOT`, meaning the process cannot even discover its own config.

### Defect 2 — the canon root is never communicated

`defaultSpawn()` (`console/server/season-session.ts:32`) is:

```js
nodeSpawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] })
```

No `cwd`. And `buildTurnPrompt()` composes canon *content* into the bundle but never
canon's *path*. The model must guess where to write. In the live walk it fell back to the
path `SKILL.md` names for local dev (`console/fixtures/canon/`) rather than the configured
`YTS_CANON_ROOT` — writing outside the intended root entirely.

### Defect 3 — `seasonId` means two different things

| Consumer | Meaning | Value in the live walk |
|---|---|---|
| Route / `DraftPreview` poll / draft endpoint | directory key from the URL | `season-1` |
| `SKILL.md` "`<seasonId>` is the season this conversation is drafting" | the season being written | `season-2` |

The server polls `<canonRoot>/seasons/season-1/season.draft.json`; the model targeted
`seasons/season-2/`. Even with defects 1 and 2 fixed, the panel would stay empty forever.

This also settles a question left open at archive: the AC-HAPPY-4 runbook's
`/seasons/2/chat` was **not** a stale typo — it was pointing at this real ambiguity.

### Evidence

Live walk, both servers up, two real turns driven through the browser. The model reported:

> "The draft file isn't written. Both write attempts were blocked pending permission, so
> `console/fixtures/canon/seasons/season-2/season.draft.json` does not exist yet and the
> preview panel will still be empty. (I fell back to the fixture canon root because
> reading `YTS_CANON_ROOT` was also blocked — if the real root is elsewhere, say so.)"

Headless session transcript — the only paths attempted:

```
console/fixtures/canon/seasons/season-2/.season.draft.json.tmp
console/fixtures/canon/seasons/season-2/season.draft.json.tmp-drafting-20260819105604
```

**What already works and must not be rebuilt**: context bundle assembly and delivery,
skill loading via the `/season-drafting` prefix, SSE streaming, turn grouping, the
synthetic user echo, the per-season queue, session resume, `canon-commit.ts`, and
Diagnostics token accounting. All were verified live. This task changes *how the process
is spawned* and *what the first-turn prompt states* — nothing else.

**Credit where due**: the model did not report false success. It named the blocker
explicitly. AC-ERROR-1's "never a false success" contract held.

## Approved Design Decisions

Settled with the user before planning:

1. **The route `seasonId` is authoritative.** The server owns the key; the model never
   chooses the draft location. The first-turn prompt states the resolved absolute path.
2. **Canon is show-scoped; seasons are a subdivision within it.** The prompt conveys the
   *show* canon root (holding `series-overview.md`, `characters/`, `continuity-ledger.md`)
   **and** the resolved season draft path. It must not present a season-siloed path that
   hides show-level canon from the model.
3. **Tight `--allowedTools` allowlist by default** — the narrowest grant that permits
   draft maintenance, on a process writing to real canon.
4. **An opt-in escape hatch to `--dangerously-skip-permissions`**, via a `YTS_*` env var
   following the project's existing 12-factor convention, for when the tight allowlist
   proves annoyingly cautious in practice.

## Specification

**Feature Type**: Bug fix / enablement (End-User Feature — it is what makes Draft Preview
and Approve functional for the first time)
**Creative Phase Required**: No — the design decisions above are settled; Level 2

### Invocation Method

- **Location**: Season Chat, route `/seasons/:seasonId/chat`
- **Element**: the composer — same entry point as `season-chat-conversation-loop`
- **Navigation**: seed a scratch canon, then run both dev servers per
  `memory-bank/uat-config.md` § Fixtures & Data

### Success Criteria

- **User sees**: after a turn in which concrete episode concepts are agreed, the Draft
  Preview panel populates with those episodes and the Approve button becomes enabled
- **User can verify at**: `<canonRoot>/seasons/<seasonId>/season.draft.json` on disk, and
  the Draft Preview panel
- **Data persisted**: `season.draft.json` under the **route's** `seasonId`, inside the
  configured `YTS_CANON_ROOT` — never the fixtures fallback, never a different season dir
- **Observable within**: one Draft Preview poll interval (~1s) of the skill's write

### Acceptance Criteria

#### AC-PERM-1: The spawned process can write the draft
**Priority**: MUST
**Given** a season turn is spawned in the default configuration
**When** `buildArgs()` composes the argument vector
**Then** it includes an explicit `--allowedTools` allowlist sufficient for the skill to
read canon and atomically write `season.draft.json` (temp file + rename), and does **not**
include `--dangerously-skip-permissions`.

#### AC-PERM-2: The allowlist is a tight grant, not a blanket one
**Priority**: MUST
**Given** the default configuration
**When** the allowlist is inspected
**Then** it grants only the tools draft maintenance requires — a test asserts the vector
does **not** contain a wildcard/blanket grant, so a future edit widening it fails loudly
rather than silently.

#### AC-PERM-3: The escape hatch is opt-in and off by default
**Priority**: MUST
**Given** the `YTS_*` permission env var is unset, empty, or any value other than the
documented opt-in token
**When** a turn is spawned
**Then** the tight allowlist is used. **And** when it *is* set to the opt-in token, the
vector uses `--dangerously-skip-permissions` instead, and the server logs a clearly-worded
one-line warning at startup naming the reduced safety posture.

#### AC-PATH-1: The first-turn prompt states the show canon root and the resolved draft path
**Priority**: MUST
**Given** a first turn for season `<seasonId>` with canon root `<canonRoot>`
**When** `buildTurnPrompt()` composes the prompt
**Then** it states the **absolute** show canon root and the **absolute** resolved draft
path `<canonRoot>/seasons/<seasonId>/season.draft.json`, so the model never infers,
guesses, or falls back to the `SKILL.md` fixture default — and the path uses the route's
`seasonId` verbatim.

#### AC-PATH-2: Canon is presented as show-scoped
**Priority**: MUST
**Given** a canon root containing show-level artifacts (`series-overview.md`,
`characters/`, `continuity-ledger.md`) alongside `seasons/`
**When** the first-turn prompt is composed
**Then** it identifies the canon root as the **show** root — the model is told it may read
show-level canon there — while the draft write target is the season path from AC-PATH-1.
The two are stated as distinct facts, not conflated into one season-scoped path.

#### AC-PATH-3: Resumed turns do not restate the paths
**Priority**: MUST
**Given** a season with a recorded session pointer
**When** a later turn is composed
**Then** the prompt is the user's message alone — no canon root, no draft path, no skill
prefix — because the resumed session already carries them. Mirrors AC-HAPPY-2 of
`season-chat-conversation-loop`.

#### AC-SEASON-1: The route seasonId is the sole authority for the draft location
**Priority**: MUST
**Given** a conversation at `/seasons/<routeId>/chat` in which the model reasons about a
differently-numbered season (e.g. drafting "season 2" from `season-1`'s chat)
**When** the draft path is composed
**Then** it is always `<canonRoot>/seasons/<routeId>/season.draft.json` — the value the
draft endpoint and `DraftPreview` poll — regardless of which season number the
conversation is about. The prompt states this unambiguously so the model does not
substitute its own.

**And** `SKILL.md`'s "Maintaining the draft file" section MUST be updated so its
`<seasonId>` definition ("the season this conversation is drafting") no longer contradicts
the route-authoritative rule, and so its `<CANON_ROOT>` guidance no longer directs a
fallback to `console/fixtures/canon/`. Leaving SKILL.md unchanged would keep a documented
instruction that actively contradicts the prompt.

#### AC-VERIFY-1: The draft round-trips end to end
**Priority**: MUST
**Given** the fixes above, a seeded scratch canon, and both dev servers running
**When** a conversation produces at least one concrete episode concept
**Then** `season.draft.json` appears under the route's `seasonId` inside the configured
canon root, Draft Preview renders it within one poll interval, and Approve becomes enabled.

**Manual verification, by design — MUST NOT be claimed from a green suite.** Every
automated test injects `spawnFn`, which is exactly why the 89-test suite missed all three
defects. This AC's automated half is AC-PERM-1/2/3 and AC-PATH-1/2/3 (the argument vector
and composed prompt are provably correct); the end-to-end behavior gets the runbook below,
**run once and recorded in Execution State with the observed output**.

```
rm -rf console/.uat-canon
cp -R console/fixtures/canon console/.uat-canon
YTS_CANON_ROOT=<abs>/console/.uat-canon npm run dev:server --prefix console
npm run dev:client --prefix console
# open the client's reported port at /seasons/season-1/chat
# turn 1: "Let's start planning the next season. What threads should we open on?"
# turn 2: "Lock episodes 1-3 as concrete loglines and write the draft file."
# expect: console/.uat-canon/seasons/season-1/season.draft.json exists;
#         Draft Preview renders those episodes; Approve becomes enabled
```

Record the observed output. **This is the AC the predecessor task claimed without
evidence — do not repeat that.**

#### AC-REGRESSION-1: No regression in the existing suite
**Priority**: MUST
**Given** the 89 tests across 14 files passing on `main`
**When** the full suite plus this task's new tests are run
**Then** all 89 pre-existing tests pass unmodified, and `npm run typecheck` and
`npm run build:client` remain clean.

### Scope Boundaries

**In scope**: `buildArgs()` permission flags + env-var escape hatch; conveying the show
canon root and resolved draft path in `buildTurnPrompt()`; making the route `seasonId`
authoritative; the corresponding `SKILL.md` corrections; docs for the new env var.

**Explicitly out of scope** (do not implement, do not "improve while nearby"):
- Season management — list, picker, creation UI. Related and needed, but its own feature.
  Reaching a new season still means typing `/seasons/<id>/chat`.
- Auto-creating `<canonRoot>/seasons/<id>/` — the user chose the non-auto-create option.
  If the `Write` tool does not create missing parent directories, record that as a finding
  for the season-management feature rather than fixing it here.
- The Season Desk audit feature
- Direct draft editing / writable draft routes
- The immediate-crash-loses-just-submitted-message gap (separate follow-up)
- `react-router` 7.x and `vitest` 4.x bumps
- Wiring `YTS_STATUSLINE_SNAPSHOT_PATH`
- Persisting transcript history across turn boundaries

## Test Strategy

### Approach
- **Emphasis**: unit-weighted on the two pure seams this task changes — the composed
  argument vector and the composed prompt. These are the halves the suite genuinely can
  prove. The end-to-end guarantee is the runbook, deliberately not faked in a test.
- **Target test count**: ~12 new tests (≈101 total).

### File Organization
- **Extend existing**:
  - `console/server/season-session.test.ts` — `buildArgs()` allowlist present; no blanket
    grant; escape hatch off by default; escape hatch on when the env var is set; resumed
    turns still carry `--resume`
  - `console/server/context-bundle.test.ts` — first-turn prompt states the absolute canon
    root and the absolute resolved draft path; path uses the route `seasonId` even when the
    message discusses a different season number; canon presented as show-scoped; resumed
    turns state neither

### What NOT to Test
- Real `claude` CLI invocation or actual permission enforcement — every test injects
  `spawnFn`. **This is the exact blind spot that produced this task**; the runbook exists
  because a test here would prove nothing.
- Skill loading via the `/season-drafting` prefix — verified live 2026-08-19
- SSE, turn grouping, queue behavior, `canon-commit.ts`, Diagnostics — untouched, all
  verified live

## Implementation Roadmap

### Extended Source Files
- [x] `console/server/season-session.ts` — `buildArgs()` gains the `--allowedTools`
      allowlist and the env-var-gated `--dangerously-skip-permissions` branch; startup
      warning when the hatch is active
- [x] `console/server/season-session.test.ts` — tests for the above
- [ ] `console/server/context-bundle.ts` — extend `BuildTurnPromptOptions` (line ~154)
      with `canonRoot` + `seasonId`; `buildTurnPrompt()` (line ~172) states the show canon
      root and the resolved absolute draft path on the first-turn branch only
- [ ] `console/server/context-bundle.test.ts` — tests for the above
- [ ] `console/server/turn-runner.ts` — pass `canonRoot` + `seasonId` into
      `buildTurnPrompt()` at line ~191. **Verified: no new plumbing needed** —
      `SeasonTurnRunner` already holds `this.canonRoot` (lines 92, 99) and already passes
      `seasonId` to `assembleContextBundle()` at line 189. This is a two-argument change,
      not a threading exercise.
- [ ] `.claude/skills/season-drafting/SKILL.md` — correct the `<seasonId>` definition and
      remove the fixture-canon fallback guidance (AC-SEASON-1)
- [x] `memory-bank/techContext.md` — document the new env var in § Environment Variables

### Phases
- [x] Phase 1: Spawn permissions + escape hatch (`season-session.ts`)
- [ ] Phase 2: Path communication + route-authoritative seasonId (`context-bundle.ts`,
      SKILL.md) — ends with the AC-VERIFY-1 runbook, output recorded

## Creative Phases

- [x] None required — design decisions settled with the user before planning (Level 2)

---

## Execution State

**Build Status**: RUNNING
**Current Phase**: BUILD
**Current Step**: Step 11 - Git Completion (Phase 1)
**Phase Being Built**: Phase 1: Spawn permissions + escape hatch
**Phase Number**: 1 of 2
**Is Multi-Phase**: YES
**Last Completed**: Phase 1 (season-session.ts permission flags)
**Can Resume**: YES
**Resume From**: `/bmb:build headless-draft-writes` → Phase 2

### Active Sub-Agents
(none)

### Completed Steps
- Live browser walk 2026-08-19 against a seeded scratch canon — three defects confirmed
  empirically, with the headless session transcript as evidence
- Root causes located: `season-session.ts:32` (no cwd/config), `season-session.ts:53`
  (no permission flags), `SKILL.md` § Maintaining the draft file (seasonId + fallback)
- Design decisions approved by user: route-authoritative seasonId; canon is show-scoped;
  tight `--allowedTools` by default; opt-in `--dangerously-skip-permissions` escape hatch
- Roadmap feature + task file authored
- Phase 1 TDD (RED→GREEN): `buildArgs()` in `console/server/season-session.ts` gained
  `PermissionMode` ("tight" default / "dangerously-skip-permissions" opt-in via
  `YTS_PERMISSION_MODE`), `ALLOWED_TOOLS = ["Read", "Write", "Bash(mv *)"]`,
  `resolvePermissionMode()`, `warnIfPermissionsDisabled()`. 10 new tests in
  `season-session.test.ts` (AC-PERM-1/2/3 + AC-REGRESSION-1 slice)
- Phase 1 Integration Verification: tests 99/99 PASS, typecheck PASS, build PASS
  (one round-trip: a `warnSpy.mock.calls[0][0]` strict-null typecheck FAIL was fixed
  with optional chaining, then re-verified PASS)
- Phase 1 Code Review: iteration 1 found a BLOCKING issue (`Bash(mv:*)` colon-separated
  Bash pattern doesn't match this repo's actual permission-grant syntax — real CLI/repo
  precedent is space-separated `Bash(mv *)`); fixed directly (code + tightened AC-PERM-2
  test assertion + doc comment), re-verified PASS, re-reviewed APPROVED (iteration 2)
- Phase 1 Documentation: `memory-bank/techContext.md` updated with `YTS_PERMISSION_MODE`
  env var row + a task-scoped Phase 1 note under § Component Structure (committed
  separately as `a47c525` by the documentation sub-agent, ahead of the phase commit —
  docs-only, no production/test code in that commit)

### Guard & Recovery Log
- Phase 1: code-review FAIL (blocking, `Bash(mv:*)` vs `Bash(mv *)` syntax) → fixed
  inline by orchestrator (not full TDD re-dispatch — single-line code fix + matching
  test tightening) → re-verify PASS → re-review APPROVED. No commit-guard (C1/C2/C3)
  failures this phase.

### Resumption Notes
**Can Resume**: YES
**Notes**: Phase 1 complete and committed to `feature/headless-draft-writes` (pushed).
Phase 2 is prompt composition (`context-bundle.ts`) plus the SKILL.md correction and
must end with the AC-VERIFY-1 runbook run and its observed output recorded here. Do not
mark AC-VERIFY-1 satisfied from a green suite alone — that is precisely the failure this
task exists to correct. Next command: `/bmb:build headless-draft-writes`.
