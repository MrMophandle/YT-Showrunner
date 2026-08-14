# System Patterns

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser (React/Vite, Phase 3+)                                  │
│ - User messages: POST /api/seasons/:seasonId/message            │
│ - Transcript stream: GET /api/seasons/:seasonId/events (SSE)    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                  [API Proxy via Vite]
                         │
┌────────────────────────▼────────────────────────────────────────┐
│ Hono Backend (127.0.0.1:8787, localhost only)                   │
│                                                                   │
│  index.ts                                                        │
│  ├─ /api/health → { status: "ok" }                             │
│  └─ /api/seasons/:seasonId/events → SeasonEventBus SSE stream  │
│                                                                   │
│  SeasonSessionManager (season-session.ts)                       │
│  └─ runTurn(seasonId, prompt, resumeSessionId?)                │
│     ├─ Spawn: claude -p --resume <id> --output-format stream-json
│     ├─ Parse: stream-parser.ts groups into NormalizedTurns      │
│     └─ Persist: FileSessionStore saves session pointer         │
│                                                                   │
│  SeasonEventBus (sse.ts)                                        │
│  └─ In-memory pub/sub, one channel per season                   │
│     ├─ startTurn() — clears current-turn buffer                │
│     ├─ publish(seasonId, payload) — broadcasts + buffers       │
│     └─ subscribe(seasonId) — returns missed + listener callback │
└────────────────────────┬────────────────────────────────────────┘
                         │
                  [Local Filesystem]
                         │
┌────────────────────────▼────────────────────────────────────────┐
│ Canon/ (Persistent State)                                        │
│ └─ seasons/<seasonId>/.yts-session.json                        │
│    (session pointer; future: draft files, turn metadata)        │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture Patterns

### 1. Headless-Spawn-Per-Turn Pattern

**Problem**: Need to run multi-turn conversations with the Claude API without maintaining a long-lived process connection.

**Implementation**:
- Each user message triggers a fresh spawn of `claude -p --resume <sessionId>` (see `season-session.ts`)
- Process runs to completion, then exits
- Session ID persisted to disk so next turn can `--resume` from same conversation
- Process lifecycle is intentionally NOT coupled to SSE subscriber connections (AC-ASYNC-1)

**Advantages**:
- Simple crash recovery (no orphaned processes to clean up)
- Scales linearly (no process pool management)
- Each turn is isolated; no shared mutable state in the headless process

**Tradeoff**:
- Small overhead per turn (process spawn/exit); acceptable for interactive use

**Key Files**:
- `console/server/season-session.ts` — `runTurn()` function
- `console/server/index.ts` — SSE endpoint integration

### 2. Atomic File Write Pattern (Temp + Rename)

**Problem**: Need to persist session pointers to disk without risk of partial writes on process crash.

**Implementation** (in `season-session.ts`, `FileSessionStore.save()`):
```
1. mkdir -p <canonRoot>/seasons/<seasonId>
2. writeFile <path>.tmp-<pid>-<timestamp> ← atomic, temp scope
3. rename <path>.tmp-<pid>-<timestamp> → <path>.json ← atomic OS call
```

**Why This Matters**:
- Rename is atomic at the OS level (POSIX guarantee)
- Temp file prevents another process from reading a half-written state
- PID + timestamp in temp name prevents collisions if multiple processes write to the same season

**Reuse Plan**:
- This pattern will be used for draft files in later phases (drafts/<seasonId>/<turn-id>-draft.json)
- Establishes a single-writer file convention across the project

**Key Files**:
- `console/server/season-session.ts` — `FileSessionStore` class, `save()` method

### 3. SeasonId Allowlist Validation Pattern (Defense in Depth)

**Problem**: SeasonId comes from an untrusted HTTP route parameter; no auth/CORS gate in front of this server.

**Attack Vector**: Path traversal (e.g., `..`, `../../etc/passwd`, `/etc/shadow`)

**Implementation** (in `season-session.ts`):
```typescript
export function isValidSeasonId(seasonId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(seasonId);
}
```

**Defense-in-Depth Enforcement**:
1. HTTP route entry point (`index.ts`, line 47) — reject before any downstream processing
2. FileSessionStore initialization (`season-session.ts`, line 174) — re-validate in store impl
3. SeasonEventBus channel keying (implicit in `sse.ts`) — validate before pub/sub

**Why Multiple Checks**:
- If one layer is bypassed (e.g., during refactoring), the next layer catches it
- Each component is independently safe, not relying on caller discipline

**Test Coverage**:
- `console/server/index.test.ts` — HTTP route validation
- `console/server/season-session.test.ts` — FileSessionStore path traversal rejection

**Key Files**:
- `console/server/season-session.ts` — `isValidSeasonId()` function
- `console/server/index.ts` — route-level validation
- `console/server/sse.ts` — implicit (channel keys are validated seasonIds)

### 4. In-Memory Pub/Sub + Replay Buffer SSE Pattern

**Problem**: Browser clients may connect mid-turn or reconnect after brief disconnect. They need to receive:
- The current turn's events they missed (if subscribed after turn started)
- All new events going forward

**Implementation** (in `sse.ts`, `SeasonEventBus`):
```
Per-season channel:
- buffer: SeasonStreamEvent[]  ← holds current turn's events
- nextSeq: number             ← monotonic event counter (per turn)
- listeners: Set<Listener>    ← active subscribers

On subscribe:
- Return missed events (buffer filtered by since parameter)
- Add listener for live events
- Both are delivered via same callback

On publish:
- Buffer event, increment seq
- Notify all live listeners

On turn boundary:
- eventBus.startTurn(seasonId) clears buffer, resets seq to 0
- New turn events start fresh at seq 0
```

**Replay Guarantee**:
- Late subscriber connects mid-turn at seq 5 → receives buffered events 6+ (missed)
- Next event at seq 10 is delivered live
- Seq monotonically increases within a turn; resets per turn

**Lifecycle**:
- First turn: seq 0, 1, 2, ..., N
- startTurn() resets seq to 0
- Next turn: seq 0, 1, 2, ..., M
- Buffer persists only for the current turn (bounded memory)

**Future Enhancement** (Phase 3):
- Full reconnect-replay semantics (persisting events across turn boundaries)
- Will be layered on top of this pattern

**Key Files**:
- `console/server/sse.ts` — `SeasonEventBus` class
- `console/server/index.ts` — SSE endpoint, subscribes and waits for unsubscribe signal

### 5. Stream-JSON Parsing Adaptation Pattern

**Problem**: `claude -p --output-format stream-json` outputs event stream at runtime. Need to parse it into a normalized turn model in real time.

**Implementation** (in `stream-parser.ts`):
- Adapted from `.agent-logs/claude_transcript_to_md.py`'s `group_into_turns()` (Python, file-based)
- Runs on live stream instead of persisted JSONL
- Turn grouping rule: user/assistant message event starts a turn; trailing tool_result events (emitted as user events) are appended to the current turn

**Pipeline**:
1. `parseStreamLine()` — parse one raw stdout line into JSON or ParseErrorEvent
2. `groupIntoTurns()` — group JSON objects into NormalizedTurn[] by role
3. `parseStreamJson()` — combine both, extract session ID and result event

**No-Silent-Failures Rule**:
- Malformed lines are surfaced in `parseErrors`, never silently dropped
- Lets consumers decide how to handle (log, display, retry)

**Session ID Handling**:
- Re-read session ID from EVERY event (line 258–261), never assume it's stable across `--resume`
- Stores the LAST session ID observed (may differ from the one passed to `--resume`)

**Tool Results**:
- Only grouped into the same turn if they follow a user message with tool_result content
- Tool results without an open turn are surfaced as unknownEvents

**Key Files**:
- `console/server/stream-parser.ts` — all parsing functions
- `console/server/season-session.ts` — `runTurn()` consumes parseStreamJson output

### 6. Context Bundle Assembly Pattern (Verbatim-First, Graceful Omission)

**Problem**: Need to seed a season-drafting conversation with canon context (series overview, character bibles, prior season summaries, unresolved threads) without fabricating or hallucinating missing pieces. Continuity ledger thread descriptions must never be paraphrased or summarized — the conversation must reference the exact wording from disk.

**Implementation** (in `context-bundle.ts`, `assembleContextBundle` + `renderContextBundle`):
```
1. Read canon files from a configurable root (series-overview.md, characters/*.md, seasons/<n>/season-*.md, continuity-ledger.md)
2. For each file, catch ENOENT and return null/[] — do not propagate the error
3. Render only the sections whose source file was found
4. Omit empty sections entirely — never render a heading with no content or a placeholder like "[no previous seasons]"
5. Include continuity ledger content verbatim; never paraphrase or rewrite unresolved threads
```

**Why This Matters**:
- Prevents hallucination: if the user's canon is incomplete (early in the show, no previous seasons yet), the conversation doesn't make up missing threads or try to fill gaps
- Ensures thread fidelity: continuity ledger text is read byte-for-byte from disk and never rewritten, so the conversation can reference it with confidence
- Graceful degradation: an incomplete canon tree (missing characters/ or seasons/ directory) does not break the conversation — it just omits that section

**First-Turn-Only Inclusion** (via `buildTurnPrompt`):
- First turn: context bundle prepended to user's message
- Resumed turns (`--resume <sessionId>`): user's message only, since the bundle already lives in the resumed session's history
- This prevents token waste and ensures the bundle isn't re-sent on every turn

**Fixture Convention**:
- Test/dev canon at `console/fixtures/canon/` follows the same directory structure as production canon
- Allows local testing and fixtures to use the same assembly logic without mocking the filesystem

**Key Files**:
- `console/server/context-bundle.ts` — `assembleContextBundle()`, `renderContextBundle()`, `buildTurnPrompt()`
- `console/server/season-session.ts` — `isValidSeasonId()` validation (reused for path-traversal defense in depth)
- `.claude/skills/season-drafting/SKILL.md` — documents the conversational use of the context bundle

### 7. Last-Good-State Graceful Degradation Pattern (Defensive Read)

**Problem**: A file is being written atomically (via temp + rename) by an external process, and a reader may attempt to read during the brief window between temp-file write and rename. A torn or partial read should never surface as a new state to the UI — the reader must keep serving the last successfully parsed state instead.

**Implementation** (in `draft-watcher.ts`, `pollOnce()`):
```
1. Attempt to read file
2. If ENOENT: return last-good state (no draft written yet)
3. If read fails (permissions, I/O): throw (a "real" error, surface to caller)
4. If parse fails (malformed JSON): return last-good state, retry next poll
5. If structure validation fails (wrong schema): return last-good state, retry next poll
6. If parse succeeds: update last-good, notify listeners, return updated
```

**Why This Matters** (AC-ASYNC-3):
- Torn reads are transient: the next poll will retry and succeed once the atomic rename completes
- UI never "flashes" a broken or incomplete state to the user
- Last-good is preserved in memory across polls; if the file disappears, the panel still shows the previous draft
- Distinguishes transient read failures (retry silently) from real errors (throw, surface to caller)

**Trade-offs**:
- Draft updates may lag by up to one poll interval if a read fails (typically 500ms–1s)
- Caller cannot distinguish "still reading the old draft" from "no update since last poll"
- Requires structural validation (not just JSON.parse) to catch schema mismatches

**Reuse Plan**:
- This pattern will be used by all file-read surfaces that must be resilient to concurrent atomic writes (session pointers, draft files, future canon-state caches)
- Establishes a convention: "on read failure, keep serving what you already have"

**Key Files**:
- `console/server/draft-watcher.ts` — `DraftWatcher.pollOnce()`, `isSeasonDraft()` structural validator
- `console/src/components/DraftPreview.tsx` — mirrors this pattern on the client side (ignores 204 responses, keeps last state)

## Conventions

### File Organization
- `console/server/*.ts` — Backend modules (no subdirectories in Phase 1; will grow per phase)
- `console/server/*.test.ts` — Collocated test files (same directory as source)

### Session Pointer Persistence
- **Location**: `<canonRoot>/seasons/<seasonId>/.yts-session.json`
- **Format**: JSON `{ seasonId, sessionId, updatedAt }`
- **Write Pattern**: Atomic temp + rename (see pattern #2 above)
- **Read Pattern**: Cached in SeasonSessionManager for a single turn; re-read fresh on next turn

### Error Handling
- No silent failures (e.g., malformed stream lines are captured in `parseErrors`)
- Spawn failures surface as `crashed: true` with `stderr`
- 500 errors for invalid seasonId return 400 (client error, not server error)

### Async Patterns
- `runTurn()` returns `Promise<RunTurnResult>` — resolves when process exits, not when first event arrives
- `SeasonEventBus.subscribe()` is synchronous (returns immediately with missed events)
- SSE subscriber receives live events via callback; connection close triggers unsubscribe

### Type Safety
- TypeScript strict mode enforced
- Interfaces for domain models (NormalizedTurn, SessionRecord, SeasonStreamEvent)
- ParseErrorEvent type for malformed input (no `any` strings)

### Testing Pattern
- Use injectable `SpawnFn` for test mocking (e.g., mock spawn to return a fake ChildProcessLike)
- Use `InMemorySessionStore` in tests instead of FileSessionStore
- HTTP routes tested via Hono's test utilities (see index.test.ts)
