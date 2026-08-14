/**
 * YT-Showrunner console server entry point.
 *
 * Hono app wiring together the season-session manager (headless `claude -p`
 * spawn/resume), the stream-json parser, and the SSE broadcast bus. Binds to
 * localhost only — this is a single-user local tool (see the task's NFR
 * implications: no accessibility/i18n/uptime targets, but the server must not
 * expose an external interface).
 *
 * Route/port choices here are Phase 1 proposals per the task spec (MEDIUM
 * confidence), not inherited conventions: Hono on port 8787, client (a later
 * phase's Vite dev server) proxying `/api` to it.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { commitDraftToCanon } from "./canon-commit.js";
import { DraftWatcher } from "./draft-watcher.js";
import { FileSessionStore, isValidSeasonId, SeasonSessionManager, type SpawnFn } from "./season-session.js";
import { formatSseMessage, SeasonEventBus } from "./sse.js";
import { readStatuslineSnapshot } from "./statusline-probe.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.YTS_CONSOLE_PORT ?? 8787);
const CANON_ROOT = process.env.YTS_CANON_ROOT ?? "./Canon";

export interface CreateAppOptions {
  /** Overrides the module-level CANON_ROOT — used by tests to point at an isolated tmp dir. */
  canonRoot?: string;
  /** Injected into SeasonSessionManager — used by tests to fake the headless `claude` process. */
  spawnFn?: SpawnFn;
}

export function createApp(options: CreateAppOptions = {}) {
  const canonRoot = options.canonRoot ?? CANON_ROOT;
  const sessionStore = new FileSessionStore(canonRoot);
  const sessionManager = new SeasonSessionManager(sessionStore, options.spawnFn);
  const eventBus = new SeasonEventBus();
  // One DraftWatcher per season, created lazily on first request — mirrors
  // SeasonEventBus's per-seasonId channel map. seasonId is validated at every
  // call site below before it ever reaches this map or DraftWatcher's own
  // (also-validating) constructor.
  const draftWatchers = new Map<string, DraftWatcher>();

  const getDraftWatcher = (seasonId: string): DraftWatcher => {
    let watcher = draftWatchers.get(seasonId);
    if (!watcher) {
      watcher = new DraftWatcher({ canonRoot, seasonId });
      draftWatchers.set(seasonId, watcher);
    }
    return watcher;
  };

  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  /**
   * Best-effort plan-usage snapshot for the Diagnostics panel (AC-ERROR-6).
   * Account-wide, not per-season — no seasonId param, unlike the routes
   * below. Always 200s with a discriminated `status` field (fresh / stale /
   * unavailable); the probe itself never throws, so this route has no error
   * branch of its own to fabricate a value on.
   */
  app.get("/api/statusline", async (c) => {
    const result = await readStatuslineSnapshot();
    return c.json(result, 200);
  });

  /**
   * SSE endpoint (server -> browser only, per the design doc). A subscriber
   * connecting mid-turn receives the buffered events from the current turn
   * (AC-ASYNC-1) followed by anything published afterward. Disconnecting a
   * browser tab does NOT affect the underlying headless process — it keeps
   * running server-side and publishing to the bus regardless of subscribers.
   */
  app.get("/api/seasons/:seasonId/events", (c) => {
    const seasonId = c.req.param("seasonId");
    // seasonId is an unvalidated HTTP route param and this server has no
    // auth/CORS gate — reject anything path-traversal-shaped before it
    // reaches FileSessionStore's filesystem path construction or
    // SeasonEventBus's channel keying, rather than a 500 crash or silent
    // pass-through.
    if (!isValidSeasonId(seasonId)) {
      return c.json({ error: "Invalid seasonId" }, 400);
    }
    const sinceParam = c.req.query("since");
    const sinceSeq = sinceParam !== undefined ? Number(sinceParam) : undefined;

    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (event: { seq: number; payload: unknown }) => {
            controller.enqueue(encoder.encode(formatSseMessage(event)));
          };

          const { missed, unsubscribe } = eventBus.subscribe(seasonId, send, sinceSeq);
          for (const event of missed) {
            send(event);
          }

          c.req.raw.signal.addEventListener("abort", () => {
            unsubscribe();
            controller.close();
          });
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      },
    );
  });

  /**
   * Read-only draft snapshot for the Draft Preview panel (AC-HAPPY-3,
   * AC-ASYNC-3). Backed by DraftWatcher, which never returns a torn/partial
   * read — a poll here is always either the last-good complete draft or
   * "none yet". 204 (not 404) for "no draft yet" — a season with no draft is
   * a valid, expected state (AC-ENTRY-1), not a missing resource.
   */
  app.get("/api/seasons/:seasonId/draft", async (c) => {
    const seasonId = c.req.param("seasonId");
    if (!isValidSeasonId(seasonId)) {
      return c.json({ error: "Invalid seasonId" }, 400);
    }

    const watcher = getDraftWatcher(seasonId);
    await watcher.pollOnce();
    const draft = watcher.getLastGood();

    if (!draft) {
      return c.body(null, 204);
    }
    return c.json(draft);
  });

  /**
   * Approves the season's current last-good draft (AC-HAPPY-4): commits it
   * to canon exactly as-is — no regeneration, no second model call — and
   * returns the paths written. 400 (not a crash) when there's nothing to
   * approve yet, since "no draft" and "empty draft" are both valid,
   * expected pre-approval states.
   */
  app.post("/api/seasons/:seasonId/approve", async (c) => {
    const seasonId = c.req.param("seasonId");
    if (!isValidSeasonId(seasonId)) {
      return c.json({ error: "Invalid seasonId" }, 400);
    }

    const watcher = getDraftWatcher(seasonId);
    await watcher.pollOnce();
    const draft = watcher.getLastGood();

    if (!draft || draft.episodes.length === 0) {
      return c.json({ error: "No draft to approve" }, 400);
    }

    const result = await commitDraftToCanon({ canonRoot, seasonId, draft });
    return c.json(result, 200);
  });

  /**
   * Rejects the current draft with notes (AC-HAPPY-5): no canon file is
   * ever written on this path. The notes are sent as the NEXT message in
   * the SAME resumed session (SeasonSessionManager re-reads the persisted
   * session id itself), and the reply streams into the same SSE channel
   * the transcript already subscribes to — `startTurn` clears the
   * current-turn buffer exactly as a composer-sent message would.
   */
  app.post("/api/seasons/:seasonId/reject", async (c) => {
    const seasonId = c.req.param("seasonId");
    if (!isValidSeasonId(seasonId)) {
      return c.json({ error: "Invalid seasonId" }, 400);
    }

    let body: { notes?: unknown };
    try {
      body = (await c.req.json()) as { notes?: unknown };
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length === 0) {
      return c.json({ error: "notes is required" }, 400);
    }

    eventBus.startTurn(seasonId);
    const result = await sessionManager.sendMessage(seasonId, notes, {
      onEvent: (event) => eventBus.publish(seasonId, event),
    });

    // AC-ERROR-1: a crashed resumed turn (non-zero exit, dead process, or a stream that
    // closed without a terminal `result` event — see RunTurnResult.crashed) must never
    // read as success to the caller. The transcript stream already carries whatever
    // partial events arrived via eventBus.publish above; only the HTTP response shape
    // changes here. stderr is intentionally omitted from the body (can be arbitrarily
    // large / noisy) — exitCode plus a short message is enough for the client to show
    // a clear error and point the user at the transcript.
    if (result.crashed) {
      return c.json(
        { error: "The resumed turn crashed before completing", crashed: true, exitCode: result.exitCode },
        502,
      );
    }

    return c.json({ crashed: false, exitCode: result.exitCode, sessionId: result.sessionId }, 200);
  });

  return { app, sessionManager, eventBus, draftWatchers };
}

/* c8 ignore start -- process entry point, exercised via manual `npm run dev:server`, not unit tests */
if (process.env.NODE_ENV !== "test" && import.meta.url === `file://${process.argv[1]}`) {
  const { app } = createApp();
  serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
    // eslint-disable-next-line no-console -- startup banner, not a request-path log (observability rules apply to the request path)
    console.log(`YTS console server listening on http://${HOST}:${info.port} (localhost only)`);
  });
}
/* c8 ignore stop */
