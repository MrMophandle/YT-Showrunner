/**
 * Owns the per-season turn queue and prompt composition shared by the
 * `/message` and `/reject` routes (Phase 2). A "turn" is one full round trip
 * through `SeasonSessionManager.sendMessage` (which itself spawns one
 * headless `claude -p` process — Headless-Spawn-Per-Turn). This module is
 * the single place that decides:
 *
 *  - whether a submitted message is the season's FIRST turn (context bundle
 *    + skill prefix) or a resumed turn (bare user message) — see
 *    `buildTurnPrompt` in `./context-bundle.ts`;
 *  - the per-season FIFO queue + single-flight guarantee: at most one
 *    headless process runs per season at a time (AC-HAPPY-3 / crash-safety);
 *  - the synthetic "user" echo published to the event bus so the UI shows
 *    the user's own message immediately, even for a slow/streaming turn;
 *  - the crash-discards-queue policy: a crashed turn discards every message
 *    still queued behind it rather than silently draining them into a
 *    process that may be in a bad state (Graceful-Degradation-Over-Fabrication;
 *    Stream-JSON/No-Silent-Failures).
 *
 * `SeasonTurnRunner` is a caller of `SeasonSessionManager` and
 * `SeasonEventBus` only — it never modifies either class.
 */

import {
  assembleContextBundle,
  buildTurnPrompt,
  renderContextBundle,
} from "./context-bundle.js";
import { isValidSeasonId, type SeasonSessionManager, type SessionStore } from "./season-session.js";
import type { SeasonEventBus } from "./sse.js";

export interface SeasonTurnRunnerOptions {
  /** Spawns headless turns and persists the resumed session id. Not modified by this class. */
  sessionManager: SeasonSessionManager;
  /**
   * Same store the `sessionManager` was constructed with. Read directly here
   * (never written) to answer the first-turn question — `load(seasonId) ===
   * null` — synchronously ahead of composing the prompt, per the design
   * doc's "first turn must be context-seeded" decision.
   */
  store: SessionStore;
  eventBus: SeasonEventBus;
  /** Canon root passed through to `assembleContextBundle` on first turns. */
  canonRoot: string;
}

/** Result of `submit()` — describes what happened to THIS call's message, not the eventual turn outcome (which arrives over the event bus). */
export type SubmitResult =
  | { status: "started" }
  | { status: "queued"; queuePosition: number };

interface SeasonQueueState {
  /** True while a headless turn is currently running for this season. */
  inFlight: boolean;
  /** FIFO of raw user messages waiting behind the in-flight turn. */
  queue: string[];
}

/** Shape of the synthetic echo published right after `startTurn()`, before the turn resolves. */
interface SyntheticUserEvent {
  type: "user";
  message: { role: "user"; content: string };
}

/** Shape of the event published when a turn crashes; carries every message discarded from the queue, in FIFO order. */
interface YtsErrorEvent {
  type: "yts_error";
  error: string;
  crashed: true;
  exitCode: number | null;
  discardedMessages: string[];
}

export class SeasonTurnRunner {
  private readonly sessionManager: SeasonSessionManager;
  private readonly store: SessionStore;
  private readonly eventBus: SeasonEventBus;
  private readonly canonRoot: string;
  private readonly states = new Map<string, SeasonQueueState>();

  constructor(options: SeasonTurnRunnerOptions) {
    this.sessionManager = options.sessionManager;
    this.store = options.store;
    this.eventBus = options.eventBus;
    this.canonRoot = options.canonRoot;
  }

  private getOrCreateState(seasonId: string): SeasonQueueState {
    let state = this.states.get(seasonId);
    if (!state) {
      state = { inFlight: false, queue: [] };
      this.states.set(seasonId, state);
    }
    return state;
  }

  /**
   * Submits a user message for a season's drafting conversation. If no turn
   * is currently in flight for this season, the turn starts immediately
   * (`{status: "started"}`) — this method returns as soon as the turn has
   * been kicked off, WITHOUT waiting for it to resolve; the turn's own
   * events (including the synthetic echo) arrive over the `eventBus`. If a
   * turn IS already in flight for this season, the message is enqueued and
   * this returns its 1-based position (`{status: "queued", queuePosition}`)
   * — this never spawns a second headless process for the same season while
   * one is running (single-flight guarantee).
   */
  async submit(seasonId: string, userMessage: string): Promise<SubmitResult> {
    if (!isValidSeasonId(seasonId)) {
      throw new Error(`Invalid seasonId: ${JSON.stringify(seasonId)}`);
    }

    const state = this.getOrCreateState(seasonId);

    if (state.inFlight) {
      state.queue.push(userMessage);
      return { status: "queued", queuePosition: state.queue.length };
    }

    // Mark in-flight synchronously (before any await) so a second submit()
    // call arriving before this one's internal awaits resolve still sees
    // inFlight === true and queues instead of racing a second spawn.
    state.inFlight = true;
    void this.runTurn(seasonId, userMessage);
    return { status: "started" };
  }

  /** Runs one turn to completion, then either drains the next queued message or discards the queue on crash. */
  private async runTurn(seasonId: string, userMessage: string): Promise<void> {
    this.eventBus.startTurn(seasonId);

    const echo: SyntheticUserEvent = {
      type: "user",
      message: { role: "user", content: userMessage },
    };
    this.eventBus.publish(seasonId, echo);

    const existing = await this.store.load(seasonId);
    const hasExistingSession = existing !== null;

    let prompt: string;
    if (hasExistingSession) {
      prompt = buildTurnPrompt({ hasExistingSession: true, contextBundleText: "", userMessage });
    } else {
      const bundle = await assembleContextBundle(this.canonRoot, seasonId);
      const contextBundleText = renderContextBundle(bundle);
      prompt = buildTurnPrompt({ hasExistingSession: false, contextBundleText, userMessage });
    }

    const result = await this.sessionManager.sendMessage(seasonId, prompt, {
      onEvent: (rawEvent) => this.eventBus.publish(seasonId, rawEvent),
    });

    const state = this.getOrCreateState(seasonId);

    if (result.crashed) {
      const discardedMessages = [...state.queue];
      state.queue = [];
      state.inFlight = false;

      const errorEvent: YtsErrorEvent = {
        type: "yts_error",
        error: result.stderr.trim().length > 0 ? result.stderr : "Turn crashed",
        crashed: true,
        exitCode: result.exitCode,
        discardedMessages,
      };
      this.eventBus.publish(seasonId, errorEvent);
      return;
    }

    const next = state.queue.shift();
    if (next !== undefined) {
      await this.runTurn(seasonId, next);
    } else {
      state.inFlight = false;
    }
  }
}
