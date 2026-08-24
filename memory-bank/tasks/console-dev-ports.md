---
slug: console-dev-ports
legacy_id:
feature:
status: IN_PROGRESS
---

# console-dev-ports: Move Console Dev Ports to 61XX

**Complexity**: Level 1
**Status**: PLANNED
**Roadmap**: none (Level 1 — config/docs hygiene, no product capability added)
**Branch**: task/console-dev-ports
**Worktree**: N/A (in-repo checkout)

## Task Description

Move the console's dev ports out of the 51XX range into 61XX, because 51XX is crowded on the
product owner's machine.

The underlying reason is sharper than "it's busy": **5173 is the Vite default**, so every Vite
project on the machine competes for exactly that port. Moving out of the default range is the
actual fix. `8787` has the same class of problem one tier down — it is the Cloudflare Wrangler
default.

This bit for real on 2026-08-24: a stale Vite held 5173, so a new one silently bound to 5174,
and verification ran against the new port while the stale process served **old code** from the
same working tree. See `memory-bank/tasks/client-styling.md` § Resumption Notes.

## Proposed values

| Service | Today | Proposed | Note |
|---|---|---|---|
| Vite dev client | `5173` (hardcoded) | **`6173`** | keeps the memorable `173` suffix |
| Hono backend | `8787` (env-configurable) | **`6187`** | keeps the `87` suffix; puts both in one 61XX block |

Confirmed free on this machine at authoring time: 6100, 6173, 6187.

**Decision note**: strictly, only Vite is in 51XX — moving the backend is not required by the
literal request. It is proposed because "the ports we use" reads as wanting one coherent block,
and because 8787 carries its own default-collision risk. **If only Vite should move, trim
AC-PORT-2 and leave `8787` alone** — the rest of the task is unaffected.

## Three riders, and why they belong here

These are not scope creep; each is a defect in the same few lines this task already edits.

1. **The Vite port is hardcoded** (`vite.config.ts:15`) while the backend port is
   env-configurable. That asymmetry violates the 12-Factor "no hardcoded values" rule
   `CLAUDE.md` enforces at build time. Add `YTS_CLIENT_PORT`.
2. **The backend default is duplicated.** `vite.config.ts:10` and `server/index.ts:25` each
   independently declare `?? 8787`. Change one and the proxy silently points at a port nothing
   is listening on — a genuinely nasty failure because the app loads and only `/api` breaks.
3. **Vite falls back silently on a busy port.** This is the actual root cause of the 2026-08-24
   confusion, and **renumbering does not prevent recurrence** — a second `npm run dev:client`
   on 6173 would just take 6174 and serve stale code just as happily. `strictPort: true` makes
   it fail loudly instead. Of everything in this task, this is the item that removes a real
   class of wasted debugging.

## Acceptance Criteria

#### AC-PORT-1: The client dev server binds to 6173 and the port is configurable
**Priority**: MUST
**Given** no environment overrides
**When** `npm run dev:client` starts
**Then** Vite binds to **6173**. **And** setting `YTS_CLIENT_PORT` overrides it, following the
existing `YTS_*` convention.

#### AC-PORT-2: The backend binds to 6187 by default
**Priority**: MUST *(drop this AC if only the client should move)*
**Given** no environment overrides
**When** `npm run dev:server` starts
**Then** the Hono server binds to `127.0.0.1:6187`, and `YTS_CONSOLE_PORT` still overrides it.
Localhost-only binding is unchanged.

#### AC-PORT-3: The backend default exists in exactly one place
**Priority**: MUST
**Given** the repo after this change
**When** the default backend port is grepped for
**Then** the literal appears **once**, shared by both the server and the Vite proxy target
(e.g. a small `console/ports.ts` both import — `vite.config.ts` can import TS directly).
A test or a grep-based check should make a reintroduced second literal visible.
**Why**: today's two independent `?? 8787` defaults can drift apart, and the symptom is a
loading app whose `/api` calls all fail.

#### AC-PORT-4: A busy port fails loudly instead of silently relocating
**Priority**: MUST
**Given** something already listening on the configured client port
**When** `npm run dev:client` starts
**Then** it **exits with an error** rather than binding elsewhere (`strictPort: true`).
**Why**: the silent fallback let a stale process serve old code while verification ran against
a different port. Renumbering alone does not fix this.

#### AC-DOCS-1: Live documentation matches reality
**Priority**: MUST
**Given** the change is complete
**When** the live memory-bank docs are read
**Then** every port reference is current in: `memory-bank/uat-config.md` (base URL, prose, entry
route), `memory-bank/techContext.md` (§ Infrastructure, § Environment Variables, § Development
Commands, startup-output line, workflow paragraph), `memory-bank/productBrief.md` (§ Technical
Constraints localhost-binding line), and `memory-bank/systemPatterns.md` (architecture diagram).
**And** `YTS_CLIENT_PORT` is added to techContext's env-var table.

#### AC-DOCS-2: Historical records are NOT rewritten
**Priority**: MUST
**Given** archives and completed task files reference the old ports
**When** this task is done
**Then** `memory-bank/archive/**` and the COMPLETE task files
(`conversational-season-drafting`, `season-chat-conversation-loop`, `headless-draft-writes`,
and the in-flight `client-styling` / `transcript-turn-grouping` evidence sections) are left
**untouched**.
**Why**: those record what was observed at the time, and a repo-wide find-and-replace would
falsify evidence — including AC-VERIFY-1 runbook output that cites the ports actually used.
This AC exists because a naive `sed` over the repo is the obvious wrong way to do this task.

#### AC-REGRESSION-1: No regression
**Priority**: MUST
**Given** the suite on `main`
**When** it runs after this change
**Then** all tests pass. **No test currently hard-codes a port** (verified by grep at authoring
time), so this change should require **zero test edits** — if a test needs changing, that is a
signal to re-read the diff, not to edit the test.

## Test Strategy

Little to unit-test: two of these are config literals and one is a Vite flag, none observable
from jsdom or a Node test. The meaningful checks are:

- The AC-PORT-3 single-source-of-truth assertion (a real, cheap unit test on the shared module)
- Manual: start both servers, confirm the reported ports, load
  `http://localhost:6173/seasons/season-1/chat`, confirm `/api` proxies (Draft Preview
  populating is sufficient proof)
- Manual: start a second client while the first runs; confirm it **errors** rather than taking
  6174

**What NOT to test**: that a port literal equals a number, which only restates the config.

## Implementation Roadmap

### New Source Files
- [ ] `console/ports.ts` — shared default port constants (AC-PORT-3)

### Extended Source Files
- [ ] `console/vite.config.ts` — port from `YTS_CLIENT_PORT` (default 6173), `strictPort: true`,
      proxy target from the shared constant; update the header comment's stated ports
- [ ] `console/server/index.ts` — default from the shared constant; update the header comment
- [ ] `memory-bank/uat-config.md`, `techContext.md`, `productBrief.md`, `systemPatterns.md` —
      AC-DOCS-1

### Explicitly unchanged
- `memory-bank/archive/**` and all COMPLETE task files — AC-DOCS-2
- Every `*.test.ts` / `*.test.tsx` — AC-REGRESSION-1

### Phases
- [ ] Phase 1: ports + shared constant + strictPort + live docs (single phase — a half-applied
      port change leaves the proxy pointing at the wrong service, which is worse than either
      end state)

## Execution State

**Build Status**: IDLE
**Current Phase**: PLANNED → BUILD
**Current Step**: Task authored; ready for implementation
**Phase Being Built**: N/A
**Phase Number**: 0 of 1
**Is Multi-Phase**: NO
**Last Completed**: Task authored on `task/console-dev-ports` (cut off `origin/main`)
**Can Resume**: YES
**Resume From**: Phase 1

### Active Sub-Agents
(none)

### Completed Steps
- Grepped the full repo for `5173` / `5174` / `8787`: 3 functional code sites, 4 live docs, and
  a set of archives/completed tasks that must be left alone
- Confirmed **no test references any port**, so the change should need zero test edits
- Confirmed 6100 / 6173 / 6187 are free on this machine
- Confirmed neither `strictPort` nor `YTS_CLIENT_PORT` exists today
- Identified the duplicated `?? 8787` default across `vite.config.ts` and `server/index.ts`

### Resumption Notes
**Notes**: Single phase. The highest-value item is AC-PORT-4 (`strictPort`), not the
renumbering — renumbering relocates the collision, `strictPort` makes it visible.

**Merge-conflict warning**: `feature/client-styling` (PR #6) and `feature/transcript-turn-grouping`
both add new sections to `memory-bank/techContext.md`, and this task edits it too. All three are
additive section inserts, so conflicts should be mechanical — but **land PR #6 first and rebase
this branch** rather than resolving a three-way conflict. This branch was deliberately cut off
`origin/main` (not stacked) because the port change is functionally independent of both.

**Environment note**: as of 2026-08-24 all console processes are stopped by product-owner
request; do not start a dev server for this task without clearing it first.
