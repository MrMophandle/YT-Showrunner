# Archive: client-styling — Client Styling (give the console a visual shell)

## Metadata
- Task: `client-styling`
- Complexity: Level 2
- Completed: 2026-08-24
- Branch: `feature/client-styling`
- Roadmap feature: `client-styling` (`memory-bank/roadmap/client-styling.md`)
- Reflection: `memory-bank/reflection/client-styling-reflection.md`
- Code merged: PR #6 — `a75c393`, merged to `main` as `d92bfa0` on 2026-08-23

## Summary

The console rendered **entirely unstyled** — no `.css` file anywhere under `console/`, no styling
dependency, no stylesheet link. This task gave it a hand-written, zero-dependency CSS system:
39 design tokens, a dark-first palette with a `prefers-color-scheme: light` override, a
two-column CSS Grid app shell, and a shared `.panel` framing class across the three rail panels.

It finished the half-started BEM convention already present in `SeasonChat.tsx` and
`TranscriptTurn.tsx` rather than replacing it, and touched four component files plus one new
stylesheet — 1,019 lines across 10 files, one commit, one phase. Design decisions were settled
with the user before planning, so no `/bmb:creative` phase ran (correct for Level 2).

## Solution

- **`console/src/styles.css`** (new, 15,625 b) — tokens, reset, app shell, transcript, composer,
  panels. Its own header comment states the conventions before anyone extends it.
- **`console/src/main.tsx`** — single `import "./styles.css"` (line 5). Vite handles CSS
  natively, so there is no PostCSS/Tailwind build config to maintain.
- **`DraftPreview.tsx` / `SignoffPanel.tsx` / `DiagnosticsPanel.tsx`** — `panel` base class plus
  per-block element classes (8 / 3 / 5 `className` occurrences).
- **`DiagnosticsPanel.tsx`** — detail breakdown wrapped in `<details>`, with the context-usage
  alert deliberately left **outside** the disclosure.
- **`memory-bank/techContext.md`** § Styling Conventions — the load-bearing rules recorded as
  project convention.

### Files Changed

| File | Change |
|---|---|
| `console/src/styles.css` | **New** — 39 tokens, dark-first palette + light override, grid shell, panel framing |
| `console/src/main.tsx` | `import "./styles.css"` |
| `console/src/components/DraftPreview.tsx` | `panel draft-preview` + element classes |
| `console/src/components/SignoffPanel.tsx` | `panel signoff-panel` + element classes |
| `console/src/components/DiagnosticsPanel.tsx` | classes; `<details>` disclosure, alert outside it |
| `memory-bank/techContext.md` | § Styling Conventions + styling entry in the stack list |

### Deliberately unchanged
- `console/src/pages/SeasonChat.tsx` (all 7 class names already existed),
  `console/src/components/TranscriptTurn.tsx` (all 5 already existed), `console/src/App.tsx`
  (routes only — the shell lives on `.season-chat`)
- **Every `*.test.tsx`** — see AC-REGRESSION-1 below

## Verification Status — all 7 ACs met

| AC | Verified | Evidence |
|---|---|---|
| AC-SHELL-1 — two-column grid fills the viewport | Yes | Grid dimensions re-checked against the merged tree |
| AC-SHELL-2 — transcript and rail scroll independently, composer pinned | Yes | `min-height: 0` on both scroll regions |
| AC-SHELL-3 — long unbreakable content does not blow out the layout | Yes | `minmax(0, 1fr)` on the shell column |
| AC-THEME-1 — dark-first palette with light override, token-driven | Yes | 39 tokens on `:root`; `prefers-color-scheme: light` reassigns the same names |
| AC-PANEL-1 — three panels share framing, ordered by usage | Yes | shared `.panel` base class |
| AC-PANEL-2 — context-usage alert never hidden behind a disclosure | Yes | `DiagnosticsPanel.tsx:161-180` — alert sits outside `<details>` |
| AC-REGRESSION-1 — no behavioral regression | Yes | 107/107 passing, suite **unmodified** |
| AC-VISUAL-1 — it actually looks right in a real browser | Yes | Product owner's direct observation, 2026-08-24 — **attestation, not a screenshot** (see below) |

### AC-VISUAL-1 — the evidence caveat

The AC asked for "a screenshot recorded in Execution State." **No screenshot was captured.** The
build could not produce one, and the AC sat open from build completion (2026-08-23) through the
merge until the product owner — the verifier the AC itself named ("awaiting the user's own
look") — confirmed by direct observation on 2026-08-24.

Recorded as an attestation rather than claiming an artifact that does not exist. The confirmation
was made against the post-merge tree at `ceb6a12`, with the dev servers on the 61XX ports from
`console-dev-ports`.

### Why no test could cover the deliverable

jsdom applies no layout and computes no CSS, so **no test in this suite can observe a grid, a
scroll region, or a color**. The suite's role here was purely a regression tripwire: stay green
and unmodified, proving the added `className` attributes and the `<details>` wrapper changed
nothing observable. **Zero of the 107 tests assert on a class name**, deliberately — that is what
keeps restyling cheap.

This reuses the manual-verification carve-out that `headless-draft-writes` established
(`_learned/testing-patterns.md`), verbatim down to the phrasing: *"Manual verification, by
design — MUST NOT be claimed from a green suite."*

## Quality Gates

- Tests: **107/107 passing**, 15 files, suite **unmodified** (up from 105 at build time because
  `console-dev-ports` landed in between)
- Code review: passed at build time
- Roadmap checkboxes: reconciled against the merged tree during `/bmb:reflect` — see below

## Notes

### The three load-bearing CSS rules

`techContext.md` § Styling Conventions records these as project convention rather than leaving
them as commit-message trivia — each is a correctness rule, not a style preference:

1. **`minmax(0, 1fr)`, never bare `1fr`,** on the shell's grid column. A bare `1fr` will not
   shrink below its content's min-content width, so one long unbroken string (a tool-call
   argument, a long logline) pushes the column past the viewport and gives the document a
   horizontal scrollbar.
2. **`min-height: 0` on any grid item that scrolls.** Without it the region never scrolls — the
   whole document does, and the pinned composer drifts off-screen.
3. **Never put `role="alert"` inside a collapsed `<details>`.** `getByRole` and real assistive
   tech exclude elements hidden from the accessibility tree, so a buried alert is both
   untestable and useless.

### Two process defects this task exposed

Both are recorded in the reflection and consolidated into `_learned/process-hygiene.md`:

1. **Code merged a day ahead of its bookkeeping.** PR #6 landed on 2026-08-23 while the task file
   stayed `IN_PROGRESS`, the roadmap feature stayed `in_progress`, no reflection existed, and no
   archive entry existed. Banyan records completion by the archive entry on the metadata branch,
   not by the merge — so shipped code sat behind formally-open completion records. AC-VISUAL-1
   was also still open at merge time.
2. **Every roadmap checkbox was left unticked by the build** — all six file items and Phase 1 —
   despite each item shipping. `/bmb:reflect`'s Step 1 gate requires all phases `[x]`, so this
   came within one gate check of hard-blocking the task's own reflection. The boxes were
   reconciled against the merged tree before reflect proceeded (`styles.css` present,
   `main.tsx:5` imports it, `className` counts 8/3/5, `DiagnosticsPanel.tsx:161-180`,
   `techContext.md:195`), with a dated correction note in the task file.

### Log coverage

No `.agent-logs/claude/by-task/client-styling/` directory exists, so build-session metrics are
unavailable — the same log-indexing gap `console-dev-ports` hit.

## Learnings Extracted

Consolidated into `memory-bank/agent-rules/_learned/process-hygiene.md` (amended, not a new
file — the rules index explicitly recommends folding into the existing always-on rules rather
than adding a third `**/*` file). `evidence_count` 1 → 2:

1. **Tick roadmap checkboxes at phase-completion time**, not as a later correction — downstream
   phase gates read the boxes, not the Execution State narrative.
2. **Do not let code merge while a MUST acceptance criterion is open** — check AC closure before
   opening or approving the merge PR.

Also reinforced: `_learned/testing-patterns.md`'s manual-verification carve-out was reused by a
second task, which is exactly the reuse signal the `evidence_count` mechanism exists to detect.
