# Archive: console-dev-ports — Move Console Dev Ports to 61XX

## Metadata
- Task: `console-dev-ports`
- Complexity: Level 1
- Completed: 2026-08-24
- Branch: `task/console-dev-ports`
- Roadmap feature: none (Level 1 — config/docs hygiene, no product capability added)
- Reflection: `memory-bank/reflection/console-dev-ports-reflection.md`

## Summary

Moved the console's dev ports out of their tools' default ranges: the Vite dev client from
`5173` → `6173` and the Hono backend from `8787` → `6187`. The stated reason was that 51XX is
crowded on the product owner's machine; the sharper reason is that **5173 is the Vite default**,
so every Vite project on the machine competes for exactly that port (`8787` is the Cloudflare
Wrangler default, the same problem one tier down).

Three riders shipped alongside, each a defect in the same few lines the port change already
touched — not scope creep:

1. The Vite port was **hardcoded** while the backend port was env-configurable — a 12-Factor
   violation. Fixed by adding `YTS_CLIENT_PORT`.
2. The backend default was **duplicated** as `?? 8787` in two files that could drift apart.
   Fixed by a single shared constant.
3. Vite **silently rebinds** to the next free port on collision. Fixed by `strictPort: true`.

Rider 3 is the one that matters most: the task exists because on 2026-08-24 a stale Vite held
5173, a new one silently bound 5174, and verification ran against the new port while the stale
process served **old code** from the same working tree. Renumbering does not prevent that
recurring — a second client on 6173 would take 6174 just as happily. Only the flag does.

## Solution

- **`console/ports.ts`** (new) — single source of truth exporting `DEFAULT_CONSOLE_PORT` (6187),
  imported by both the server and the Vite proxy config. Vite imports the `.ts` module directly.
- **`console/vite.config.ts`** — client port from `YTS_CLIENT_PORT` (default 6173),
  `strictPort: true`, proxy target derived from the shared constant.
- **`console/server/index.ts`** — default port from the shared constant; `YTS_CONSOLE_PORT`
  still overrides; localhost-only binding unchanged.
- **`console/ports.test.ts`** (new) — asserts both the server and the Vite proxy resolve to the
  same constant, so a reintroduced second literal becomes a test failure.
- **Four live docs** updated for the new ports (`uat-config.md`, `techContext.md`,
  `productBrief.md`, `systemPatterns.md`), with `YTS_CLIENT_PORT` added to the env-var table.

## Files Changed

| File | Change |
|---|---|
| `console/ports.ts` | **New** — `DEFAULT_CONSOLE_PORT = 6187`, the single source of truth |
| `console/ports.test.ts` | **New** — single-source-of-truth assertion (the only test added) |
| `console/vite.config.ts` | `YTS_CLIENT_PORT` (default 6173), `strictPort: true`, proxy target from the shared constant |
| `console/server/index.ts` | Default port from the shared constant; header comment updated |
| `console/vitest.config.ts` | Added `*.test.ts` to `include` so the new root-level test is discovered |
| `memory-bank/uat-config.md` | Base URL, prose, entry route → 6173 |
| `memory-bank/techContext.md` | Infrastructure, env-var table (+ `YTS_CLIENT_PORT`), dev commands, startup-output line |
| `memory-bank/productBrief.md` | Technical Constraints localhost-binding line |
| `memory-bank/systemPatterns.md` | Architecture diagram ports |

## Verification Status — read this before trusting the ports

All 7 ACs are **implemented**; 5 are **verified**, 2 are **not**. The gap is disclosed, not
silent: the task's own Test Strategy predicted it, and no dev server was ever started because
all console processes were stopped by product-owner request. Build verification used
`vite build`, not `vite dev`.

| AC | Implemented | Verified | Evidence |
|---|---|---|---|
| AC-PORT-1 — client 6173, `YTS_CLIENT_PORT` | Yes | **Partial** | Export confirmed by code review; binding never observed live |
| AC-PORT-2 — backend 6187, `YTS_CONSOLE_PORT` | Yes | Yes | `console/ports.test.ts` |
| AC-PORT-3 — single source of truth | Yes | Yes | `console/ports.test.ts` — the one AC with a real regression guard |
| AC-PORT-4 — `strictPort: true` fails loudly | Yes | **No** | Flag present in config; **no collision was ever triggered** |
| AC-DOCS-1 — four live docs current | Yes | Yes | Diff-verified + code-review spot-check |
| AC-DOCS-2 — historical records untouched | Yes | Yes | Diff shows zero touches to `archive/**` or COMPLETE task files |
| AC-REGRESSION-1 — zero test edits, suite green | Yes | Yes | Exactly one new test file; 107/107 |

**AC-PORT-4 is the task's own highest-value item** ("the item that removes a real class of
wasted debugging") and it is the one with zero runtime evidence — only static confirmation that
the flag is present. A typo, or a Vite version whose `strictPort` default behavior differs,
would pass everything in this build.

**Two manual checks remain open** (from the Test Strategy):
1. Start both servers, load `http://localhost:6173/seasons/season-1/chat`, confirm `/api`
   proxies (Draft Preview populating is sufficient proof).
2. Start a second client while the first runs; confirm it **errors** rather than taking 6174.

## Quality Gates

- Tests: **107/107 passing**, 15 files — re-run after the rebase, not just at build time
- Build: PASS · Typecheck: PASS · Lint: not configured (n/a)
- Code review: **APPROVED** — 0 blocking / 0 recommended / 0 optional
- Security review: PASS (no user input; localhost-only binding preserved)
- Test edits to existing files: **zero**, as AC-REGRESSION-1 required

## Notes

**AC-DOCS-2 is the AC worth remembering.** It explicitly forbade rewriting
`memory-bank/archive/**` and COMPLETE task files, because a repo-wide `sed` for `5173`/`8787`
would falsify evidence — including runbook output citing the ports actually used at the time.
The reflection recommends generalizing this into a named convention rather than re-deriving it
per task: any task doing a repo-wide literal replacement should exclude historical records by
default, unless correcting the record *is* the task.

**Rebase history.** The branch was cut before PR #6 (`feature/client-styling`) landed; both
edited `memory-bank/techContext.md`. During `/bmb:reflect` the branch was rebased onto
`origin/main` @ `d92bfa0` — `merge-tree` predicted no conflict, the rebase was clean, and the
suite was re-run afterward. `feature/transcript-turn-grouping` also touches that file and had
not landed as of this archive.

**Process note.** `/bmb:build` was invoked three times for this single-phase task. The 2nd and
3rd found nothing to build; the 3rd dispatched a full orchestrator (~78k tokens) to reach the
identical BUILD_COMPLETE verdict the 2nd reached for near-zero cost. Logged in the reflection as
the top ecosystem finding. Separately, no `by-task/console-dev-ports/` session logs exist, so
none of the three build sessions are recoverable for analysis.

## Learnings Extracted

Consolidated into `memory-bank/agent-rules/_learned/config-management.md` (new file, additive —
no existing rule was merged, retired, or pruned):

1. **Duplicated env-configurable defaults** across files must collapse to one shared constant —
   a drifted duplicate fails silently rather than loudly.
2. **Dev servers that silently rebind on collision** need their fail-fast flag set; renumbering
   the port does not remove that class of bug.
