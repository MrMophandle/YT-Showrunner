---
slug: headless-draft-writes
legacy_id:
feature: headless-draft-writes
status: COMPLETE
---

# headless-draft-writes: Headless Draft Writes

**Complexity**: Level 2
**Status**: COMPLETE (Phase 3 landed 2026-08-22 — **AC-VERIFY-1 VERIFIED PASS**, see
§ AC-VERIFY-1 Runbook — PASS)
**Roadmap**: headless-draft-writes
**Branch**: feature/headless-draft-writes
**Worktree**: N/A (in-repo checkout)
**Reflection**: memory-bank/reflection/headless-draft-writes-reflection.md
**Archived**: memory-bank/archive/headless-draft-writes-archive.md
**Completed**: 2026-08-22

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

## Phase 3 Defects (added 2026-08-22 from a human live walk)

A human ran the AC-VERIFY-1 runbook from an unsandboxed terminal. The turn failed with
`Error: Input must be provided either through stdin or as a prompt argument when using
--print`. **AC-VERIFY-1 therefore FAILS for a real product reason.**

This also **retracts** the Phase 2 build-run conclusion (and the reflection's, which
inherited it) that the error was an artifact of nesting `claude -p` inside a sandbox. That
conclusion rested on a "control" invocation that itself included
`--allowedTools "Read,Write,Bash(mv *)"` — it reproduced the bug, not the sandbox. A true
control (`claude -p --output-format stream-json --verbose "say hi"`, no allowlist flag)
succeeds nested inside an agent's Bash sandbox. Verified against `claude` 2.1.238.

### Defect 4 — the variadic `--allowedTools` swallows the positional prompt

`claude --help` documents `--allowedTools, --allowed-tools <tools...>` — **variadic**, so
it consumes every following non-flag token. `buildArgs()` pushes the prompt last, directly
after the allowlist value:

```
-p --output-format stream-json --verbose --allowedTools "Read,Write,Bash(mv *)" "<prompt>"
                                                        └── both consumed as tool names ──┘
```

No positional prompt survives. Empirically confirmed (`claude` 2.1.238):

| Vector | Result |
|---|---|
| `-p --output-format stream-json --verbose "say hi"` | works |
| `-p … --allowedTools "Read,Write" "say hi"` | `Error: Input must be provided…` |
| `-p … --allowedTools=Read,Write "say hi"` | works |
| `-p … --allowedTools "Read,Write,Bash(mv *)" -- "say hi"` | works |

A **Phase 1 regression** (commit `3c6364c`): before it there was no variadic flag, which is
why the original 2026-08-19 walk got real model output about blocked writes. `--` is the
chosen fix — it preserves the exact space-separated `Bash(mv *)` string that Phase 1's
code review established as correct.

### Defect 5 — a crashed turn persists a session pointer, poisoning every retry

`SeasonSessionManager.sendMessage()` (`season-session.ts:301`) saves on
`if (result.sessionId)` with no `crashed` check. A turn that dies in CLI argument parsing
still emits `SessionStart` hook lines carrying a `session_id`, and `parseStreamJson` reads
`session_id` off **any** event (`stream-parser.ts:258`). So the pointer is written even
though the turn produced nothing.

Consequence: the next turn sees `hasExistingSession` → `buildTurnPrompt()` returns the bare
user message (no path facts, no skill prefix, per AC-PATH-3) and `buildArgs()` adds
`--resume` against a session with no real history. **This is why the scratch canon's
`.yts-session.json` kept reappearing after deletion, and it would silently invalidate the
first retry even once Defect 4 is fixed.** The existing crash test
(`season-session.test.ts:110`) passes only because its fake emits no `session_id` at all.

### Why 103 green tests missed both

`buildArgs()` returns an array whose *contents* are exactly what AC-PERM-1/2 assert; the
defect is in how the real CLI *parses* that argv. Every test injects `spawnFn`, so no test
ever hands the vector to a real parser. AC-PERM-1 passes in letter while the feature cannot
function — a confirmed instance of this task's own reflection learning #1, not a
hypothetical.

#### AC-SPAWN-1: The prompt survives option parsing
**Priority**: MUST
**Given** any permission mode and any resume state
**When** `buildArgs()` composes the vector
**Then** the positional prompt is the last element and is immediately preceded by `--`, so
no variadic option can consume it. A test asserts this across the tight, resumed, and
escape-hatch shapes, so a future flag addition cannot silently re-break it.

#### AC-SPAWN-2: A crashed turn persists no session pointer
**Priority**: MUST
**Given** a turn that crashes after emitting events carrying a `session_id` (the real
shape of a CLI arg-parse failure, which emits `SessionStart` hook lines first)
**When** `sendMessage()` completes
**Then** no session pointer is written, so the next turn is a genuine first turn — full
bundle, skill prefix, path facts — rather than a resume against a session with no history.

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
- [x] `console/server/context-bundle.ts` — extend `BuildTurnPromptOptions` (line ~154)
      with `canonRoot` + `seasonId`; `buildTurnPrompt()` (line ~172) states the show canon
      root and the resolved absolute draft path on the first-turn branch only
- [x] `console/server/context-bundle.test.ts` — tests for the above
- [x] `console/server/turn-runner.ts` — pass `canonRoot` + `seasonId` into
      `buildTurnPrompt()` at line ~191. **Verified: no new plumbing needed** —
      `SeasonTurnRunner` already holds `this.canonRoot` (lines 92, 99) and already passes
      `seasonId` to `assembleContextBundle()` at line 189. This is a two-argument change,
      not a threading exercise.
- [x] `.claude/skills/season-drafting/SKILL.md` — correct the `<seasonId>` definition and
      remove the fixture-canon fallback guidance (AC-SEASON-1)
- [x] `memory-bank/techContext.md` — document the new env var in § Environment Variables

### Phases
- [x] Phase 1: Spawn permissions + escape hatch (`season-session.ts`)
- [x] Phase 2: Path communication + route-authoritative seasonId (`context-bundle.ts`,
      SKILL.md) — ends with the AC-VERIFY-1 runbook, output recorded
- [x] Phase 3: Fix the two spawn defects Phase 1 introduced/left (AC-SPAWN-1, AC-SPAWN-2),
      then re-run the AC-VERIFY-1 runbook for real — **AC-VERIFY-1 now PASSES**

## Creative Phases

- [x] None required — design decisions settled with the user before planning (Level 2)

---

## Execution State

**Build Status**: IDLE
**Current Phase**: COMPLETE
**Current Step**: Archived 2026-08-22 — `memory-bank/archive/headless-draft-writes-archive.md`
**Phase Being Built**: N/A — all three build phases complete
**Phase Number**: 3 of 3 (complete)
**Is Multi-Phase**: YES
**Last Completed**: `/bmb:archive` — archive doc written, learning consolidation applied
(`testing-patterns` promoted low → medium at evidence_count 3; `empirical-verification`
extended with the control-invocation directive), task marked COMPLETE, PR opened
**Can Resume**: NO
**Resume From**: N/A

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

- Phase 2 TDD (RED→GREEN): `BuildTurnPromptOptions` in `console/server/context-bundle.ts`
  gained required `canonRoot` + `seasonId`; new `resolveDraftPath()` / `renderPathFacts()`
  helpers state the absolute show canon root and the absolute resolved draft path
  (`<canonRoot>/seasons/<seasonId>/season.draft.json`) on the first-turn branch only.
  `turn-runner.ts`'s two `buildTurnPrompt()` call sites now pass both fields through.
  `SKILL.md` corrected: `<seasonId>` is now documented as route-authoritative (never
  inferred from conversation content); the stale `console/fixtures/canon/` local-dev
  fallback framing was removed. 6 new/extended tests (5 in `context-bundle.test.ts`, 1 in
  `turn-runner.test.ts`; 3 pre-existing tests had assertions loosened from exact-equality
  to `toContain`/`startsWith` since the new unconditional path-facts requirement made
  literal equality with the old empty-bundle case structurally impossible — same test
  intent preserved). Suite: 99 → 103 passing.
- Phase 2 Integration Verification: tests 103/103 PASS, typecheck PASS, build PASS. No
  lint script configured in this project (N/A, not skipped-and-hidden).
- Phase 2 Code Review: APPROVED, 0 blocking issues. One non-blocking recommendation
  (add defense-in-depth `isValidSeasonId` re-validation inside `buildTurnPrompt`/
  `resolveDraftPath` directly, matching `assembleContextBundle`'s existing convention,
  since both are exported and a future caller could skip the upstream validation that
  today's only two call sites in `turn-runner.ts` always perform) — logged here as a
  follow-up, not fixed in this phase (non-blocking, no test asserted it).
- Phase 2 Documentation: `memory-bank/techContext.md` updated with a Phase 2 note
  (committed separately as `d401faa` by the documentation sub-agent, ahead of the phase
  commit — docs-only, no production/test code in that commit). `systemPatterns.md` left
  unchanged — no new architectural pattern, this phase refines the existing Context
  Bundle Assembly pattern rather than introducing a new one.

### AC-VERIFY-1 Runbook — PASS (2026-08-22, after Phase 3)

Re-run after the Phase 3 fixes, against `console/.uat-canon` with `YTS_CANON_ROOT` set,
both dev servers up (server 8787, Vite 5173), driven through the real UI at
`/seasons/season-1/chat` via Playwright MCP. Session pointer deleted first so the turn was
a genuine first turn.

**All three assertions met, on turn 1** (the runbook's turn 2 proved unnecessary — the
model wrote the draft during the opening exchange):

1. `console/.uat-canon/seasons/season-1/season.draft.json` **exists** — two episodes
   ("Carrier", "Manifest"), `"seasonNumber": 1`, canon-aware loglines referencing the
   fixture characters (Dez Okafor, Mara Voss) and the tunnel collapse from
   `continuity-ledger.md`, with `threads` arrays naming ledger threads.
2. Draft Preview **renders it** — heading "Draft Preview — Season 1", both episodes with
   loglines and thread lists.
3. Approve **is enabled** (it was `[disabled]` in the pre-turn baseline snapshot).

Transcript showed `Bash` reads of canon followed by a `Write` — the tight
`ALLOWED_TOOLS` allowlist was sufficient; the escape hatch was never needed. Diagnostics
reported 56,478 / 200,000 tokens (28%). Evidence screenshot:
`.claude-logs/ac-verify-1-pass-20260822.png` (not committed —
`artifact_git_policy: ignore`).

**AC-SEASON-1 confirmed live, and better than specified.** The model wrote to the route's
`season-1` while *explicitly surfacing* the ambiguity rather than silently substituting its
own choice: "the console has **season-1** selected, so I'm filing the draft there — but the
bundle hands me a Season 1 summary as already-aired, and we're talking about what comes
after it. Tell me if that's just a fixture quirk or if you meant to be drafting season 2."
That is the route-authoritative rule holding *and* the honesty contract holding.

**AC-SPAWN-2 confirmed live in both directions**: no pointer written by the crashed
pre-fix turn; pointer written after this successful turn.

**Observation, out of scope**: the client renders entirely unstyled (no CSS applied) and
the page logs 1 console error. No AC covers styling and this task changed no client code,
so it is recorded here as a finding for a future task rather than chased.

### AC-VERIFY-1 Runbook Attempt (2026-08-19, Phase 2 build) — SUPERSEDED, CONCLUSION RETRACTED

> **This section's conclusion was wrong.** It attributed the
> `Error: Input must be provided…` failure to an artifact of nesting `claude -p` inside a
> sandbox. The real cause was Defect 4 (variadic `--allowedTools` swallowing the positional
> prompt) — see § Phase 3 Defects. The "control" invocation cited below carried the same
> `--allowedTools` flag, so it reproduced the bug rather than isolating the environment. A
> true control with no allowlist flag succeeds fine nested in a sandbox. Retained verbatim
> below as the record of how the misdiagnosis happened.

Ran the exact runbook from the task's Acceptance Criteria: removed the stale session
pointer at `console/.uat-canon/seasons/season-1/.yts-session.json` (a prior scratch canon
from an earlier local session was already present; `rm -rf` to recreate it fresh was
denied by this environment's permission system, so the stale session pointer — the one
piece of state that would have made the turn a resumed turn instead of a first turn —
was removed individually instead), started `dev:server` with
`YTS_CANON_ROOT=.../console/.uat-canon` and `dev:client` in the background, and drove one
turn through the UI at `/seasons/season-1/chat` via Playwright MCP (`claude-in-chrome` was
unavailable — "Browser extension is not connected" — in this sandboxed sub-agent
environment).

**Result: inconclusive, not a product failure.** The turn was submitted successfully
(synthetic user echo rendered in the transcript), but the spawned headless `claude -p`
process itself failed before producing any assistant output:
`Error: Input must be provided either through stdin or as a prompt argument when using
--print`. This reproduces identically for a direct manual invocation
(`claude -p --output-format stream-json --verbose --allowedTools "Read,Write,Bash(mv *)"
"hello there"`) run from this same sandboxed orchestrator's Bash tool — i.e. it is an
artifact of invoking the `claude` CLI *nested inside another Claude Code session's Bash
sandbox* (this orchestrator run), not something introduced by this phase's code. The
prior live walk that produced this task's original evidence (2026-08-19, cited in Task
Description) ran `claude -p` successfully from an unsandboxed shell — the spawn mechanism
and argument vector (`buildArgs()`) are unchanged in shape by this phase, only the prompt
*content* changed (added path facts), and the failure occurs even for a trivial
"hello there" prompt with no relation to this phase's content changes.

**What this attempt DID confirm** (matching AC-PATH-1/2/3, AC-SEASON-1's automated
coverage, now also visually spot-checked pre-crash): the composer accepted the message,
the synthetic echo rendered immediately (`SeasonTurnRunner`'s existing behavior,
untouched by this phase), Draft Preview correctly showed "No draft yet." and Approve
stayed disabled prior to the crash (no false-positive UI state).

**What remains genuinely unverified**: the actual file write round-trip
(`season.draft.json` appearing on disk, Draft Preview rendering it, Approve enabling) —
because the headless process never got far enough to attempt a write in this sandboxed
environment. Per this task's own AC-ERROR-1 standard ("never a false success"), this is
recorded as **NOT verified**, not claimed as passing. **Recommended next step for a
human**: re-run the exact runbook in
`### Acceptance Criteria § AC-VERIFY-1` from an unsandboxed terminal (not nested inside
another Claude Code session), which is how the task's own original defect-discovery walk
was run. Dev servers used for this attempt have been stopped; the scratch canon at
`console/.uat-canon` was left in place (untracked, gitignored-equivalent — not committed)
for reuse.

### Guard & Recovery Log
- Phase 1: code-review FAIL (blocking, `Bash(mv:*)` vs `Bash(mv *)` syntax) → fixed
  inline by orchestrator (not full TDD re-dispatch — single-line code fix + matching
  test tightening) → re-verify PASS → re-review APPROVED. No commit-guard (C1/C2/C3)
  failures this phase.
- Phase 2: no code-review or commit-guard failures. AC-VERIFY-1's manual runbook could
  not be completed in this sandboxed sub-agent environment (nested `claude -p` spawn
  failure, see AC-VERIFY-1 Runbook Attempt above) — this is an environment limitation of
  the build run, not a phase failure, and is surfaced to the human via this build's
  returned summary rather than silently marked done.

### Reflection (2026-08-19)
- Reflection Agent: COMPLETE — Output:
  `memory-bank/reflection/headless-draft-writes-reflection.md`
- **Task quality**: ⚠️ Partial Success *as assessed on 2026-08-19* — later superseded.
  The reflection's AC-VERIFY-1 verdict ("unverified, environmental") was **wrong**: a human
  live walk on 2026-08-22 proved it FAILING for a real product reason (Defect 4), which
  Phase 3 then fixed and verified PASS. The reflection doc has been amended with the
  corrected root cause; its learning #1 (mock-boundary blindness) was *validated* by this,
  not invalidated.
- **Ecosystem effectiveness**: ✅ Highly Effective for the code-level work; offset by the
  by-task session-log gap (third consecutive task) and no first-class way to represent
  "MUST-priority AC pending human verification" distinct from `BUILD_COMPLETE`.
- Extractable learnings captured in the reflection (2, per the Level 2 cap):
  mock-boundary blindness in the `spawnFn`-injecting suite, and isolating nested-CLI
  sandbox artifacts from real defects before attributing failure to code under test.
  Consolidation into `agent-rules/_learned/` happens at `/bmb:archive`, not here.
- Carried-forward follow-up: the deferred defense-in-depth `isValidSeasonId`
  re-validation inside `buildTurnPrompt()`/`resolveDraftPath()` (Phase 2 code review,
  non-blocking) — still not implemented.

### Phase 3 (2026-08-22)
- Root cause found by systematic debugging against the real CLI (`claude` 2.1.238), not by
  inspection: `claude --help` documents `--allowedTools <tools...>` as variadic, and a
  four-way empirical matrix isolated the swallow (see § Phase 3 Defects).
- TDD (RED→GREEN): 2 new tests in `season-session.test.ts` — AC-SPAWN-1 (`--` immediately
  precedes the prompt across the tight, resumed, and escape-hatch shapes) and AC-SPAWN-2
  (a crashed turn that *did* learn a session id persists no pointer). Both were watched
  failing first: AC-SPAWN-1 reported `expected 'Read,Write,Bash(mv *)' to be '--'`;
  AC-SPAWN-2 reported the pointer persisted as `sess-doomed`.
- Fixes: `args.push("--", prompt)` in `buildArgs()`; `if (result.sessionId &&
  !result.crashed)` in `SeasonSessionManager.sendMessage()`.
- Design note on AC-SPAWN-2: gating on `!crashed` means a turn that crashes *after* real
  work loses its session id and re-sends the bundle next turn. That is the cheap failure
  direction; keeping a dead id silently breaks every retry. Documented at the call site.
- Verification: 105/105 tests across 14 files, `typecheck` clean, `build:client` clean.
  Pre-existing `act(...)` warnings in `SeasonChat.test.tsx` are untouched by this phase.
- The existing crash test (`season-session.test.ts:110`) passed throughout only because its
  fake emits no `session_id`; AC-SPAWN-2 covers the reachable case it left open.

### Resumption Notes
**Can Resume**: NO — no work remains.
**Notes**: All three phases are complete, tested, and committed to
`feature/headless-draft-writes`. AC-VERIFY-1 is **verified PASS** with recorded evidence
(§ AC-VERIFY-1 Runbook — PASS). Every MUST-priority AC is met. Next command:
`/bmb:archive headless-draft-writes`.

Carried-forward follow-ups for future tasks (not blockers here):
- The deferred defense-in-depth `isValidSeasonId` re-validation inside
  `buildTurnPrompt()`/`resolveDraftPath()` (Phase 2 code review, non-blocking).
- The client renders unstyled with 1 console error (see the Phase 3 runbook observation).
- Consider a smoke test that hands `buildArgs()`'s vector to the real `claude` CLI (even
  just `--help`-level arg validation), since the whole Phase 3 defect class is invisible to
  any test that injects `spawnFn`.
