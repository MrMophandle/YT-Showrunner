# memory-bank/techContext.md

## Technology Stack

### Runtime Environment
- **Node.js**: Latest (v22+) — runtime for Hono backend
- **TypeScript**: 5.7.2 — strict mode enforced across codebase
- **Package Manager**: npm 10+

### Languages & Frameworks
- **Hono**: 4.6.14 — lightweight backend HTTP framework for the season API
- **@hono/node-server**: 1.13.7 — Node.js adapter for Hono

### Development Tools
- **tsx**: 4.19.2 — TypeScript executor for dev server (watches and rebuilds on file changes)
- **Vitest**: 2.1.8 — test runner with Node.js environment; replaces Node's built-in test runner for this project. **SECURITY NOTE** (deferred): Vitest 2.1.8 has transitive dev-only CVEs in vite/esbuild chain (critical/high/moderate). No production exposure (no `--ui` flag, no Vite dev server). Scheduled for dedicated security bump to v4.x in a later phase.
- **TypeScript compiler (tsc)**: 5.7.2 — type checking via `npm run typecheck`

### Infrastructure & Local Development
- **Console Server Port**: Configurable via `YTS_CONSOLE_PORT` env var (default 8787). Server binds to `127.0.0.1` only — this is a single-user local tool with no external network exposure.
- **Canon Root**: Configurable via `YTS_CANON_ROOT` env var (default `./Canon`). Base directory for persistent session pointer storage.
- **Headless Claude**: Spawned via `claude -p --output-format stream-json` — integrated via season-session.ts, not a direct dependency

## Component Structure

### `console/` — Hono + React/Vite Full-Stack App (Phase 1: Backend Only)

**Phase 1 Scope (Greenfield Backend):**
- `console/server/` — Hono backend server
  - `index.ts` — Main app entry, routes, server binding
  - `season-session.ts` — Headless session manager and file-based session store
  - `sse.ts` — Server-Sent Events broadcast bus (in-memory pub/sub + replay buffer)
  - `stream-parser.ts` — TypeScript adaptation of `.agent-logs/claude_transcript_to_md.py`'s turn-grouping logic

**Phase 3+: Frontend** (React/Vite) — will live in `console/` with its own `vite.config.ts`; dev workflow will proxy `/api` to this backend server.

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness check; returns `{ status: "ok" }` |
| `GET` | `/api/seasons/:seasonId/events` | Server-Sent Events stream for a season's conversation turns and transcript deltas. Query param `?since=<seq>` for resumption; omit to receive full current-turn buffer. |

**Response Format (SSE)**: One JSON object per event with fields `{ seq: number, payload: any }`.

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
| `npm install` | Install dependencies (Hono, dev tooling) |
| `npm run dev:server` | Start Hono dev server with tsx watch (rebuilds on file changes, no file-watch restart) |
| `npm test` | Run Vitest once (CI mode) |
| `npm test:watch` | Run Vitest in watch mode (for active development) |
| `npm run typecheck` | Type-check all `.ts` files without emitting output |

**Server startup output**: `YTS console server listening on http://127.0.0.1:8787 (localhost only)`

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

### Test Count & Coverage
- 25 tests total across 4 files
- Coverage includes: normal path (first turn, resumed turn), error cases (spawn failures, malformed stream), late-subscriber replay, concurrent session isolation

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
