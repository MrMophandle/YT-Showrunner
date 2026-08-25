---
version: next
status: completed
priority: medium
complexity: 2
linked_tasks: [client-styling]
created: 2026-08-23
completed: 2026-08-24
---

# Client Styling

Give the console a visual shell. The client currently renders **entirely unstyled** — there
is no `.css` file anywhere in `console/`, no styling dependency in `package.json`, and no
stylesheet link in `index.html`. Every surface is raw browser default: the transcript,
composer, and all three side panels stack in one undifferentiated vertical column.

## Evidence

Recorded during the `headless-draft-writes` AC-VERIFY-1 live walk (2026-08-22), verbatim from
that task file:

> **Observation, out of scope**: the client renders entirely unstyled (no CSS applied) and
> the page logs 1 console error. No AC covers styling and this task changed no client code,
> so it is recorded here as a finding for a future task rather than chased.

Confirmed by direct inspection on 2026-08-23:

- No `.css` file exists under `console/`
- `package.json` has zero styling dependencies (no tailwind, postcss, or CSS-in-JS)
- `console/index.html` `<head>` contains only charset, viewport, and title

## Starting position (better than it sounds)

Three properties of the existing client make this cheap, and they shaped the approach:

1. **A half-finished BEM convention already exists.** `SeasonChat.tsx` carries 7 semantic
   class names (`season-chat__transcript`, `season-chat__composer`, `season-chat__panels`,
   …) and `TranscriptTurn.tsx` carries 5 (including a `transcript-turn--${role}` modifier).
   Someone began a plain-CSS approach and never wrote the stylesheet. `DraftPreview`,
   `SignoffPanel`, `DiagnosticsPanel`, and `App` have none.
2. **Restyling is test-safe.** Zero tests in the suite assert on `className` — all 105 hook
   onto `role`, `aria-label`, and `data-testid`. This is a deliberate property worth
   preserving, not an accident to exploit once.
3. **The markup is already semantic and accessible** — `<section aria-label>`, `role="alert"`,
   `<label htmlFor>`, `<details>`, `<header>`. Good raw material; the styling can lean on
   element semantics rather than fighting div soup.

## Approved design decisions

- **Plain hand-written CSS, one stylesheet, zero new dependencies.** Vite handles
  `import "./styles.css"` natively, so no build config changes. Considered and rejected:
  Tailwind (adds a build stack and would discard the existing BEM classes across every
  file), a classless drop-in stylesheet (cheap, but gives no control over the app shell,
  which is the actual problem), and a component library (Radix/shadcn — more machinery than
  four panels on a localhost single-user tool justifies today).
- **Continue the existing BEM convention** rather than replacing it, plus one shared `.panel`
  base class so the three panels don't repeat framing rules.
- **CSS Grid app shell, two columns**: transcript scrolling in the left column with the
  composer pinned beneath it, and a 320px right rail spanning all rows.
- **Right rail ordered by actual usage**, not by DOM convenience: Draft Preview tall at the
  top (watched continuously as the draft builds), Signoff below it (used once), Diagnostics
  collapsed into a `<details>` (checked rarely). The context-usage **alert stays outside**
  the collapsed region — both because a warning you must expand to see is a bad warning, and
  because `getByRole("alert")` excludes elements hidden from the accessibility tree.
- **Dark-first palette with a `prefers-color-scheme: light` override** reassigning the same
  token names. No settings-driven theme toggle. `color-scheme` is set so native form controls
  and scrollbars follow the theme instead of staying light.
- **No new tests.** CSS is not behavior, and asserting on class names would lock in styling
  decisions and make future restyling expensive — precisely the coupling this suite has
  correctly avoided. Verification is the existing 105 staying green (proving the markup
  changes are inert) plus a real browser look.

**Complexity rationale**: Level 2 — a contained enhancement adding one new file and class
attributes to four existing components. No new architecture, no new dependency, no new
component, no server change, and no behavioral change. Elevated above trivial only because
it establishes a convention (tokens + shell) that later UI work will build on.

## Scope boundaries

**Out of scope**: component library, Tailwind, animation and transitions, a settings-driven
theme toggle, responsive/mobile breakpoints (`productBrief.md` § Constraints records the tool
as desktop-bound, localhost-only), season-management UI, and the deferred `react-router` 7.x
bump.

**Also out of scope, and still open**: the 1 console error the live walk observed. It is a
separate finding with a separate cause; styling will not address it and this feature does not
claim to.
