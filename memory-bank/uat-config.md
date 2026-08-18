# UAT Configuration

This file is created and maintained by `/bmb:uat-init`. It carries project-specific UAT infrastructure (base URLs, persona credentials, auth strategy, viewport presets, isolation strategy).

**Companion file**: `memory-bank/projectConfig.md` `## UAT` section carries project-wide *ergonomic* defaults (default sections, artifact git policy). Keep secrets/infra here; keep ergonomics there.

---

**Status**: Configured
**Last Updated**: 2026-08-18

## Environments

| Name     | Base URL                | Default |
|----------|-------------------------|---------|
| dev      | http://localhost:5173   | yes     |

> `/bmb:uat` refuses to run against environments where `name == "prod"`. There is no override flag — production UAT must be intentionally invoked via a separate (future) command.

**No staging or remote environment exists.** YTS is a single-user local tool: the Hono
backend binds `127.0.0.1` only and has no external network exposure
(`techContext.md` § Runtime Environment). The dev URL above is the Vite client
(default port 5173), which proxies `/api` to the backend on `YTS_CONSOLE_PORT`
(default 8787).

**Both processes must be running before a UAT walk:**

```
YTS_CANON_ROOT=console/.uat-canon npm run dev:server --prefix console
npm run dev:client --prefix console
```

Entry route: `/seasons/<seasonId>/chat` — e.g. `http://localhost:5173/seasons/season-1/chat`.
Any other path redirects to `season-1` (`console/src/App.tsx:10`); there is no season
list or picker yet.

## Auth

- **Strategy**: `none`
- **Credential vault**: N/A
- **Token file pattern**: N/A
- **Login selectors**: N/A

**This app has no authentication.** There is no login UI, no session cookie, no IDP, and
no auth or CORS gate in front of any route (`console/server/index.ts`). The template's
`token` / `login` / `token+fallback` strategies all presuppose a login step that does not
exist here — recording one would fail the first UAT run at the auth stage.

If auth is ever added, revisit this section and the Persona Map together.

## Persona Map

| Role       | Test Account | Auth Reference |
|------------|--------------|----------------|
| showrunner | N/A          | N/A            |

`productBrief.md` § Key Personas is still unpopulated (every row is a `[Name]`
placeholder — see the archive follow-up for `season-chat-conversation-loop`). Until it is
filled in, UAT walks a single implicit persona: **the showrunner** — the solo operator
drafting a season. There are no roles, no RBAC surface, and therefore no cross-persona
isolation concerns.

## Viewports

| Name    | Width | Height | Default For      |
|---------|-------|--------|------------------|
| desktop | 1280  | 720    | all non-mobile   |
| mobile  | 375   | 667    | mobile section   |

`projectConfig.md` sets `default_sections: happy,mobile`, so both viewports are exercised
on a default run.

## Fixtures & Data

*Project-specific section — not in the base template. UAT mutates canon, so the write
target matters.*

- **canon_root**: `console/.uat-canon/` (gitignored)
- **seed_source**: `console/fixtures/canon/`
- **seed_command**: `rm -rf console/.uat-canon && cp -R console/fixtures/canon console/.uat-canon`

**Why a scratch copy rather than the fixtures directly.** A UAT walk writes to canon in
three places, and `console/fixtures/canon/` is tracked in git:

| Writer | Path | Tracked? |
|---|---|---|
| `season-drafting` skill | `<canonRoot>/seasons/<id>/season.draft.json` | untracked, **not** gitignored |
| `SeasonSessionManager` | `<canonRoot>/seasons/<id>/.yts-session.json` | untracked, **not** gitignored |
| `POST /approve` → `canon-commit.ts` | `<canonRoot>/seasons/<id>/season-<n>.md` **and** appends to `<canonRoot>/continuity-ledger.md` | **tracked** |

Walking the Approve path against the fixtures would therefore modify tracked files and
leave untracked artifacts behind, requiring a `git checkout` after every run. Re-seeding a
gitignored copy keeps fixtures pristine and makes runs idempotent.

**Seed before every run** — the first turn's context bundle and the `/season-drafting`
skill prefix are emitted only when no session pointer exists
(`FileSessionStore.load() === null`). A stale `.yts-session.json` silently converts a
first-turn walk into a resumed-turn walk, which tests the wrong code path.

**seasonId**: use `season-1`. It is what the fixtures contain
(`fixtures/canon/seasons/season-1/`) and what `App.tsx:10` redirects to. Note the
AC-HAPPY-4 runbook in `tasks/season-chat-conversation-loop.md:136` says `/seasons/2/chat`
and `seasons/2/` — that path does not exist in the fixtures. Treat the runbook as stale
and confirm which is correct while closing the AC-HAPPY-4 evidence gap (archive
follow-up #1).

## Execution

- **max_parallel_tabs**: 1
  - Deliberately serialized. `SeasonTurnRunner` enforces a per-season single-flight queue,
    and SSE broadcasts every turn to all connected tabs, so two walkers on the same season
    contend on the queue and observe each other's transcript — producing order-dependent,
    flaky assertions. With one fixture season there is nothing to parallelize.
- **isolation_strategy**: same-persona-only
  - One persona and no cookies, so cross-persona collision cannot occur. `auto` would
    probe for incognito and fall back to this today regardless; stating it explicitly is
    accurate rather than aspirational.
- **auth_cookies_to_clear**: (none — no auth)
- **logout_url**: (none — no auth)
- **screenshot_retention**: keep 10 most recent runs
- **default_timeout_ms**: 20000
  - Raised from the 15000 default: a first turn spawns a real headless `claude -p` process
    that loads the skill and composes a draft. That is model latency, not page latency.
- **ux_pattern_check**: enabled

## Notes

- **`ux-patterns.md` does not exist yet.** With `ux_pattern_check: enabled`, the
  `/bmb:uat` phase gate will block until it does. Run `/bmb:ux-ingest --scaffold` before
  the first walk, or pass `--skip-ux-check` for that run.
- **No journey doc exists yet** for any task — `/bmb:uat`'s phase gate requires one. This
  is the remaining blocker after `ux-patterns.md`.
- No credential vault is configured because there are no credentials. If auth is added
  later, create `.auth/`, add it to `.gitignore`, and update the Auth section and Persona
  Map together.
- `projectConfig.md` sets `artifact_git_policy: ignore`, so screenshots and GIFs stay out
  of git. Since there are no test accounts, UAT artifacts carry no account PII — but they
  may contain canon story content.
- The highest-value first walk is the **AC-HAPPY-4** path — compose → send → reply streams
  → `season.draft.json` appears → Draft Preview renders it → Approve enables. That is the
  one acceptance criterion the 89-test suite cannot prove (every test injects `spawnFn`)
  and which has no recorded manual evidence. See the archive's "AC-HAPPY-4 evidence gap".
