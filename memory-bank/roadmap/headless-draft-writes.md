---
version: next
status: completed
priority: critical
complexity: 2
linked_tasks: [headless-draft-writes]
created: 2026-08-19
completed: 2026-08-22
---

> **Status: completed** (2026-08-22) — the sole linked task `headless-draft-writes` is
> COMPLETE. All three original defects fixed, plus two more (a variadic-flag prompt swallow
> introduced by the Phase 1 fix, and a crashed turn persisting a session pointer) found by a
> human live walk and fixed in Phase 3. **AC-VERIFY-1 is verified PASS** through the real UI
> with recorded evidence — `season.draft.json` written under the route's `seasonId`, Draft
> Preview rendering it, Approve enabled. This also closes
> `season-chat-conversation-loop`'s AC-HAPPY-4, the last broken link in the drafting loop.

# Headless Draft Writes

Make the spawned headless turn actually able to write `season.draft.json`, closing the
last broken link in the Season Chat conversation loop.

`season-chat-conversation-loop` wired the loop end-to-end and shipped 89 passing tests,
but a live browser walk on 2026-08-19 proved the draft file **can never be written as
currently spawned**. Every automated test injects `spawnFn`, so all three defects below
live precisely in the gap the mocked boundary hides — which is why a green suite missed
them.

## Evidence (live walk, not inference)

Both servers were started against a scratch canon, and two real turns were driven through
the browser at `/seasons/season-1/chat`. The conversational half worked well: the reply
cited all three ledger threads, Mara's supply-run authorization, Dez's comms guilt, and
Ashworth's unrecovered body — verbatim canon, proving the context bundle is delivered and
the `season-drafting` skill loads. Streaming, turn grouping, the synthetic user echo,
session resume, and Diagnostics token accounting all behaved correctly.

Then the model reported, verbatim:

> "The draft file isn't written. Both write attempts were blocked pending permission, so
> `console/fixtures/canon/seasons/season-2/season.draft.json` does not exist yet and the
> preview panel will still be empty. (I fell back to the fixture canon root because
> reading `YTS_CANON_ROOT` was also blocked — if the real root is elsewhere, say so.)"

Confirmed from the headless session transcript — the only paths it attempted:

```
console/fixtures/canon/seasons/season-2/.season.draft.json.tmp
console/fixtures/canon/seasons/season-2/season.draft.json.tmp-drafting-20260819105604
```

## The three defects (they compound — fixing any one alone changes nothing)

1. **No write permission.** `buildArgs()` (`console/server/season-session.ts:53`) emits
   `["-p","--output-format","stream-json","--verbose", prompt]` — no `--allowedTools`, no
   `--permission-mode`. Every `Write` is blocked, and even `echo $YTS_CANON_ROOT` was
   blocked, so the process cannot discover its own configuration.
2. **Canon root is never communicated.** `defaultSpawn()`
   (`console/server/season-session.ts:32`) passes no `cwd`, and the first-turn prompt
   carries canon *content* but never canon's *path*. The model was left to guess and fell
   back to the fixture path SKILL.md names for local dev — not the configured
   `YTS_CANON_ROOT`.
3. **`seasonId` means two different things.** The route key is `season-1`; the skill's
   `<seasonId>` is documented as "the season this conversation is drafting", which the
   model reasonably read as season 2. The server polls
   `<canonRoot>/seasons/season-1/season.draft.json`; the model targeted `seasons/season-2/`.
   Even with 1 and 2 fixed, Draft Preview would stay empty forever.

Defect 3 also settles a question left open at archive: the AC-HAPPY-4 runbook's
`/seasons/2/chat` was **not** a stale typo — it was pointing at a real ambiguity in the
design.

## Approved design decisions

- **The route `seasonId` is authoritative.** The server owns the key; the model never
  chooses where the draft goes. The first-turn prompt states the resolved absolute path
  explicitly.
- **Canon is show-scoped, seasons are a subdivision within it.** The prompt must convey
  the *show* canon root (which holds `series-overview.md`, `characters/`,
  `continuity-ledger.md`) **and** the resolved season draft path — not a season-siloed
  path that hides show-level canon from the model.
- **Tight tool allowlist by default**, via `--allowedTools`, granting only what draft
  maintenance requires — narrowest grant that unblocks the loop, on a process writing to
  real canon.
- **An opt-in escape hatch** to `--dangerously-skip-permissions`, controlled by an env
  var following the project's existing `YTS_*` 12-factor convention, for when the tight
  allowlist proves annoyingly cautious in practice.

**Complexity rationale**: Level 2 — a contained enhancement to two well-documented server
modules (`season-session.ts` spawn construction, `context-bundle.ts` prompt composition)
with no new architecture and no new component. Elevated priority because the feature it
repairs is currently non-functional end-to-end despite reading as complete.
