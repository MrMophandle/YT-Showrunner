---
name: Config Management (learned)
globs: ["**/*.config.ts", "**/*.config.js", "**/server/**"]
paths: ["console/"]
topics: ["config", "defaults", "12-factor", "dev-server"]
priority: low
auto_generated: true
derived_from: [console-dev-ports]
evidence_count: 1
last_validated: 2026-08-24
---

# Config Management (learned)

- When two or more files independently default the same environment-configurable value
  (`process.env.X ?? <literal>` repeated), extract the literal into one shared constant
  module that every consumer imports. A drifted duplicate default fails *silently* — the
  app starts, and only the dependent feature breaks — which is a strictly worse failure
  mode than a startup error.
  <!-- evidence: console-dev-ports — `console/vite.config.ts:10` and
       `console/server/index.ts:25` each independently declared `?? 8787`. Changing one
       would have left the Vite proxy pointing at a port nothing listens on: the console
       loads normally and every `/api` call fails. Fixed by `console/ports.ts` exporting
       `DEFAULT_CONSOLE_PORT`, imported by both; `console/ports.test.ts` asserts both
       consumers resolve to the same constant, so a reintroduced second literal is a test
       failure rather than a runtime mystery. Vite can import a `.ts` module directly. -->
- Set the fail-fast option on any dev server whose default collision behavior is to
  silently rebind to the next free port (`strictPort: true` in Vite, equivalents
  elsewhere). A stale process holding the port while a new one quietly takes the next is
  worse than an immediate error, because verification then passes against the wrong
  process — and renumbering the port does not remove this class of bug, only the flag does.
  <!-- evidence: console-dev-ports exists because on 2026-08-24 a stale Vite held 5173, a
       new one bound 5174, and verification ran against the new port while the stale
       process served OLD CODE from the same working tree. The task correctly separated the
       cosmetic fix (renumbering out of the crowded 51XX default range) from the real one
       (`strictPort: true`); a second `npm run dev:client` on the new 6173 would otherwise
       take 6174 and serve stale code just as happily. NOTE: this flag was never exercised
       against a real collision — see the archive's unverified-AC list. -->

See also: [[integration-wiring]], [[empirical-verification]]
