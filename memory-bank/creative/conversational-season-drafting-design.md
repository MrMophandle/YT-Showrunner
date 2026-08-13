# Conversational Season Drafting — Design

Captured from a `/bmb:brainstorm` conversation (2026-08-12). Conversational
equivalent of a `/bmb:creative` Architecture + UI/UX design doc.

## Context

Ryan is rebuilding DeadLight's episode-planning tooling as YT-Showrunner (YTS),
replacing Archon (poor UX/UI for this work) while keeping the underlying craft/canon
checks that made DeadLight's process work. DeadLight's `season-1.md` was originally
created through a long, free-form conversation with a Claude agent — laying out
season-length threads, weaving them into episode concepts, getting story-craft and
canon-consistency guidance inline. This task rebuilds that experience as a real web
app surface instead of a raw chat session, and is explicitly a UX/architecture
validation exercise, not an ep7 blocker (fallback: continue ep7 in DeadLight if
needed).

## Approaches Considered

**Stack**: reuse DeadLight's proven Hono + React/Vite/TypeScript console stack rather
than introduce anything new — the "greenfield-ness" is in how it's used, not in
picking new tools. Confirmed: real-time transport is SSE (one-directional,
server→browser is all that's needed; approvals/replies go back as normal POSTs), not
WebSocket.

**Orchestration** (three options considered for getting live, granular multi-agent
status into the browser):
- **A. One headless Claude Code process running a skill that self-orchestrates via
  the Task tool** (chosen) — the skill/prompt owns the actual logic, editable without
  touching app code; per-agent status comes from parsing the
  `<session>/subagents/*.jsonl` sidecar files Claude Code already writes (same
  mechanism this repo's own session-logging scripts use).
- B. Server manages each lens agent as its own separate process — simpler process
  model, but loses "just edit a skill" iteration speed. (Rejected, kept as a fallback
  if A's sidecar-parsing proves unworkable.)
- C. Mirror a live interactive session via the hook/session-log mechanism instead of
  headless spawning — reuses existing infra but is less real-time and couples the app
  to Claude Code's session-file conventions. (Rejected.)

**Interaction shape** (major pivot mid-conversation): initially scoped as the
DeadLight "Season Desk" — a batch convene → single report → numbered-proposal
approval workflow (3-lens panel: thread-auditor, arc-tracker, craft-critic). Ryan
clarified that's actually the **audit** job (checking an already-drafted season
against what's been produced), distinct from how a season actually gets **drafted** —
a free-form, multi-turn conversation. Both share a final signoff gate (approve →
commit to canon / reject with notes → back to the conversation), but the audit's
report-and-numbered-proposals shape doesn't fit drafting. This task builds the
drafting conversation first (the harder, more novel UX); the audit UI is a deferred
follow-on that reuses the same architecture.

**Multi-turn mechanics**: Claude Code sessions are resumable across separate process
invocations (`claude -p --resume <session-id>`), so each user message spawns a fresh
headless process resuming the prior session rather than keeping one process alive
indefinitely. This avoids needing an always-on child process per open conversation.

## Decisions

1. **No containerization, no Anthropic API billing** — headless `claude -p`
   authenticates via Ryan's existing Claude Code login (Max plan), same as an
   interactive session.
2. **Canon/product data lives outside `memory-bank/`** — `Canon/`/`Episodes/`-style
   directories (mirroring DeadLight), migrated separately later. Engineering
   knowledge about *how YTS itself is built* (stream-parsing conventions, the
   session-resume pattern, etc.) belongs in `techContext.md`/`systemPatterns.md` and
   `agent-rules/_learned/` as it's discovered during the build — that's a distinct
   concern from the fictional/product data.
3. **First turn must be context-seeded, never a cold-start** — before the user's
   first message reaches the model, the server/skill assembles a canon context
   bundle (series overview, character bibles, previous season summaries, and
   currently-unresolved threads from `continuity-ledger.md`, confirmed as the
   authoritative source for the latter) and includes it in the first prompt. Every
   later turn inherits it via `--resume`.
4. **Diagnostics — context usage vs. plan usage split**:
   - Context usage (this conversation's token consumption) is derivable even in
     headless mode from the `usage` block already present on every `stream-json`
     message (same fields this repo's `claude_telemetry.py` already parses).
   - Plan usage (5-hour / 7-day rolling rate limits on the Max plan — no monthly
     window exists) is **only** exposed via Claude Code's `statusLine` mechanism, and
     only in interactive sessions — confirmed via research, not assumed. Headless
     mode has no path to it. Resolution: a best-effort **statusLine probe** — a
     statusLine-configured interactive session's rate-limit snapshot, read by the
     server — accepted as "as of your last active Claude Code session" rather than
     perfectly live, and flagged for validation early in the build (Phase 5).
5. **Signoff gate is the shared shape** across drafting and (later) audit: a
   conversation/analysis produces a draft; the user explicitly approves (commits to
   canon) or rejects with notes (returns to the same conversation for realignment).
   Never auto-commit without this step.
6. **Draft state is a watched file, not a database** — the skill periodically writes
   a structured draft file during the conversation; the server watches it
   (chokidar-style, matching DeadLight's console) and pushes updates to the frontend
   Draft Preview panel. Atomic writes (temp file + rename) to avoid torn reads.

## Deferred (explicitly out of scope for this task)

- The structured "Season Desk" audit (3-lens panel + numbered proposals) —
  reuses this task's architecture, separate future feature.
- DeadLight → YTS data migration (episodes, reference audio/images, scripts,
  outlines, Canon).
- Any UI beyond Season Chat / Draft Preview / Signoff / Diagnostics (e.g. episode
  creation/management views) — out of scope for the Planning subsystem's first
  slice.
