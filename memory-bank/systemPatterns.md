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
│ Hono Backend (127.0.0.1:6187, localhost only)                   │
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

**Reuse in Phase 4 (Ledger Append)**:
- Canon-commit writes both the season markdown file AND appends a dated section to `continuity-ledger.md`
- Season file: fresh atomic write (straightforward)
- Ledger file: read-modify-write (read existing content, append new section, atomic write)
  - **Known Issue**: Concurrent approvals across different seasons could race on ledger writes; one's append could be lost. Low-likelihood for a single-user local tool. A future multi-user version would need a dedicated ledger-lock or event-log architecture.

**Reuse Plan**:
- This pattern will be used for draft files in later phases (drafts/<seasonId>/<turn-id>-draft.json)
- Establishes a single-writer file convention across the project

**Key Files**:
- `console/server/season-session.ts` — `FileSessionStore` class, `save()` method
- `console/server/canon-commit.ts` — `commitDraftToCanon()` and `atomicWrite()` helper (Phase 4)

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

### 7. Graceful Degradation Over Fabrication Pattern

**Problem**: When reading external state (files, snapshots, API data) that may be unavailable, stale, or malformed, the system must never fabricate or guess a value. Instead, it should degrade gracefully by explicitly reporting an unavailable/stale/fallback state, allowing the caller to render an honest error message to the user.

**Two Implementation Forms**:

#### Form A: Last-Good-State (Defensive Read for Atomic Writes)
A file is being written atomically (via temp + rename) by an external process, and a reader may attempt to read during the brief window between temp-file write and rename. A torn or partial read should never surface as a new state to the UI — the reader must keep serving the last successfully parsed state instead.

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

**Key Files**:
- `console/server/draft-watcher.ts` — `DraftWatcher.pollOnce()`, `isSeasonDraft()` structural validator
- `console/src/components/DraftPreview.tsx` — mirrors this pattern on the client side (ignores 204 responses, keeps last state)

#### Form B: Explicit Unavailable State (Best-Effort Snapshot Read)
A best-effort snapshot (e.g., a statusLine rate-limit file written by an interactive session, with no guarantee it exists or is current) should never fabricate a value: missing, stale, or malformed reads are reported as explicit unavailable/stale states rather than guessed zeroes or blanks.

**Implementation** (in `statusline-probe.ts`, `readStatuslineSnapshot()`):
```
1. Attempt to read snapshot file
2. If ENOENT: return { status: "unavailable", reason: "no_snapshot" }
3. If read fails (permissions, I/O): return { status: "unavailable", reason: "unreadable" }
4. If JSON.parse fails: return { status: "unavailable", reason: "unreadable" }
5. If structural validation fails: return { status: "unavailable", reason: "unreadable" }
6. If asOf timestamp is invalid (not parseable): return { status: "unavailable", reason: "unreadable" }
7. If parse succeeds:
   - Compare asOf age vs STATUSLINE_FRESHNESS_WINDOW_MS
   - Return { status: "fresh" | "stale", ...snapshot }
   - Never fabricate optional fields (fiveHourPercentUsed, etc.)
```

**Why This Matters** (AC-ERROR-6):
- No snapshot file exists yet (the interactive statusLine hook is not wired), or the snapshot is stale (interactive session died hours ago)
- Caller (Diagnostics panel) explicitly renders unavailable/stale states with a reason, never a placeholder 0% or blank
- Stale snapshots show their as-of timestamp so the user understands the data is old
- Plan-usage unavailability is independent of context-usage rendering; one never blocks the other

**Key Files**:
- `console/server/statusline-probe.ts` — `readStatuslineSnapshot()`, `isStatuslineSnapshot()` structural validator
- `console/src/components/DiagnosticsPanel.tsx` — `PlanUsageDisplay()` renders all three states (fresh / stale / unavailable) with explicit messaging

**Tradeoffs**:
- For Form A: Draft updates may lag by up to one poll interval if a read fails (typically 500ms–1s). Caller cannot distinguish "still reading the old draft" from "no update since last poll".
- For Form B: Caller must always handle unavailable/stale results; no automatic fallback. This is intentional — the pattern forbids fabrication.

**Reuse Plan**:
- This pattern will be used by all file-read surfaces: session pointers, draft files, future canon-state caches (Form A)
- Best-effort external-state reads: statusLine snapshots, plan-usage APIs, future analytics endpoints (Form B)
- Establishes a convention: "never guess; always say what you actually know"

### 8. Per-Season Single-Flight Queue with Crash-Discard Policy

**Problem**: Multiple user messages may arrive while a turn is already running for a season. Spawning concurrent headless processes for the same season risks race conditions on the session pointer, the SSE replay buffer, and the skill's single-writer guarantee on `season.draft.json`. A naive queue approach that drains into an unknown session state on crash would silently lose user input or cause the skill to write corrupted state.

**Implementation** (in `turn-runner.ts`, `SeasonTurnRunner`):
```
Per season:
- inFlight: boolean        ← True while a headless process is running
- queue: string[]          ← FIFO of raw user messages waiting

On submit():
  1. If inFlight: queue the message, return {status:"queued", queuePosition}
  2. Else: mark inFlight=true, kick off runTurn() async (don't await), return {status:"started"}

On submitAwait():
  1. If inFlight: queue the message, return {status:"queued", queuePosition}
  2. Else: mark inFlight=true, run single turn (await), handle outcome, return {status:"resolved", result}

On runTurn() completion:
  1. If crashed: discard all queued messages, publish {type:"yts_error", discardedMessages:[...]}
  2. Else: shift next message from queue, run it (recursive), or mark inFlight=false
```

**Route-Level Usage** (Phase 2):
- **`POST /api/seasons/:seasonId/message`** — Uses `submit()` (fire-and-forget). Returns 200 `{started:true}` or 202 `{queued:true, position}` immediately; actual turn outcome arrives later over SSE channel (`yts_error` on crash, or turn events on success). Never fabricates a synchronous crashed/success outcome since the turn hasn't run yet.
- **`POST /api/seasons/:seasonId/reject`** — Uses `submitAwait()` (sync outcome only when no turn in flight). Returns 200 with outcome or 502 on crash when THIS turn executes synchronously; otherwise 202 `{queued:true, position}` when queued. This preserves the historical `/reject` contract of a synchronous 200/502 response while closing the cold-start hole (a cold-start `/reject` now composes the same first-turn bundle+skill as `/message` would, not skipping them).

**Client-Level Usage (Phase 3: Composer Wiring)**:
- **Pending-Messages List (AC-ASYNC-2)**: When `/message` returns 202 (queued), the client's `SeasonChat.tsx` appends the message text to a local pending list rendered beneath the composer. This list shows the user their messages are queued and will run FIFO. Each pending entry persists until its corresponding user-role turn arrives over SSE: the client tracks incoming user-role turn events and **drops the oldest pending entry for each new user turn** (FIFO order matches the server's strict queue drain). This ensures messages render exactly once: either as pending, or as a transcript turn, never both.
- **Crash Recovery (AC-ERROR-2)**: When the SSE channel publishes a `yts_error` event (indicating the turn crashed), the client renders an alert (`role="alert"`), discards the pending list (those messages will not run), and **restores the discarded messages to the composer textarea**. If multiple messages were discarded, they are joined in queue order with blank lines and appended to (never overwriting) any text already in the composer, ensuring no user input is lost. The restoration is idempotent: tracked via a ref counting event arrivals, processed exactly once.
- **Reject Queueing (AC-INTEGRATION-1)**: When `SignoffPanel.tsx` submits a rejection with notes via `POST /reject` and receives a 202 response (turn is in flight, reject queued), it renders a distinct third state: "Notes queued — will send once the current turn finishes." This is distinct from 200 ("Notes sent") and from non-2xx errors ("The turn failed to complete"), preventing user confusion about whether notes were accepted or lost when the queue is busy.

**Why This Matters**:
- Concurrent-message safety: seasonId validation + per-season state isolation + synchronous inFlight flip (before any awaits) ensure exactly one spawn per season at a time
- Input preservation: crashed turns publish discarded messages to the event bus (never silently dropped); the UI restores them to the composer
- Session fidelity: queued turns drain strictly FIFO into a known-good session, never into a failed process
- Response honesty: `/message` never fabricates a turn outcome; `/reject` preserves synchronous outcomes only for immediate turns, not queued ones

**Tradeoff**:
- In-memory per-instance only; two concurrent server processes would each spawn. Acceptable for single-user localhost tool; a multi-server deployment would need a distributed lock (out of scope).

**Key Files**:
- `console/server/turn-runner.ts` — `SeasonTurnRunner` class, `submit()` and `submitAwait()` methods, `states: Map<seasonId, SeasonQueueState>`
- `console/server/index.ts` — Routes (`/message` → `submit()`, `/reject` → `submitAwait()`)

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
