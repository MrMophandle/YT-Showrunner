# Archive: Conversational Season Drafting

## Metadata
- Task: `conversational-season-drafting`
- Complexity: Level 4
- Started: 2026-08-12 (brainstorm — feature + task + creative approved in one dialogue)
- Completed: 2026-08-13
- Duration: 2 days (5 build phases)
- Roadmap Link: `memory-bank/roadmap/conversational-season-drafting.md` (version `next`)
- Feature branch: `feature/conversational-season-drafting`
- Reflection: `memory-bank/reflection/conversational-season-drafting-reflection.md`

## Executive Summary

This task stood up the first real application in the YT-Showrunner repository: `console/`,
a local Hono + React/Vite web app that lets a showrunner draft a television season through
a free-form, multi-turn conversation with a **headless Claude Code process**, streamed live
to the browser over SSE, with a live draft preview, an explicit approve/reject signoff gate
that commits to canon, and a diagnostics panel reporting real context usage.

The defining architectural choice is that the app spawns `claude -p --output-format
stream-json` (and `--resume <session-id>` for every subsequent turn) using the operator's
existing Claude Code login — **no Anthropic API billing, no container, no long-lived child
process**. Each turn is a fresh process that runs to completion and exits.

All 5 planned phases landed. Final state: **63 tests passing across 12 files**, typecheck
clean, client build clean, zero blocking findings outstanding, security review PASS. Two
blocking defects were found and fixed during the build (a path-traversal vulnerability in
Phase 1 and a false-success error response in Phase 4) — both caught by the code-review
gate rather than by the TDD pass, which is the single most actionable process finding of
this task.

## System Overview

### Purpose
Mirror how a season is actually drafted in practice — talking through unresolved threads,
weaving them into episode concepts, getting inline story-craft and canon-consistency
guidance — instead of a batch report/approval workflow. The prior art is DeadLight's
`Canon/season-1.md`, which was authored conversationally; this app automates that loop.

### Scope

**Included:**
- Headless Claude Code session orchestration (spawn + `--resume` per turn)
- `stream-json` → normalized turn-event parsing, streamed to the browser over SSE
- Canon context bundle seeded into the first turn (never a cold start)
- Live draft preview from a watched, atomically-written draft file
- Signoff gate: approve → commit to canon; reject-with-notes → back into the conversation
- Diagnostics: real context usage + best-effort plan usage

**Excluded (deliberate):**
- The structured "Season Desk" audit (3-lens panel: thread-auditor, arc-tracker,
  craft-critic → numbered proposals) — reuses this architecture, separate future feature
- DeadLight → YTS data migration (episodes, audio/images, scripts, outlines, Canon)
- Season *creation* (this app drafts into an existing season) and drafting a brand-new show
  with no prior canon
- Any UI beyond Season Chat / Draft Preview / Signoff / Diagnostics
- Composer → POST message-send wiring (AC-ERROR-1 / AC-ASYNC-4 general chat-send path)

### Key Capabilities
- Free-form, multi-turn conversational season drafting against real canon
- Live turn-by-turn streaming (text, tool calls, collapsible thinking blocks)
- Draft preview that survives torn/partial file reads by serving last-good state
- Explicit human signoff before anything is written to canon
- Honest diagnostics — never fabricates a usage figure it cannot read

## Architecture

### Overview
Three-tier local application, localhost-only, single user:

```
Browser (React/Vite SPA, port 5173 dev)
   │  GET /api/seasons/:seasonId/events   ── SSE ──▶  live turns
   │  GET /api/seasons/:seasonId/draft    ── poll ──▶  last-good draft
   │  GET /api/statusline                 ── poll ──▶  plan usage
   │  POST /api/seasons/:seasonId/approve │ /reject
   ▼
Hono server (Node, 127.0.0.1:8787)
   ├── season-session.ts   spawn `claude -p [--resume]`, persist session pointer
   ├── stream-parser.ts    stream-json → normalized turn events
   ├── sse.ts              in-memory pub/sub + replay buffer (late-subscriber safe)
   ├── context-bundle.ts   canon → first-turn prompt prefix
   ├── draft-watcher.ts    poll season.draft.json, discard torn reads
   ├── canon-commit.ts     atomic season file + continuity-ledger append
   └── statusline-probe.ts best-effort rate-limit snapshot reader
   ▼
Headless Claude Code process (per turn, runs to completion, exits)
   └── .claude/skills/season-drafting/SKILL.md drives the drafting logic
   ▼
Canon tree (<YTS_CANON_ROOT>, default ./Canon) — season files, continuity ledger,
   season.draft.json, .yts-session.json
```

### Component Diagram
See `memory-bank/techContext.md` § Component Structure for the full per-phase file map,
and `memory-bank/systemPatterns.md` for the seven codified patterns.

### Data Flow
1. User opens `/seasons/:seasonId/chat`; the client subscribes to the SSE events stream.
2. First turn: `context-bundle.ts` assembles series overview, character bibles, previous
   season summaries, and **verbatim** unresolved threads from `continuity-ledger.md`, and
   prefixes the user's message with it.
3. `season-session.ts` spawns `claude -p --output-format stream-json`; `stream-parser.ts`
   groups raw events into renderable turns; `sse.ts` broadcasts them with a replay buffer.
4. The session ID is **re-read from every turn's output and re-persisted** — the code never
   assumes `--resume` preserves the ID it was given.
5. The skill writes `season.draft.json` during the conversation; `draft-watcher.ts` serves
   the last successfully-parsed draft, discarding torn/malformed reads.
6. On approve, `canon-commit.ts` performs two atomic temp+rename writes: the rendered
   `season-<n>.md` and a dated append to `continuity-ledger.md`. On reject, the session is
   resumed server-side with the notes as the next message.

### Integration Points
- **Claude Code CLI** — spawned as a subprocess (`claude -p`, `--resume`); authenticates via
  the operator's existing login. Not a package dependency.
- **Canon filesystem tree** (`YTS_CANON_ROOT`, default `./Canon`) — the system of record for
  seasons, the continuity ledger, drafts, and session pointers.
- **statusLine snapshot file** (`<os.tmpdir()>/yts-statusline-snapshot.json`) — read-only,
  best-effort; written by some future interactive session, never by this server.
- **Prior art (internal)**: `.agent-logs/claude_transcript_to_md.py` `group_into_turns()` was
  the reference implementation for `stream-parser.ts`; `claude_telemetry.py` for usage-field
  parsing.

## Design Decisions

Full rationale: `memory-bank/creative/conversational-season-drafting-design.md`.

### 1. Headless `claude -p` + `--resume`, no API billing, no container
- **Decision**: Each user message spawns a fresh headless Claude Code process resuming the
  prior session; it runs to completion and exits.
- **Rationale**: Uses the existing Claude Code login (Max plan) — zero API cost. No
  long-lived child process means no orphan cleanup, no process pooling, and crash recovery
  is trivial. Process lifecycle is decoupled from any SSE subscriber's connection state.
- **Alternatives**: (B) server manages each lens agent as its own process — simpler process
  model but loses "just edit a skill" iteration speed; kept as fallback. (C) mirror a live
  interactive session via the hook/session-log mechanism — less real-time, couples the app
  to Claude Code's session-file conventions. Both rejected.

### 2. Skill-driven orchestration over app-code orchestration
- **Decision**: `.claude/skills/season-drafting/SKILL.md` owns the drafting logic; per-agent
  status comes from parsing the `<session>/subagents/*.jsonl` sidecar files Claude Code
  already writes.
- **Rationale**: The interesting logic is editable without touching application code.
- **Trade-off accepted**: depends on sidecar-file conventions; option B is the documented
  fallback if that proves unworkable.

### 3. Never assume session-ID stability across `--resume`
- **Decision**: Re-read the session ID from every turn's `stream-json` output and re-persist
  it after every turn, first-turn or resumed.
- **Rationale**: Empirical Unknown #1 — `--resume <id>` may fork to a *new* session ID. The
  defensive posture is correct whether or not the fork behavior materializes.

### 4. First turn is always context-seeded
- **Decision**: Assemble a canon context bundle before the user's first message reaches the
  model; later turns inherit it via `--resume`.
- **Rationale**: A cold-start conversation produces canon-inconsistent drafts. Unresolved
  threads from `continuity-ledger.md` are included **verbatim, never paraphrased or
  fabricated** (AC-HAPPY-1).

### 5. Diagnostics split: context usage is real, plan usage is best-effort
- **Decision**: Context usage is computed from the `usage` block present on every
  `stream-json` message. Plan usage (5-hour / 7-day rolling limits) is read from a
  statusLine snapshot file and reported as fresh / stale / **unavailable-with-reason**.
- **Rationale**: Research confirmed plan usage is only exposed via `statusLine` in
  *interactive* sessions — headless mode has no path to it. Rather than omit the panel or
  invent a number, the system degrades explicitly (AC-ERROR-6).

### 6. Signoff gate is mandatory and shared
- **Decision**: A conversation produces a draft; the user explicitly approves (commits to
  canon) or rejects with notes (returns to the same conversation). Never auto-commit.
- **Rationale**: This is the shape the later audit feature will reuse unchanged.

### 7. Draft state is a watched file, not a database
- **Decision**: The skill writes a structured draft file; the server watches it; atomic
  temp+rename writes prevent torn reads.
- **Rationale**: No database dependency for a single-user local tool; the draft file is
  human-inspectable.

### 8. Defense-in-depth `seasonId` validation (added mid-build)
- **Decision**: Allowlist `/^[a-zA-Z0-9_-]+$/` enforced at the HTTP route entry point, at
  `FileSessionStore` initialization, and at `SeasonEventBus` channel keying.
- **Rationale**: Added in response to the Phase 1 blocking code-review finding —
  `seasonId` is an untrusted route parameter reaching `path.join()` with no auth or CORS
  gate in front of the server.

## Implementation

### Phases

| Phase | Outcome | Tests | Commits |
|-------|---------|-------|---------|
| 1. Backend foundation | Bootstrapped `console/` (Hono + TS + npm + Vitest — the repo's first source tree). Session manager (spawn + resume), `stream-parser.ts`, SSE pub/sub with replay buffer, server entry. **1 blocking finding fixed**: path traversal via unvalidated `seasonId` → allowlist validator + 14 tests. | 25 | `edd7d1a`, `b3fb6a5` |
| 2. Context bundle + skill | `context-bundle.ts` (assemble / render / buildTurnPrompt) with verbatim unresolved-thread inclusion and first-turn-only bundling; `.claude/skills/season-drafting/SKILL.md`; `console/fixtures/canon/`. APPROVED (1 recommendation applied). | 31 | `7d54ff2`, `2476067`, `d7916ac` |
| 3. Season Chat + Draft Preview | First React/Vite surface: `SeasonChat.tsx`, `TranscriptTurn.tsx`, `DraftPreview.tsx`; torn-write-safe `draft-watcher.ts`; `GET /api/seasons/:seasonId/draft`. APPROVED WITH RECOMMENDATIONS. | 40 | `fbf6d7d`, `7407a2c` |
| 4. Signoff flow | `canon-commit.ts` (atomic season file + ledger append), `SignoffPanel.tsx`, `POST /approve` + `/reject`. **1 blocking finding fixed**: reject route returned false-success 200 on a crashed turn, violating AC-ERROR-1 → 502 + `{error, crashed, exitCode}`. | 52 | `10a41fa` |
| 5. Diagnostics panel | `statusline-probe.ts` (fresh/stale/unavailable discriminated result), `DiagnosticsPanel.tsx` with `computeContextUsage()`, `GET /api/statusline`, context-limit warning banner at 80%. APPROVED. | 63 | `ed19399`, `de1f850` |
| Reflection | Level 4 two-dimensional reflection + 3 extractable learnings. | — | `6315a67` |

### Key Components
See `memory-bank/techContext.md` § Component Structure for per-file detail. Summary:

- `console/server/season-session.ts` — headless spawn/resume manager + file-backed session
  store (atomic temp+rename session pointers), `isValidSeasonId()` allowlist
- `console/server/stream-parser.ts` — `stream-json` → normalized turn events (TS adaptation
  of this repo's `group_into_turns()`)
- `console/server/sse.ts` — `SeasonEventBus`, in-memory pub/sub with replay buffer and
  `?since=<seq>` resumption
- `console/server/context-bundle.ts` — canon → first-turn prompt prefix; missing optional
  files are omitted, never fabricated
- `console/server/draft-watcher.ts` — polls `season.draft.json`, discards torn/malformed
  reads, serves last-good (AC-ASYNC-3)
- `console/server/canon-commit.ts` — two atomic writes: rendered `season-<n>.md` + dated
  `continuity-ledger.md` append; fully dependency-injected for testing
- `console/server/statusline-probe.ts` — defensive snapshot reader with structural validator
- `console/src/` — `SeasonChat.tsx`, `TranscriptTurn.tsx`, `DraftPreview.tsx`,
  `SignoffPanel.tsx`, `DiagnosticsPanel.tsx`

### Technical Specifications
- **Stack**: Node 22+, TypeScript 5.7.2 (strict), Hono 4.6.14, React 18.3.1,
  react-router-dom 6.28.0, Vite 6.0.5, Vitest 2.1.8, jsdom 25.0.1
- **Binding**: `127.0.0.1` only — single-user local tool, no external exposure
- **Context window constant**: `CONTEXT_WINDOW_TOKENS = 200_000`;
  `CONTEXT_WARNING_THRESHOLD_RATIO = 0.8`
- **SSE event shape**: `{ seq: number, payload: any }`, one JSON object per event
- **Draft schema**: `{ seasonNumber, episodes: [{ title, logline, threads[] }], updatedAt }`

## Testing

### Strategy
Test-first (RED → GREEN) per phase, with a batched integration-verification pass and an
independent code-review pass at each phase gate. Server tests run on the Node environment;
client tests are scoped to `src/**` via `environmentMatchGlobs` so server tests stay fast.
All filesystem, clock, and fetch dependencies are injectable.

### Results

| Test Type | Count | Pass Rate |
|-----------|-------|-----------|
| Unit + integration (Vitest, 12 files) | 63 | 100% |
| Typecheck (`tsc --noEmit`) | — | PASS |
| Client build (`vite build`) | — | PASS |
| Lint | — | **N/A — never configured** |
| E2E | 0 | Not implemented (no UAT run for this task) |

### Coverage
Normal path (first turn, resumed turn), spawn failures, malformed stream, late-subscriber
replay, concurrent session isolation, canon file reading (real + fixture), graceful ENOENT,
`seasonId` path-traversal rejection at every boundary, draft torn-read handling, canon
commit atomicity, React component rendering/state, approve + reject-with-notes workflows
including the 502 crash path, context-usage computation, statusline snapshot
read/validation/freshness, and warning-threshold detection.

**Gap**: no coverage tool is configured; percentages are unavailable. No E2E/browser tests
exist — `/bmb:uat` was not run for this task.

## Deployment

### Procedures
Local-only; there is no deployment target.

```bash
cd console
npm install
npm run dev:server    # Hono backend, tsx watch, 127.0.0.1:8787
npm run dev:client    # Vite dev server, :5173, proxies /api → backend
# open http://localhost:5173/seasons/<seasonId>/chat
```

Production client bundle: `npm run build:client` → `dist/`.

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `YTS_CONSOLE_PORT` | 8787 | Hono bind port (always `127.0.0.1`) |
| `YTS_CANON_ROOT` | `./Canon` | Canon tree: sessions, drafts, ledger |
| `NODE_ENV` | (unset) | `test` skips server startup on `dev:server` |
| `YTS_STATUSLINE_SNAPSHOT_PATH` | — | **Documented but NOT wired** — the `/api/statusline` route always uses `DEFAULT_STATUSLINE_SNAPSHOT_PATH`. Known gap. |

**Prerequisite**: a working `claude` CLI on `PATH`, logged in. The server does not manage
authentication.

### Rollback
No deploy artifact. Rollback = `git revert` the feature PR. Canon writes are the only
durable side effect: an approved season writes `seasons/<seasonId>/season-<n>.md` and
appends to `continuity-ledger.md`. Both are plain files under version control in the canon
tree — revert by restoring those files. **The ledger append is not transactional with the
season-file write**; a crash between the two can leave a season file without its ledger
entry.

## Maintenance

### Monitoring
None configured. The server logs to stdout only; there is no OpenTelemetry instrumentation,
structured logging, or metrics export in this build. For a single-user localhost tool this
was accepted, but it means a failed turn is only visible in the terminal and the browser.

### Common Issues

| Issue | Resolution |
|-------|------------|
| Plan usage shows "unavailable" | Expected in headless mode unless an interactive session has written a statusLine snapshot. The reason string names the cause; it is never a fabricated number. |
| Draft preview stuck on old content | The watcher serves last-good state by design. Check that the skill is writing `season.draft.json` and that the JSON parses. |
| `400` on any season route | `seasonId` failed the `/^[a-zA-Z0-9_-]+$/` allowlist. |
| Reject returns 502 | The resumed headless turn crashed; `exitCode` is in the response body. This is correct behavior, not a false success. |
| Session appears to restart | Expected if `claude -p --resume` forked a new session ID; the server re-persists whatever ID the turn reports. |
| Composer does nothing | Known — the composer is rendered and enabled but not wired to a send action. Deferred by design. |

### Operational Procedures
- Canon tree is the system of record — back it up like source.
- `npm test` before any change; the suite is fast and fully offline.
- Dependency advisories are tracked in `techContext.md` and must be reviewed before any
  major-version bump.

## Lessons Learned

Full analysis: `memory-bank/reflection/conversational-season-drafting-reflection.md`.

1. **Both blocking defects were caught by code review, not TDD.** The Phase 1 path traversal
   and the Phase 4 false-success reject route were input-boundary and error-contract
   classes — exactly what a sufficiently adversarial test-first pass should have caught
   first. The review gate earned its cost; the TDD pass needs an adversarial-input step.
2. **`/bmb:brainstorm` substituted credibly for roadmap-create → plan → creative.** One
   dialogue produced a well-formed roadmap feature, task spec, and design doc for a Level 4
   task. One data point, not yet a generalization — worth tracking.
3. **Non-blocking recommendations have no carry-forward enforcement.** The shared
   `useSeasonDraft(seasonId)` hook was recommended at Phase 3, repeated at Phase 4, and
   Phase 5 added a third duplication site with zero remediation. The workflow needs either
   an escalation path or an explicit "accepted as permanent debt" closing step.
4. **A sub-agent whose job is "prepare artifacts" self-committed.** The Phase 5
   Documentation Agent ran `git commit` itself. Root-caused as an agent-definition
   constraint gap, not memory-bank staleness. Nothing was lost; the ambiguity between
   "stage" and "commit" is exploitable under agent autonomy.
5. **Task-scoped session logs were never populated.** `.agent-logs/claude/by-task/<slug>/`
   does not exist, so reflection fell back to a coarse grep over date directories and
   per-phase tool metrics were reported as unavailable rather than invented.

## References
- Reflection: `memory-bank/reflection/conversational-season-drafting-reflection.md`
- Design / creative: `memory-bank/creative/conversational-season-drafting-design.md`
- Roadmap feature: `memory-bank/roadmap/conversational-season-drafting.md`
- Task file: `memory-bank/tasks/conversational-season-drafting.md`
- Tech context: `memory-bank/techContext.md`
- Patterns: `memory-bank/systemPatterns.md`
- Implementation timeline: `git log main..feature/conversational-season-drafting`

## Future Considerations

### Technical debt (carried out of this task)
1. **Composer → POST wiring** — the general chat-send path (AC-ERROR-1 / AC-ASYNC-4) was
   never in this task's scope. Without it the app cannot actually hold a conversation from
   the UI; this is the single highest-value follow-on.
2. **`useSeasonDraft(seasonId)` hook** — draft-polling `useEffect` is now duplicated across
   `DraftPreview.tsx` and `SignoffPanel.tsx`; a third site was nearly added in Phase 5.
3. **Ledger read-modify-write race** in `canon-commit.ts` — concurrent approvals across
   seasons could lose an append. Low likelihood for a single-user tool; not fixed.
4. **`YTS_STATUSLINE_SNAPSHOT_PATH` not wired** to `process.env` in the `/api/statusline`
   route.
5. **react-router 6.x advisories** GHSA-wrjc-x8rr-h8h6 (open redirect) and
   GHSA-337j-9hxr-rhxg (SSR hydration constructor injection) — non-exploitable today
   (client-only SPA, no SSR, no user-controlled redirect target); deferred to a 7.x bump.
6. **Vitest 2.1.8 → 4.x** — dev-only transitive CVEs in the vite/esbuild chain; no
   production exposure. Tracked as a dedicated task.
7. **No lint configured** — every phase reported lint as N/A. Adding ESLint is a cheap
   Level 1 task.
8. **No observability** — no structured logging, no OpenTelemetry, no metrics. Accepted for
   a localhost single-user tool; revisit if this ever runs anywhere else.

### Enhancements
- The **Season Desk audit** (3-lens panel → numbered proposals) reuses this architecture
  unchanged and is the natural next feature.
- DeadLight → YTS canon migration, which turns the fixture tree into real data.
- E2E coverage via `/bmb:uat` once the composer is wired and a journey is walkable.

### Validated for reuse
The **headless-Claude-Code-as-a-service** pattern — spawn per turn, `--resume` for
continuity, `stream-json` parsed to normalized turn events, broadcast over SSE with a replay
buffer, driven by an editable skill file rather than application code — is proven and is the
intended foundation for every subsequent YT-Showrunner surface.
