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

### Development Tools
- **tsx**: 4.19.2 — TypeScript executor for dev server (watches and rebuilds on file changes)
- **Vitest**: 2.1.8 — test runner with Node.js environment by default; replaces Node's built-in test runner for this project. **SECURITY NOTE** (deferred): Vitest 2.1.8 has transitive dev-only CVEs in vite/esbuild chain (critical/high/moderate). No production exposure (no `--ui` flag, no Vite dev server). Scheduled for dedicated security bump to v4.x in a later phase.
- **jsdom**: 25.0.1 — DOM environment for React component testing (Phase 3+); scoped to `src/**` via `environmentMatchGlobs`, keeping server tests fast on Node environment
- **@testing-library/react**: 16.1.0 — React component testing utilities (Phase 3+)
- **@testing-library/jest-dom**: 6.6.3 — DOM matchers for React tests (Phase 3+)
- **TypeScript compiler (tsc)**: 5.7.2 — type checking via `npm run typecheck`

### Infrastructure & Local Development
- **Console Server Port**: Configurable via `YTS_CONSOLE_PORT` env var (default 8787). Server binds to `127.0.0.1` only — this is a single-user local tool with no external network exposure.
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

**Phase 2 Scope (Context Bundle + Skill Plumbing):**
- `console/server/context-bundle.ts` — Context bundle assembly: reads canon files (series overview, character bibles, previous season summaries, continuity ledger) and renders them into a first-turn prompt prefix. Missing optional files degrade gracefully (omitted, never fabricated). Continuity ledger content is included verbatim, never paraphrased.
- `.claude/skills/season-drafting/SKILL.md` — Prompt file (not TypeScript) defining conversational season-drafting logic: canon-aware questioning, thread-weaving, inline story-craft/canon-consistency checks, and maintenance of a draft file at `<CANON_ROOT>/seasons/<seasonId>/season.draft.json`. This skill does not implement signoff/approval (Phase 4) or output the draft directly to the user.
- `console/fixtures/canon/` — Fixture canon tree for tests and local development: `series-overview.md`, `characters/*.md`, `seasons/<n>/season-*.md`, `continuity-ledger.md`. Follows the same directory structure as production canon.

**Phase 3 Scope (Frontend: Season Chat + Draft Preview):**
- `console/server/draft-watcher.ts` — DraftWatcher: polls `season.draft.json`, discards torn/missing/malformed reads, keeps last-good draft in memory (AC-ASYNC-3). Unused push-based `start()`/`stop()` API scaffolding for future SSE-push draft mechanism; current route uses synchronous `pollOnce()` per-request. Wired to the new `GET /api/seasons/:seasonId/draft` route.
- `console/server/index.ts` (modified) — new route handler `GET /api/seasons/:seasonId/draft` using draft-watcher
- `console/src/` — React/Vite client
  - `main.tsx` — Client entry point, mounts React app into DOM
  - `App.tsx` — Root route component, sets up react-router-dom `<BrowserRouter>`
  - `pages/SeasonChat.tsx` — Season Chat view at route `/seasons/:seasonId/chat`. Renders empty transcript initially, composer (enabled but not wired to send yet), three side panels (Draft Preview, Signoff, Diagnostics stub implementations).
  - `components/TranscriptTurn.tsx` — Renders one normalized turn from the stream parser (text, tool calls, collapsible thinking blocks)
  - `components/DraftPreview.tsx` — Polls `/api/seasons/:seasonId/draft`, re-renders on new draft, shows "no draft yet" empty state; keeps last-good draft on 204 or poll errors (AC-ASYNC-3)
- `console/vite.config.ts` — Vite frontend build config with react plugin
- `console/tsconfig.json` — TypeScript config for frontend (includes `src/**`, `jsx: react-jsx`, DOM lib)

**Phase 4+: Signoff & Diagnostics** (deferred) — approve/reject logic, context-usage math, plan-usage probe.

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness check; returns `{ status: "ok" }` |
| `GET` | `/api/seasons/:seasonId/events` | Server-Sent Events stream for a season's conversation turns and transcript deltas. Query param `?since=<seq>` for resumption; omit to receive full current-turn buffer. |
| `GET` | `/api/seasons/:seasonId/draft` | Returns the last successfully parsed draft file (`season.draft.json`). Returns 200 with SeasonDraft JSON, 204 if no draft exists yet, or 400 if seasonId is invalid. Torn/partial reads are never surfaced; the endpoint keeps serving the last-good draft (AC-ASYNC-3). |

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
| `YTS_CONSOLE_PORT` | 8787 | Port the Hono backend binds to (always `127.0.0.1`, localhost only) |
| `YTS_CANON_ROOT` | `./Canon` | Base directory where season session pointers and drafts are persisted |
| `NODE_ENV` | (unset) | When `test`, skips server startup on `npm run dev:server` |

## Development Commands

Run all commands from the `console/` directory.

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies (Hono, React, dev tooling) |
| `npm run dev:server` | Start Hono backend dev server with tsx watch on port 8787 (rebuilds on file changes) |
| `npm run dev:client` | Start Vite frontend dev server (default port 5173); proxies `/api` to backend via Vite config |
| `npm run build:client` | Build React app for production (outputs to `dist/`) |
| `npm test` | Run Vitest once (CI mode) — runs all tests (server + client) with appropriate environments |
| `npm test:watch` | Run Vitest in watch mode (for active development) |
| `npm run typecheck` | Type-check all `.ts` and `.tsx` files without emitting output |

**Server startup output**: `YTS console server listening on http://127.0.0.1:8787 (localhost only)`

**Phase 3+ Development Workflow**: Start both `npm run dev:server` and `npm run dev:client` in separate terminals; browser opens to http://localhost:5173 with `/api` proxied to the backend. Use route `/seasons/:seasonId/chat` (e.g., http://localhost:5173/seasons/season-1/chat) to access Season Chat.

## Test Strategy

### Test Scope
- **Unit**: Stream parser functions, turn grouping logic, session store (in-memory and file-based), event bus pub/sub behavior
- **Integration**: Server routes (`/api/health`, `/api/seasons/:seasonId/events`), seasonId validation across all boundaries, session manager (spawn → parse → persist flow)
- **Path Traversal Coverage**: Explicit tests for `isValidSeasonId()` rejection of `..`, `../`, `/etc/passwd` patterns; validation tested at HTTP route entry point and FileSessionStore initialization

### Test File Locations
- `console/server/stream-parser.test.ts` — Stream-json parsing, turn grouping
- `console/server/sse.test.ts` — SeasonEventBus pub/sub and replay buffer behavior
- `console/server/season-session.test.ts` — Session store (in-memory, file-based), spawn lifecycle, --resume behavior
- `console/server/index.test.ts` — HTTP routes, seasonId validation at entry point
- `console/server/context-bundle.test.ts` — Context bundle assembly from canon files, graceful omission of missing files, first-turn-only bundle inclusion
- `console/server/draft-watcher.test.ts` — Draft file polling, torn-read handling, last-good graceful degradation (AC-ASYNC-3), structural validation (Phase 3)
- `console/src/components/TranscriptTurn.test.tsx` — Turn rendering (text, tool calls, collapsible thinking) (Phase 3)
- `console/src/components/DraftPreview.test.tsx` — Draft polling, empty state, last-good-on-error behavior (Phase 3)

### Test Count & Coverage
- 40 tests total across 8 files
- Coverage includes: normal path (first turn, resumed turn), error cases (spawn failures, malformed stream), late-subscriber replay, concurrent session isolation, canon file reading (real + fixture), graceful ENOENT handling, seasonId path-traversal rejection, draft-file torn-read handling, React component rendering and state updates

### Running Tests
```bash
npm test              # Single run (CI)
npm test:watch       # Watch mode (dev)
npm run typecheck    # Parallel type-check
```

## Notable Architectural Decisions

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
