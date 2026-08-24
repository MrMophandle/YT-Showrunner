# memory-bank/techContext.md

## Technology Stack

### Runtime Environment
- **Node.js**: Latest (v22+) — runtime for Hono backend
- **TypeScript**: 5.7.2 — strict mode enforced across codebase
- **Package Manager**: npm 10+

### Languages & Frameworks
- **Hono**: 4.6.14 — lightweight backend HTTP framework for the season API
- **@hono/node-server**: 1.13.7 — Node.js adapter for Hono
- **React**: 18.3.1 — UI framework for Season Chat view and draft preview panel (Phase 3+)
- **react-router-dom**: 6.28.0 — client-side routing (Phase 3+). **SECURITY DEFERRAL**: Contains two moderate advisories (GHSA-wrjc-x8rr-h8h6 open-redirect, GHSA-337j-9hxr-rhxg SSR-hydration constructor-injection) with no non-breaking fix in the 6.x line. Non-exploitable today (client-only SPA, no SSR, no user-controlled redirect target) but tracked for a future 7.x major-version bump once a redirect-accepting surface is added.
- **Vite**: 6.0.5 — frontend build tool and dev server (Phase 3+)
- **Styling**: plain hand-written CSS, **no framework and no dependency**. A single stylesheet
  (`console/src/styles.css`) imported once from `src/main.tsx`; Vite handles it natively, so
  there is no PostCSS/Tailwind build config. See § Styling Conventions below.

### Development Tools
- **tsx**: 4.19.2 — TypeScript executor for dev server (watches and rebuilds on file changes)
- **Vitest**: 2.1.8 — test runner with Node.js environment by default; replaces Node's built-in test runner for this project. **SECURITY NOTE** (deferred): Vitest 2.1.8 has transitive dev-only CVEs in vite/esbuild chain (critical/high/moderate). No production exposure (no `--ui` flag, no Vite dev server). Scheduled for dedicated security bump to v4.x in a later phase.
- **jsdom**: 25.0.1 — DOM environment for React component testing (Phase 3+); scoped to `src/**` via `environmentMatchGlobs`, keeping server tests fast on Node environment
- **@testing-library/react**: 16.1.0 — React component testing utilities (Phase 3+)
- **@testing-library/jest-dom**: 6.6.3 — DOM matchers for React tests (Phase 3+)
- **TypeScript compiler (tsc)**: 5.7.2 — type checking via `npm run typecheck`

### Infrastructure & Local Development
- **Console Server Port**: Configurable via `YTS_CONSOLE_PORT` env var (default 6187). Server binds to `127.0.0.1` only — this is a single-user local tool with no external network exposure.
- **Canon Root**: Configurable via `YTS_CANON_ROOT` env var (default `./Canon`). Base directory for persistent session pointer storage.
- **Headless Claude**: Spawned via `claude -p --output-format stream-json` — integrated via season-session.ts, not a direct dependency

## Component Structure

### `console/` — Hono + React/Vite Full-Stack App (Phase 1-2: Backend Only)

**Phase 1 Scope (Greenfield Backend):**
- `console/server/` — Hono backend server
  - `index.ts` — Main app entry, routes, server binding
  - `season-session.ts` — Headless session manager and file-based session store
  - `sse.ts` — Server-Sent Events broadcast bus (in-memory pub/sub + replay buffer)
  - `stream-parser.ts` — TypeScript adaptation of `.agent-logs/claude_transcript_to_md.py`'s turn-grouping logic

**headless-draft-writes Phase 1: Permission Mode Handling**

Extended `console/server/season-session.ts` with explicit permission flags for spawned headless processes:
- `buildArgs()` now includes permission-mode-determined CLI flags: by default `--allowedTools Read,Write,Bash(mv *)` (tight allowlist); opt-in escape hatch via `YTS_PERMISSION_MODE=dangerously-skip-permissions` adds `--dangerously-skip-permissions` instead and logs a startup warning at module load.
- New exports: `PermissionMode` type, `ALLOWED_TOOLS` constant, `resolvePermissionMode()` function, `warnIfPermissionsDisabled()` function.
- The tight allowlist mirrors `.claude/settings.local.json`'s precedent for space-separated Bash-permission syntax (`Bash(mv *)` is narrowly scoped, not a bare `Bash` grant).

**headless-draft-writes Phase 2: Path Communication + Route-Authoritative SeasonId**

Closes defects 2 and 3 by ensuring the spawned headless process is explicitly told its canon root and draft path:
- `console/server/context-bundle.ts` — `BuildTurnPromptOptions` now requires `canonRoot` (show-level canon root) and `seasonId` (route-authoritative season identifier) fields. New helpers `resolveDraftPath()` and `renderPathFacts()` compute and state the absolute resolved draft path `<canonRoot>/seasons/<seasonId>/season.draft.json` on the first turn only (via `buildTurnPrompt()`), distinguishing the show-scoped canon root from the season-scoped draft path (AC-PATH-2). Resumed turns omit both facts since the session already carries them (AC-PATH-3).
- `console/server/turn-runner.ts` — Both `buildTurnPrompt()` call sites in `runSingleTurn()` now pass `canonRoot` and `seasonId` through, ensuring the prompt facts are stated on first-turn only.
- `.claude/skills/season-drafting/SKILL.md` — Corrected to document `<seasonId>` as the route-authoritative value (never inferred from conversation content) and state it is always taken from the prompt, never guessed (AC-SEASON-1). Removed stale `console/fixtures/canon/` local-dev fallback framing.
- Tests: `context-bundle.test.ts` (+5 new, 3 adjusted) and `turn-runner.test.ts` (+1 extended) now verify path facts are stated on first turn and omitted on resumed turns. Full test suite: 103/103 passing.

**Phase 2 Scope (Context Bundle + Skill Plumbing):**
- `console/server/context-bundle.ts` — Context bundle assembly: reads canon files (series overview, character bibles, previous season summaries, continuity ledger) and renders them into a first-turn prompt prefix. Missing optional files degrade gracefully (omitted, never fabricated). Continuity ledger content is included verbatim, never paraphrased.
- `.claude/skills/season-drafting/SKILL.md` — Prompt file (not TypeScript) defining conversational season-drafting logic: canon-aware questioning, thread-weaving, inline story-craft/canon-consistency checks, and maintenance of a draft file at `<CANON_ROOT>/seasons/<seasonId>/season.draft.json`. This skill does not implement signoff/approval (Phase 4) or output the draft directly to the user.
- `console/fixtures/canon/` — Fixture canon tree for tests and local development: `series-overview.md`, `characters/*.md`, `seasons/<n>/season-*.md`, `continuity-ledger.md`. Follows the same directory structure as production canon.

**Phase 1 Scope (Turn Runner + Prompt Composition):**
- `console/server/turn-runner.ts` — `SeasonTurnRunner`: owns the per-season FIFO message queue and single-flight guarantee. Decides first-turn (context bundle + skill prefix) vs. resumed-turn (bare message) prompt composition by checking `store.load(seasonId) === null` synchronously. Publishes a synthetic `{type:"user", message:{role:"user", content}}` event to the event bus right after `startTurn()` (never awaiting any downstream operations), using the raw user message text. Enforces single-flight: at most one headless process runs per season at any time via `inFlight` flag; additional messages are queued with 1-based queue position returned. On crash, discards all queued messages and publishes `{type:"yts_error", error, crashed:true, exitCode, discardedMessages}`. Not yet wired to `/message` or `/reject` routes (Phase 2).
- `console/server/context-bundle.ts` (extended) — New export `SEASON_DRAFTING_SKILL_COMMAND = "/season-drafting"`. `buildTurnPrompt()` first-turn branch now prefixes the composed prompt with this command (empty-bundle case: `"/season-drafting " + userMessage`; non-empty: `"/season-drafting " + bundleText + "\n\n---\n\n" + userMessage`). Resumed turns unchanged (bare user message).
  - **Known non-blocking item from Phase 1 code review**: The skill prefix is joined with a single space to a potentially multi-line context bundle. Confirmed against SKILL.md's invocation parsing during planning (skill loads deterministically), but Phase 2/3 builders should verify this spacing against the actual CLI behavior before wiring end-to-end.

**Phase 2 Scope (Routes: POST /message and /reject rewire) — THIS TASK:**
- `console/server/index.ts` (extended) — New route `POST /api/seasons/:seasonId/message` (accepts `{ message: string }`, validates seasonId + JSON + non-empty message, calls `turnRunner.submit()`, responds 200 `{started:true}` when accepted-and-running, or 202 `{queued:true, position}` when queued behind an in-flight turn — AC-ASYNC-1). Existing `/reject` route rewired to call `turnRunner.submitAwait()` instead of calling `sessionManager.sendMessage()` directly (closes the cold-start hole where a first-ever `/reject` used to skip context-bundle + skill-prefix composition — AC-INTEGRATION-1). Both routes now return 202 when a turn is in flight.
- `console/server/index.test.ts` (extended) — +7 new tests: `/message` accepted/queued/400-empty/400-bad-json/400-path-traversal, cold-start `/reject` composes bundle+skill identically to `/message`, all 3 pre-existing `/reject` tests still pass unmodified.

**Phase 3 Scope (Frontend: Season Chat + Draft Preview):**
- `console/server/draft-watcher.ts` — DraftWatcher: polls `season.draft.json`, discards torn/missing/malformed reads, keeps last-good draft in memory (AC-ASYNC-3). Unused push-based `start()`/`stop()` API scaffolding for future SSE-push draft mechanism; current route uses synchronous `pollOnce()` per-request. Wired to the new `GET /api/seasons/:seasonId/draft` route.
- `console/server/index.ts` (modified) — new route handler `GET /api/seasons/:seasonId/draft` using draft-watcher
- `console/src/` — React/Vite client
  - `main.tsx` — Client entry point, mounts React app into DOM
  - `App.tsx` — Root route component, sets up react-router-dom `<BrowserRouter>`
  - `pages/SeasonChat.tsx` — Season Chat view at route `/seasons/:seasonId/chat`. **Now fully wired**: composes textarea message, submits via `POST /api/seasons/:seasonId/message`, disables `Send` button while request in flight, manages pending-messages list (FIFO-drop-on-new-turn), handles `yts_error` event by rendering alert + restoring discarded text to composer (AC-ERROR-2, AC-ASYNC-2). Renders transcript with new messages as they stream in, plus side panels (Draft Preview, Signoff, Diagnostics).
  - `components/TranscriptTurn.tsx` — Renders one normalized turn from the stream parser (text, tool calls, collapsible thinking blocks)
  - `components/DraftPreview.tsx` — Polls `/api/seasons/:seasonId/draft`, re-renders on new draft, shows "no draft yet" empty state; keeps last-good draft on 204 or poll errors (AC-ASYNC-3)
  - `components/SignoffPanel.tsx` — Approve/reject-with-notes UI. **Updated Phase 3**: now treats HTTP `202` (queued) as a distinct third response state, rendering "Notes queued — will send once the current turn finishes" per AC-INTEGRATION-1 (matches `/message` route's 202-on-busy behavior).
- `console/vite.config.ts` — Vite frontend build config with react plugin
- `console/tsconfig.json` — TypeScript config for frontend (includes `src/**`, `jsx: react-jsx`, DOM lib)

**Phase 4 Scope (Signoff: Approve/Reject):**
- `console/server/canon-commit.ts` — Commits an approved SeasonDraft to canon via two atomic writes: (1) rendered markdown season file at `<canonRoot>/seasons/<seasonId>/season-<n>.md` using temp+rename pattern matching FileSessionStore, (2) dated entry appended to `<canonRoot>/continuity-ledger.md` listing the approved episodes' threads. Pure commit of draft as-is (no regeneration or model call); ledger-append is append-only (fuzzy thread-matching deliberately out of scope). Exports `commitDraftToCanon()` function and injectable test options for all three file operations (mkdir, write, rename, read).
- `console/server/index.ts` (modified) — New routes: `POST /api/seasons/:seasonId/approve` (calls `commitDraftToCanon()`, returns 400 if no draft or empty, 200 on success with file paths) and `POST /api/seasons/:seasonId/reject` (resumes session, streams reply to transcript via SSE, returns 200 on turn completion or 502 on crash per AC-ERROR-1).
- `console/src/components/SignoffPanel.tsx` — Approve/reject-with-notes UI. Polls `/api/seasons/:seasonId/draft` (using same fetch-injection pattern as DraftPreview) to enable Approve button only when >=1 episode exists. Approve POSTs `/approve` and shows file names on success. Reject textarea + button POSTs `{ notes }` to `/reject`; on success shows "notes sent" confirmation, on 502 shows `role="alert"` error (AC-ERROR-1 compliance — no false success).
- `console/src/pages/SeasonChat.tsx` (modified) — Now renders `<SignoffPanel seasonId={seasonId} />` instead of placeholder Signoff section.

**Known non-blocking items from Phase 4 code review:**
1. **Ledger read-modify-write race**: `canon-commit.ts` reads existing `continuity-ledger.md` content then atomically writes the concatenation. Two concurrent approvals across different seasons could race; one's ledger append could be lost. Low-likelihood for a single-user local tool; flagged for awareness, not fixed in this phase.
2. **Duplicated draft-polling logic**: `SignoffPanel.tsx`'s draft-polling `useEffect` mirrors `DraftPreview.tsx`'s near-identically. A shared `useSeasonDraft(seasonId)` hook was recommended (also flagged after Phase 3) but remains unextracted — now duplicated in two places.

**Phase 5 Scope (Diagnostics & Real Usage Metrics):**
- `console/server/statusline-probe.ts` — Best-effort reader of a statusLine rate-limit snapshot for the Diagnostics panel's plan-usage figure (AC-ERROR-6, AC-ERROR-2). Reads from a well-known file path (`DEFAULT_STATUSLINE_SNAPSHOT_PATH: <os.tmpdir()>/yts-statusline-snapshot.json`), validates shape defensively, never fabricates a value — returns a discriminated fresh/stale/unavailable result. Uses the same dependency-injection pattern for testability (snapshotPath, readFileFn, now, freshnessWindowMs all injectable). Does not write snapshots itself; reads one that some future interactive session may write. Includes structural validator `isStatuslineSnapshot()` that ensures `asOf` is parseable and optional `fiveHourPercentUsed`/`sevenDayPercentUsed`/`resetsAt` fields are correctly typed.
- `console/src/components/DiagnosticsPanel.tsx` — Context usage (real, from stream-json `usage` blocks) and plan usage (statusLine probe snapshot). Exports `computeContextUsage()` pure function (sums the four usage fields on the most recent turn carrying a usage block), `CONTEXT_WINDOW_TOKENS = 200_000` (NEW convention; per-model windows not yet needed), `CONTEXT_WARNING_THRESHOLD_RATIO = 0.8` (fires when usage crosses 80% of context window, per AC-ERROR-5). Polls `/api/statusline` route at a configurable interval (default 5000ms) using the same polling pattern as DraftPreview.tsx. Renders fresh/stale/unavailable plan-usage states exactly as the probe reports (explicit unavailable + reason, never fabricated), independent of context-usage rendering.
- `console/server/index.ts` (modified) — New route: `GET /api/statusline` (account-wide, no seasonId param, calls `readStatuslineSnapshot()` with defaults, always 200s with a discriminated `status` field).
- `console/src/pages/SeasonChat.tsx` (modified) — Replaced Diagnostics placeholder with real `<DiagnosticsPanel turns={turns} />`. Added transcript-side context-limit warning banner (AC-ERROR-5) that reuses `computeContextUsage()` against the same `turns` already in scope, avoiding re-derivation.

**Phase 5+: Message Send** (deferred) — composer integration, turn spawning, retry/crash handling (AC-ERROR-1, AC-ASYNC-4).

**Known non-blocking items from Phase 5 code review:**
1. **Statusline snapshot path env-var not wired**: `statusline-probe.ts`'s module doc mentions `YTS_STATUSLINE_SNAPSHOT_PATH` as the configurable-path convention (mirroring `YTS_CANON_ROOT` / `YTS_CONSOLE_PORT`), but `readStatuslineSnapshot()` only honors an injected `options.snapshotPath` (used by tests). The `/api/statusline` route in index.ts calls it with no options, so production always uses `DEFAULT_STATUSLINE_SNAPSHOT_PATH`. A natural follow-up would wire `process.env.YTS_STATUSLINE_SNAPSHOT_PATH ?? DEFAULT_STATUSLINE_SNAPSHOT_PATH` into the route.
2. **Ledger read-modify-write race** (from Phase 4): `canon-commit.ts` reads existing `continuity-ledger.md` content then atomically writes the concatenation. Two concurrent approvals across different seasons could race; one's ledger append could be lost. Low-likelihood for a single-user local tool; flagged for awareness.
3. **Duplicated draft-polling logic** (from Phase 4): `SignoffPanel.tsx`'s draft-polling `useEffect` mirrors `DraftPreview.tsx`'s near-identically. A shared `useSeasonDraft(seasonId)` hook was recommended but remains unextracted.

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness check; returns `{ status: "ok" }` |
| `GET` | `/api/statusline` | Best-effort plan-usage snapshot for the Diagnostics panel (Phase 5, AC-ERROR-6). Account-wide, not per-season. Always 200s with a discriminated `status` field: fresh / stale / unavailable (with reason). Never throws; read failures degrade gracefully to unavailable state. |
| `GET` | `/api/seasons/:seasonId/events` | Server-Sent Events stream for a season's conversation turns and transcript deltas. Query param `?since=<seq>` for resumption; omit to receive full current-turn buffer. |
| `GET` | `/api/seasons/:seasonId/draft` | Returns the last successfully parsed draft file (`season.draft.json`). Returns 200 with SeasonDraft JSON, 204 if no draft exists yet, or 400 if seasonId is invalid. Torn/partial reads are never surfaced; the endpoint keeps serving the last-good draft (AC-ASYNC-3). |
| `POST` | `/api/seasons/:seasonId/approve` | Approves the current draft and commits it to canon (Phase 4, AC-HAPPY-4). Requires >=1 episode in the draft; returns 200 `{ seasonFile, ledgerFile }` on success, 400 if no draft or empty draft, 502 if the commit operation fails. No regeneration or model call. |
| `POST` | `/api/seasons/:seasonId/message` | Sends a composer message into the season's drafting conversation (Phase 2, AC-HAPPY-2). Delegates to `SeasonTurnRunner.submit()` for prompt composition (first-turn context bundle + skill prefix vs. resumed bare message). Returns 200 `{ started: true }` if the turn was kicked off immediately, or 202 `{ queued: true, position }` if a turn is already in flight for this season (AC-ASYNC-1). Returns 400 on invalid seasonId, malformed JSON body, or empty/whitespace-only message. Accepts POST body: `{ message: string }`. |
| `POST` | `/api/seasons/:seasonId/reject` | Rejects the current draft with notes (Phase 4, AC-HAPPY-5). Resumes the season's session server-side using `SeasonTurnRunner.submitAwait()` — so a cold-start `/reject` (no prior session) composes the same first-turn context bundle + skill prefix as `/message`, closing the cold-start hole (AC-INTEGRATION-1). Also returns 202 `{ queued: true, position }` when a turn is in flight (matching `/message`'s behavior). Returns 200 `{ crashed: false, exitCode, sessionId }` on success, 400 if notes empty or invalid JSON, or 502 if the resumed turn crashes (AC-ERROR-1). Accepts POST body: `{ notes: string }`. |

**Response Format (SSE)**: One JSON object per event with fields `{ seq: number, payload: any }`.

**Draft Response Schema**:
```typescript
interface SeasonDraft {
  seasonNumber: number;
  episodes: Array<{ title: string; logline: string; threads: string[] }>;
  updatedAt: string;
}
```

### Environment Variables (12-Factor App)

| Variable | Default | Purpose |
|----------|---------|---------|
| `YTS_CONSOLE_PORT` | 6187 | Port the Hono backend binds to (always `127.0.0.1`, localhost only) |
| `YTS_CLIENT_PORT` | 6173 | Port the Vite dev client binds to |
| `YTS_CANON_ROOT` | `./Canon` | Base directory where season session pointers and drafts are persisted |
| `YTS_PERMISSION_MODE` | (unset) | Permission posture for the spawned `claude -p` season-turn process. Unset/empty/any value other than `dangerously-skip-permissions` uses a tight `--allowedTools` allowlist (`Read`, `Write`, `Bash(mv *)`); setting it to the literal string `dangerously-skip-permissions` swaps in `--dangerously-skip-permissions` instead and logs a startup warning naming the reduced safety posture. |
| `NODE_ENV` | (unset) | When `test`, skips server startup on `npm run dev:server` |

## Development Commands

Run all commands from the `console/` directory.

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies (Hono, React, dev tooling) |
| `npm run dev:server` | Start Hono backend dev server with tsx watch on port 6187 (rebuilds on file changes) |
| `npm run dev:client` | Start Vite frontend dev server (default port 6173); proxies `/api` to backend via Vite config |
| `npm run build:client` | Build React app for production (outputs to `dist/`) |
| `npm test` | Run Vitest once (CI mode) — runs all tests (server + client) with appropriate environments |
| `npm test:watch` | Run Vitest in watch mode (for active development) |
| `npm run typecheck` | Type-check all `.ts` and `.tsx` files without emitting output |

**Server startup output**: `YTS console server listening on http://127.0.0.1:6187 (localhost only)`

**Phase 3+ Development Workflow**: Start both `npm run dev:server` and `npm run dev:client` in separate terminals; browser opens to http://localhost:6173 with `/api` proxied to the backend. Use route `/seasons/:seasonId/chat` (e.g., http://localhost:6173/seasons/season-1/chat) to access Season Chat.

## Test Strategy

### Test Scope
- **Unit**: Stream parser functions, turn grouping logic, session store (in-memory and file-based), event bus pub/sub behavior
- **Integration**: Server routes (`/api/health`, `/api/seasons/:seasonId/events`), seasonId validation across all boundaries, session manager (spawn → parse → persist flow)
- **Path Traversal Coverage**: Explicit tests for `isValidSeasonId()` rejection of `..`, `../`, `/etc/passwd` patterns; validation tested at HTTP route entry point and FileSessionStore initialization

### Test File Locations
- `console/server/stream-parser.test.ts` — Stream-json parsing, turn grouping
- `console/server/sse.test.ts` — SeasonEventBus pub/sub and replay buffer behavior
- `console/server/season-session.test.ts` — Session store (in-memory, file-based), spawn lifecycle, --resume behavior
- `console/server/index.test.ts` — HTTP routes, seasonId validation at entry point (extended Phase 3 task: added tests for `/message` route, cold-start `/reject` integration; earlier phases: `/approve`, `/reject`, `/statusline` routes)
- `console/server/context-bundle.test.ts` — Context bundle assembly from canon files, graceful omission of missing files, first-turn-only bundle inclusion, skill-prefix composition (extended Phase 3 task)
- `console/server/draft-watcher.test.ts` — Draft file polling, torn-read handling, last-good graceful degradation (AC-ASYNC-3), structural validation
- `console/server/turn-runner.test.ts` — First-turn vs resumed prompt composition, skill prefix, synthetic user echo, queue ordering, single-flight guarantee, crash-discard policy (Phase 3 task)
- `console/server/canon-commit.test.ts` — Canon file commit (atomic temp+rename for both season file and ledger), test-injectable filesystem operations, seasonId validation, ledger formatting
- `console/server/statusline-probe.test.ts` — Statusline snapshot read, freshness validation, graceful degradation on missing/stale/unreadable snapshots
- `console/src/components/TranscriptTurn.test.tsx` — Turn rendering (text, tool calls, collapsible thinking)
- `console/src/components/DraftPreview.test.tsx` — Draft polling, empty state, last-good-on-error behavior
- `console/src/components/SignoffPanel.test.tsx` — Approve/reject UI, draft polling state, approval/rejection flow, error handling for 502 crashes, queued-notes (202) state (extended Phase 3 task)
- `console/src/components/DiagnosticsPanel.test.tsx` — Context-usage math, real rendering, plan-usage polling, warning threshold, unavailable-state rendering
- `console/src/pages/SeasonChat.test.tsx` — Composer form submission, pending-list rendering, yts_error alert, discarded-message restoration (Phase 3 task)

### Test Count & Coverage
- 89 tests total across 14 files (Phase 3 task: season-chat-conversation-loop added 7 new tests: 10 in turn-runner.test.ts, 2 in context-bundle.test.ts, 7 in index.test.ts for `/message` + cold-start `/reject`, 6 in SeasonChat.test.tsx, 1 in SignoffPanel.test.tsx for 202 queued-notes state = net +26 tests from 63; earlier phases in this same build had added more)
- Phase 3 task coverage: turn-runner single-flight FIFO queue, crash-discard policy, synthetic user echo, first-turn skill prefix and context bundle (never on resumption), prompt composition identity between `/message` and `/reject` routes, cold-start `/reject` loads bundle+skill (AC-INTEGRATION-1), `/message` returns 200/202/400/502 appropriately, composer submits and disables on flight, pending-message list renders and drops FIFO on new user turn, yts_error event handling and discarded-text restoration, SignoffPanel treats 202 as queued state (AC-INTEGRATION-1 client half)
- Full coverage includes: normal path (first turn, resumed turn), error cases (spawn failures, malformed stream), late-subscriber replay, concurrent session isolation, canon file reading (real + fixture), graceful ENOENT handling, seasonId path-traversal rejection, draft-file torn-read handling, canon commit atomicity, React component rendering and state updates, approval/rejection workflows, context-usage computation, statusline snapshot read/validation/freshness, single-flight guarantee, queue ordering, crash recovery, pending-message visibility

### Running Tests
```bash
npm test              # Single run (CI)
npm test:watch       # Watch mode (dev)
npm run typecheck    # Parallel type-check
```

## Styling Conventions

One stylesheet: `console/src/styles.css`, imported once from `src/main.tsx`. Zero styling
dependencies. Read the header comment in that file before extending it.

**Rules that are load-bearing, not stylistic:**

1. **Every color comes from a CSS custom property on `:root`.** The base `:root` block is the
   **dark** palette (this is a console you stare at for hours); a
   `@media (prefers-color-scheme: light)` block reassigns the same token *names*. A hardcoded
   color in a rule therefore silently ignores the light theme. `color-scheme` is declared in
   both branches so native form controls and scrollbars follow the theme.
2. **BEM class names** — `block`, `block__element`, `block--modifier` — continuing the
   convention `SeasonChat.tsx` and `TranscriptTurn.tsx` already used. The three rail panels
   share a `.panel` base class for framing and add their own block for content.
3. **`minmax(0, 1fr)`, never bare `1fr`, on the shell's grid column.** A bare `1fr` track will
   not shrink below its content's min-content width, so a single long unbroken string (a
   tool-call argument, a long logline) pushes the column past the viewport and gives the
   document a horizontal scrollbar.
4. **`min-height: 0` on any grid item that scrolls** (`.season-chat__transcript`,
   `.season-chat__panels`). Same underlying rule as #3: without it the region never scrolls —
   the whole document does, and the pinned composer drifts off-screen.
5. **Never put a `role="alert"` inside a collapsed `<details>`.** `getByRole` (and real
   assistive tech) excludes elements hidden from the accessibility tree, so a buried alert is
   both untestable and useless. `DiagnosticsPanel` keeps its context warning outside the
   disclosure for exactly this reason.

**No test asserts on any class name** — 0 of 105. That is deliberate and worth preserving: it
is what keeps restyling cheap. Style-related ACs are verified by computed layout in a real
browser, never by the suite, because jsdom applies no layout and computes no CSS.

## Notable Architectural Decisions

### Transcript Turn Grouping: One Turn Per Logical Exchange
`groupIntoTurns` (`server/stream-parser.ts`) does **not** map events to turns 1:1. The CLI
emits one event **per content block**, so a single assistant message spans several events
sharing one `message.id`, and one exchange spans several messages across tool round-trips.
A run of consecutive assistant events therefore merges into a single turn.

Three rules in that merge are load-bearing:

- **`usage` is last-write-wins.** Each block is the *full* context for its request, not an
  increment (see `computeContextUsage`). Summing merged blocks would report ~198k of a 200k
  window and fire a false near-limit warning; keeping the first would report a stale number.
- **User turns never merge.** `SeasonChat` pops one pending-message entry per newly observed
  user turn (AC-ASYNC-2). Collapsing two consecutive user messages desyncs that queue and
  strands a queued message in the composer.
- **`messageId`/`timestamp` keep their first values.** `SeasonChat` keys transcript rows off
  `messageId`; adopting each merged event's id would remount the row mid-stream.

A **contentless** turn is still returned rather than dropped — such an event can carry the only
`usage` block in a stream (the CLI emits `thinking` blocks containing the empty string, and
those events carry usage). Discarding it in the parser would destroy the context reading, so
suppression is `TranscriptTurn`'s job: it returns `null` when text, thinking, and tool calls
are all empty.

### Headless Process Model (No Long-Lived Child)
Each user message spawns a fresh `claude -p --resume <sessionId>` process that runs to completion, then exits. The process lifecycle is NOT coupled to any SSE subscriber's connection state. This simplifies crash recovery (no orphaned processes) and scales linearly (no process pooling complexity in Phase 1).

### Session ID Stability Unknown
Per task Empirical Unknown #1: `claude -p --resume <id>` may fork to a NEW session ID rather than reusing the one passed. The implementation never assumes session ID stability — it re-reads the session ID from every turn's stream-json output and re-persists it after every turn (first-turn or resumed). This defensive posture ensures correctness if the fork behavior materializes.

### Atomic File Writes (Temp + Rename)
Session pointers are persisted to `<canonRoot>/seasons/<seasonId>/.yts-session.json` using temp-file-then-rename (temp file named with pid+timestamp, then atomic rename). This pattern prevents partial writes on crash and will be reused for draft files in later phases.

### Defense-in-Depth SeasonId Validation
SeasonId is sourced from an untrusted HTTP route parameter (no auth/CORS gate in front of this server). The allowlist pattern (`/^[a-zA-Z0-9_-]+$/`) is enforced at:
1. HTTP route entry point (`index.ts`)
2. FileSessionStore initialization
3. SeasonEventBus channel keying

This prevents path-traversal shapes like `../../etc/passwd` from ever reaching `path.join()` or keying sensitive resources.
