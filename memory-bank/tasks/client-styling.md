---
slug: client-styling
legacy_id:
feature: client-styling
status: IN_PROGRESS
---

# client-styling: Client Styling

**Complexity**: Level 2
**Status**: BUILD_COMPLETE — **all ACs verified.** AC-VISUAL-1 was confirmed by the product
owner's direct observation on 2026-08-24 (see § AC-VISUAL-1 and Execution State; no screenshot
was captured — the evidence is the attestation, not a stored artifact)
**Roadmap**: client-styling
**Branch**: feature/client-styling
**Worktree**: N/A (in-repo checkout)

## Task Description

Give the console a visual shell: one hand-written stylesheet, a CSS Grid app shell, and a
small design-token set. The client currently renders entirely unstyled — see
`memory-bank/roadmap/client-styling.md` for the evidence and the approved design decisions,
which were settled with the user before planning (no `/bmb:creative` phase, per Level 2).

## Specification

**Feature Type**: End-user feature (visual/UX) — no behavioral change
**Creative Phase Required**: No — design decisions settled with the user pre-planning

### Invocation Method

- **Location**: the whole console, route `/seasons/:seasonId/chat`
- **Navigation**: run both dev servers per `memory-bank/uat-config.md` § Fixtures & Data

### Success Criteria

- **User sees**: a legible two-column console — transcript with the composer pinned beneath
  it, a framed right rail with Draft Preview, Signoff, and collapsed Diagnostics
- **User can verify at**: the client's reported port, `/seasons/season-1/chat`
- **Data persisted**: none — this task changes no behavior and writes no files at runtime

### Acceptance Criteria

#### AC-SHELL-1: The app shell is a two-column grid that fills the viewport
**Priority**: MUST
**Given** the Season Chat route rendered in a desktop browser
**When** the page loads
**Then** the transcript and composer occupy the left column, a 320px rail on the right holds
the three panels, and the shell fills the viewport height without the document itself
scrolling.

#### AC-SHELL-2: Transcript and rail scroll independently, with the composer pinned
**Priority**: MUST
**Given** a transcript long enough to overflow its column
**When** the transcript is scrolled
**Then** the composer stays fixed at the bottom of the left column and the right rail does
not move. Requires `min-height: 0` on the scroll regions — a grid item will not shrink below
its content size without it, and the symptom of omitting it is that the whole document
scrolls instead.

#### AC-SHELL-3: Long unbreakable content does not blow out the layout
**Priority**: MUST
**Given** a turn containing a long unbroken string (a tool-call argument, a long logline)
**When** it renders
**Then** the column does not expand beyond the viewport and no horizontal document scrollbar
appears. Requires `minmax(0, 1fr)` rather than `1fr` on the grid column.

#### AC-THEME-1: Dark-first palette with a light override, driven by tokens
**Priority**: MUST
**Given** the stylesheet
**When** colors are inspected
**Then** every color resolves from a CSS custom property defined on `:root`, and a
`@media (prefers-color-scheme: light)` block reassigns the same token names. `color-scheme`
is declared so native form controls and scrollbars follow the active theme.

#### AC-PANEL-1: The three panels share framing and are ordered by usage
**Priority**: MUST
**Given** the right rail
**When** it renders
**Then** Draft Preview appears first, Signoff second, and Diagnostics third and collapsed
into a `<details>`; all three share a common `.panel` base class rather than repeating
framing rules.

#### AC-PANEL-2: The context-usage alert is never hidden behind a disclosure
**Priority**: MUST
**Given** context usage above the warning threshold
**When** Diagnostics is collapsed
**Then** the `role="alert"` element is still rendered outside the `<details>` and remains in
the accessibility tree. A warning that requires expanding a panel to discover is not a
warning, and `getByRole("alert")` excludes elements hidden from the a11y tree.

#### AC-REGRESSION-1: No behavioral regression
**Priority**: MUST
**Given** the 105 tests across 14 files passing on `main`
**When** the suite is run after these changes
**Then** all 105 pass **unmodified** — no test edited, none added, none skipped — proving the
markup changes are inert. `npm run typecheck` and `npm run build:client` stay clean.

**No new tests, by design.** CSS is not behavior. Asserting on class names would lock in
styling decisions and make future restyling expensive — exactly the coupling this suite has
correctly avoided (zero of its 105 tests touch `className`). AC-VISUAL-1 below carries the
part a suite cannot prove.

#### AC-VISUAL-1: It actually looks right in a real browser
**Priority**: MUST
**Given** both dev servers running against a seeded scratch canon
**When** `/seasons/season-1/chat` is opened in a real browser with a draft present
**Then** the shell, panel framing, transcript role distinction, and pinned composer render as
designed, evidenced by a screenshot recorded in Execution State.

**Manual verification, by design — MUST NOT be claimed from a green suite.** jsdom applies no
layout and computes no CSS, so *no* test in this suite can observe a grid, a scroll region, or
a color. This is the same class of boundary-crossing AC that `headless-draft-writes` learned
to carve out explicitly (`_learned/testing-patterns.md`), and styling is the purest instance
of it: the entire deliverable is invisible to the test runner.

## Test Strategy

### Approach
No TDD cycle applies — there is no behavior to drive out. The suite's role here is purely as a
**regression tripwire**: it must stay green and unmodified, proving the added `className`
attributes and the `<details>` wrapper changed nothing observable.

### What NOT to Test
- Class names, grid properties, colors, spacing — jsdom computes none of it, and asserting on
  it would couple the suite to styling decisions
- The `prefers-color-scheme` light branch — not observable in jsdom

### Risk watched during implementation
Wrapping Diagnostics' detail content in `<details>` is the one markup change with any test
exposure. Its tests use only `toBeInTheDocument` / `textContent` (safe — `<details>` keeps
content in the DOM when closed), but `getByRole("alert")` is visibility-aware, which is why
AC-PANEL-2 keeps the alert outside the collapsed region. Precedent that this works:
`TranscriptTurn` already ships a closed `<details>` whose test asserts
`not.toHaveAttribute("open")` and passes.

## Implementation Roadmap

### New Source Files
- [ ] `console/src/styles.css` — tokens, reset, app shell, transcript, composer, panels

### Extended Source Files
- [ ] `console/src/main.tsx` — `import "./styles.css"`
- [ ] `console/src/components/DraftPreview.tsx` — `panel draft-preview` + element classes
- [ ] `console/src/components/SignoffPanel.tsx` — `panel signoff-panel` + element classes
- [ ] `console/src/components/DiagnosticsPanel.tsx` — classes; `<details>` around the detail
      breakdown, alert left outside
- [ ] `memory-bank/techContext.md` — record the styling approach and token convention

### Unchanged, deliberately
- `console/src/pages/SeasonChat.tsx` — all 7 class names already exist
- `console/src/components/TranscriptTurn.tsx` — all 5 already exist
- `console/src/App.tsx` — routes only; the shell lives on `.season-chat`
- every `*.test.tsx` — see AC-REGRESSION-1

### Phases
- [ ] Phase 1: Stylesheet + shell + panel classes (single phase — one cohesive visual change;
      splitting tokens from layout would leave an intermediate state that is neither
      verifiable nor useful)

## Creative Phases
- [x] None required — design decisions settled with the user before planning (Level 2)

## Execution State

**Build Status**: IDLE
**Current Phase**: BUILD COMPLETE → REFLECT/ARCHIVE
**Current Step**: Phase 1 implemented and verified; **AC-VISUAL-1 CONFIRMED 2026-08-24** — all
ACs now closed
**Phase Being Built**: N/A — single phase complete
**Phase Number**: 1 of 1 (complete)
**Is Multi-Phase**: NO
**Last Completed**: AC-VISUAL-1 confirmation by the product owner (2026-08-24)
**Can Resume**: NO — no implementation work remains and no open ACs.
**Resume From**: N/A — next is `/bmb:reflect client-styling` then `/bmb:archive client-styling`

### AC-VISUAL-1 Confirmation (2026-08-24)

The product owner opened the running console and confirmed AC-VISUAL-1. Conditions at the time
of the look:

- Both dev servers running from this checkout: Vite on `6173`, Hono on `127.0.0.1:6187`
  (the new 61XX ports from `console-dev-ports`, which had merged to `main` as `ceb6a12`)
- Working tree at `main` post-merge, so the stylesheet under observation is exactly what
  shipped in PR #6

**Evidence form**: direct attestation by the product owner — the intended verifier named in the
original AC ("awaiting the user's own look"). **No screenshot was captured**, so the AC's
literal evidence clause ("evidenced by a screenshot recorded in Execution State") is satisfied
by observation rather than by a stored artifact. Recorded this way deliberately rather than
claiming a screenshot exists.

### Active Sub-Agents
(none)

### Completed Steps
- Direct inspection confirmed the finding: no `.css` file under `console/`, no styling
  dependency, no stylesheet link in `index.html`
- Established that the suite is class-name-agnostic (0 of 105 tests touch `className`), so
  restyling is test-safe
- Found the half-finished BEM convention in `SeasonChat.tsx` (7 classes) and
  `TranscriptTurn.tsx` (5), and chose to finish it rather than replace it
- Four styling approaches presented with trade-offs; user selected plain CSS + tokens
- Three app-shell layouts presented; user selected sidebar with the draft promoted and
  Diagnostics collapsed
- Verified the `<details>` test risk against `DiagnosticsPanel.test.tsx` and the existing
  `TranscriptTurn` `<details>` precedent before committing to the approach

### Phase 1 (2026-08-23)

Implemented: `console/src/styles.css` (new, 39 token declarations, ~470 lines);
`main.tsx` stylesheet import; `panel` + block classes on `DraftPreview`, `SignoffPanel`,
`DiagnosticsPanel`; `season-chat-empty` on SeasonChat's no-season guard; Diagnostics' detail
groups wrapped in a `<details>` with the `role="alert"` warning deliberately left outside it.
`SeasonChat.tsx` and `TranscriptTurn.tsx` needed no class changes — their 12 class names
already existed and the stylesheet was written to them.

**Automated verification (AC-REGRESSION-1): PASS.**
- 105/105 tests across 14 files, **no test file modified, none added, none skipped**
- `npm run typecheck` clean; `npm run build:client` clean
- The build now emits `dist/assets/index-*.css 8.56 kB (gzip 2.07 kB)` where previously **no
  CSS asset existed at all** — independent confirmation the stylesheet is actually bundled
  rather than merely present on disk

### AC-VISUAL-1 — structurally verified in a real browser; visual judgment still open

Chromium at 1440×900 via Playwright MCP, against `console/.uat-canon` (which still holds the
two-episode draft from the `headless-draft-writes` AC-VERIFY-1 run), Vite on 5174.

**Measured from the live page — every structural AC confirmed by computed style/geometry:**

| AC | Evidence |
|---|---|
| AC-SHELL-1 | `.season-chat` computed `display: grid`, `grid-template-columns: 1120px 320px`, height 900px = full viewport. Rail measured at x=1120, w=320 |
| AC-SHELL-2 | transcript `overflow-y: auto`, `min-height: 0px`; transcript occupies y 0→776, composer sits at y=776 directly beneath it; **`document.scrollHeight === clientHeight`** — the document does not scroll, so the composer is genuinely pinned |
| AC-SHELL-3 | `document.scrollWidth === clientWidth` — no horizontal document overflow, with two long loglines rendered |
| AC-THEME-1 | CSSOM: base `:root` = 27 dark tokens (`--bg: #14151a`) + `color-scheme: dark`; `@media (prefers-color-scheme: light)` reassigns 12 (`--bg: #f7f7f9`) + `color-scheme: light`. Chromium defaulted to light, and computed `body` background was `rgb(247,247,249)` — proving the override branch resolves, not just parses |
| AC-PANEL-1 | `.draft-preview` className `panel draft-preview`; `<details>` present and **closed** by default |
| AC-PANEL-2 | warning element renders as a sibling outside the `<details>`, and its test (`getByRole("alert")`) passes |
| — | Draft renders: 2 `.draft-preview__episode`, 4 thread chips. Approve `disabled === false`. Console: **0 errors**, 2 warnings (both react-router v7 future-flag notices, pre-existing and unrelated) |

**What is NOT proven, and must not be claimed:** that it *looks good*. Computed geometry
proves the grid resolves to the intended shape; it says nothing about whether the spacing,
weight, and palette actually read well — that is a judgment only a human eye makes. Recorded
as open rather than inferred, per `_learned/testing-patterns.md` and the AC-VERIFY-1 precedent
in `headless-draft-writes`.

**No screenshot was captured.** Four attempts across two mitigations all hit the MCP tool's
5s ceiling at `waiting for element to be stable` / after `fonts loaded`. Freezing the
DraftPreview 1s poll (page-side `clearInterval` sweep) did not help, which points at the SSE
`EventSource` — a never-closing HTTP response means the page never reaches the
network-quiescent state the screenshot path waits on. Not a styling defect and not worth
contorting app code to work around; noted so the next person does not re-derive it.
**A future UAT run on this client should expect the same, and reach for computed-style
assertions rather than screenshots.**

### Resumption Notes
**Notes**: No implementation work remains. Next step is the user opening
`http://localhost:5174/seasons/season-1/chat` (or a fresh `npm run dev:client`) and saying
whether the look is right. Adjusting token values afterward is a pure `styles.css` edit — no
markup, no tests. If the look is approved, this goes straight to `/bmb:reflect` →
`/bmb:archive`.

**Stale processes noted during this build** (not started by this task, left alone): a server
from the 2026-08-22 walk still holds port 8787 (PID 29713 at the time) and an old Vite still
holds 5173, which is why this run's Vite bound to 5174. Worth killing by PID before the next
UAT run to avoid verifying against stale code.
