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
import { DraftWatcher } from "./draft-watcher.js";
import { FileSessionStore, isValidSeasonId, SeasonSessionManager } from "./season-session.js";
import { formatSseMessage, SeasonEventBus } from "./sse.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.YTS_CONSOLE_PORT ?? 8787);
const CANON_ROOT = process.env.YTS_CANON_ROOT ?? "./Canon";

export function createApp() {
  const sessionStore = new FileSessionStore(CANON_ROOT);
  const sessionManager = new SeasonSessionManager(sessionStore);
  const eventBus = new SeasonEventBus();
  // One DraftWatcher per season, created lazily on first request — mirrors
  // SeasonEventBus's per-seasonId channel map. seasonId is validated at every
  // call site below before it ever reaches this map or DraftWatcher's own
  // (also-validating) constructor.
  const draftWatchers = new Map<string, DraftWatcher>();

  const getDraftWatcher = (seasonId: string): DraftWatcher => {
    let watcher = draftWatchers.get(seasonId);
    if (!watcher) {
      watcher = new DraftWatcher({ canonRoot: CANON_ROOT, seasonId });
      draftWatchers.set(seasonId, watcher);
    }
    return watcher;
  };

  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

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
