---
version: next
status: planned
priority: high
complexity: 4
linked_tasks: [conversational-season-drafting]
created: 2026-08-12
---

# Conversational Season Drafting

The first slice of YT-Showrunner's Season Editor: a local web app (Hono + React/Vite,
matching DeadLight's console stack) that lets you draft/revise a season through a
free-form, multi-turn conversation with a Claude Code agent — mirroring how season-1.md
was actually created (talking through threads, weaving them into episode concepts,
getting inline story-craft and canon-consistency guidance) — rather than a batch
report/approval workflow.

Key pieces: a chat UI that streams a headless Claude Code conversation
(`claude -p --resume`) live via SSE, a context bundle assembled from canon (series
overview, character bibles, previous seasons, unresolved threads from
`continuity-ledger.md`) seeded into the first turn, a live draft preview, a signoff
gate (approve → commit to canon / reject with notes → back to the conversation), and
a diagnostics panel (context usage, best-effort plan-usage via a statusLine probe).

This is explicitly a UX/architecture validation exercise — proving the "web app +
headless Claude Code + live streaming status" pattern is the right direction — not a
blocker for episode 7 (fallback: continue episode 7 in the DeadLight repo if needed).
The structured audit/review "Season Desk" (3-lens panel: thread-auditor, arc-tracker,
craft-critic → numbered proposals) reuses the same architecture and is a later
follow-on feature, not part of this task.

**Complexity rationale**: Level 4 — new architectural foundation for the whole app
(headless Claude Code session-resume orchestration, stream-json + subagent-sidecar
parsing, SSE live status, statusLine-probe diagnostics), multiple components across
frontend/backend, and at least two creative phases (Architecture, UI/UX) are warranted
given the number of design decisions surfaced during brainstorming.
