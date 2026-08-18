---
version: next
status: completed
priority: high
complexity: 3
linked_tasks: [season-chat-conversation-loop]
created: 2026-08-17
completed: 2026-08-18
---

> **Status: completed** (2026-08-18) — the sole linked task
> `season-chat-conversation-loop` is COMPLETE.
> Archive: `memory-bank/archive/season-chat-conversation-loop-archive.md`

# Season Chat Conversation Loop

Makes the Season Chat app actually hold a drafting conversation. The
`conversational-season-drafting` feature built and unit-tested every component of the
loop but left three integration wires unconnected, so the app cannot currently accept
a typed message at all:

1. **The composer is a no-op** — `SeasonChat.tsx`'s `onSubmit` calls `preventDefault()`
   and clears the textarea; there is no POST route for sending a message.
2. **`context-bundle.ts` is orphaned** — `assembleContextBundle()`,
   `renderContextBundle()`, and `buildTurnPrompt()` are exported and tested but
   imported by nobody, so design decision #3 ("first turn must be context-seeded,
   never a cold-start") is not in effect at runtime.
3. **The season-drafting skill is never invoked** — `buildArgs()` points the spawned
   `claude -p` process at nothing, so the model never maintains `season.draft.json`
   and Draft Preview / Approve have nothing to act on.

This feature adds `POST /api/seasons/:seasonId/message`, routes every turn through a
single `SeasonTurnRunner` that owns first-turn prompt composition (context bundle +
skill invocation) and a per-season message queue, and wires the composer to it with
the reply streaming into the existing transcript. It also closes a latent hole where
`POST /reject` could cold-start a bundle-less, skill-less session.

The empirical unknown — how a headless `claude -p` loads a project skill — was settled
against the installed CLI (2.1.229) before the design was locked: skills are
auto-discovered from `.claude/skills/` but are **not** auto-invoked; a
`/season-drafting` prompt prefix loads the skill deterministically, and `--resume`
carries it into later turns. No new CLI flag, `--append-system-prompt`, or inlined
SKILL.md is required.

**Complexity rationale**: Level 3 — an intermediate feature spanning three surfaces
(new server module, two routes, one client view) and introducing a new async contract
(queue + 202 + SSE-delivered crash) with its own error semantics, but built entirely
on architecture and patterns already established and documented by
`conversational-season-drafting`. No new architectural foundation and no separate
creative phase beyond the brainstorm design doc. Complexity rationale: inferred by
/bmb:brainstorm.
