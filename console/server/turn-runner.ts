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
import { isValidSeasonId, type RunTurnResult, type SeasonSessionManager, type SessionStore } from "./season-session.js";
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

/**
 * Result of `submitAwait()` — unlike `submit()`, the "resolved" branch carries
 * the actual `RunTurnResult` of THIS call's own turn (crashed or not), for
 * callers (the `/reject` route) that need to preserve a synchronous
 * success/failure HTTP response when nothing was already in flight. When a
 * turn IS already in flight, the message is queued exactly as `submit()`
 * would queue it — the caller cannot get a synchronous outcome for a queued
 * message (its turn hasn't run yet), so this mirrors `submit()`'s "queued"
 * shape rather than awaiting the eventual drained result.
 */
export type SubmitAwaitResult =
  | { status: "resolved"; result: RunTurnResult }
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

  /**
   * Same single-flight/queue semantics as `submit()`, but for callers that
   * need a synchronous outcome for THEIR OWN message when nothing was
   * already in flight (the `/reject` route's historical contract — a
   * resumed turn's crash/success must be reflected in that same HTTP
   * response). If a turn IS already in flight, this queues exactly like
   * `submit()` — there is no synchronous outcome to hand back for a message
   * that hasn't run yet.
   */
  async submitAwait(seasonId: string, userMessage: string): Promise<SubmitAwaitResult> {
    if (!isValidSeasonId(seasonId)) {
      throw new Error(`Invalid seasonId: ${JSON.stringify(seasonId)}`);
    }

    const state = this.getOrCreateState(seasonId);

    if (state.inFlight) {
      state.queue.push(userMessage);
      return { status: "queued", queuePosition: state.queue.length };
    }

    state.inFlight = true;
    const result = await this.runSingleTurn(seasonId, userMessage);
    // Drain the next queued message (fire-and-forget) or discard the queue
    // on crash — same post-turn handling `runTurn` applies for `submit()` —
    // WITHOUT blocking this call's return on that follow-on work.
    this.handleTurnOutcome(seasonId, result);
    return { status: "resolved", result };
  }

  /** Composes the prompt (first-turn bundle+skill vs. resumed bare message), publishes the synthetic echo, and runs exactly one turn — no crash/queue handling. */
  private async runSingleTurn(seasonId: string, userMessage: string): Promise<RunTurnResult> {
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
      prompt = buildTurnPrompt({
        hasExistingSession: true,
        contextBundleText: "",
        userMessage,
        canonRoot: this.canonRoot,
        seasonId,
      });
    } else {
      const bundle = await assembleContextBundle(this.canonRoot, seasonId);
      const contextBundleText = renderContextBundle(bundle);
      prompt = buildTurnPrompt({
        hasExistingSession: false,
        contextBundleText,
        userMessage,
        canonRoot: this.canonRoot,
        seasonId,
      });
    }

    return this.sessionManager.sendMessage(seasonId, prompt, {
      onEvent: (rawEvent) => this.eventBus.publish(seasonId, rawEvent),
    });
  }

  /** On crash: discards the queue and publishes `yts_error`. Otherwise: drains the next queued message (fire-and-forget) or clears `inFlight`. */
  private handleTurnOutcome(seasonId: string, result: RunTurnResult): void {
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
      void this.runTurn(seasonId, next);
    } else {
      state.inFlight = false;
    }
  }

  /** Runs one turn to completion, then either drains the next queued message or discards the queue on crash. Fire-and-forget — callers do not await this. */
  private async runTurn(seasonId: string, userMessage: string): Promise<void> {
    const result = await this.runSingleTurn(seasonId, userMessage);
    this.handleTurnOutcome(seasonId, result);
  }
}
