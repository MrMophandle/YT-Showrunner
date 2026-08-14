/**
 * Server-Sent Events broadcast for the Season Chat transcript.
 *
 * One-directional (server -> browser) per the design doc; user messages and
 * signoff actions travel back as plain HTTP POSTs, not over this channel.
 *
 * The headless `claude -p` process's lifecycle is NOT tied to any subscriber's
 * connection (AC-ASYNC-1): season-session.ts publishes events here regardless
 * of whether a browser is currently listening. Each season keeps an in-memory
 * buffer of the CURRENT turn's events so a late/reconnecting subscriber can
 * catch up from where the turn started, rather than missing everything emitted
 * before it connected. Full reconnect-replay semantics (persisting across turn
 * boundaries) are refined in Phase 3 — this buffer only needs to make that
 * refinement possible, not implement it in full here.
 */

export interface SeasonStreamEvent {
  /** Monotonically increasing within a season's current-turn buffer. */
  seq: number;
  /** Normalized event payload — a turn, a delta, an error, etc. Shape owned by callers. */
  payload: unknown;
}

type Listener = (event: SeasonStreamEvent) => void;

interface SeasonChannel {
  buffer: SeasonStreamEvent[];
  nextSeq: number;
  listeners: Set<Listener>;
}

/**
 * In-memory pub/sub keyed by seasonId. One channel per season; a season's
 * buffer is cleared when a new turn starts (via `startTurn`) so the buffer
 * only ever holds the events of the turn currently in flight (or just
 * completed), keeping memory bounded.
 */
export class SeasonEventBus {
  private channels = new Map<string, SeasonChannel>();

  private getOrCreate(seasonId: string): SeasonChannel {
    let channel = this.channels.get(seasonId);
    if (!channel) {
      channel = { buffer: [], nextSeq: 0, listeners: new Set() };
      this.channels.set(seasonId, channel);
    }
    return channel;
  }

  /** Clears the current-turn buffer for a season — call when a new turn begins. */
  startTurn(seasonId: string): void {
    const channel = this.getOrCreate(seasonId);
    channel.buffer = [];
    channel.nextSeq = 0;
  }

  /** Publishes an event for a season to all live subscribers and appends it to the replay buffer. */
  publish(seasonId: string, payload: unknown): SeasonStreamEvent {
    const channel = this.getOrCreate(seasonId);
    const event: SeasonStreamEvent = { seq: channel.nextSeq++, payload };
    channel.buffer.push(event);
    for (const listener of channel.listeners) {
      listener(event);
    }
    return event;
  }

  /**
   * Subscribes to a season's events. Returns the buffered events the caller
   * missed (from `sinceSeq` exclusive, or the whole current-turn buffer if
   * omitted) plus an unsubscribe function. New events are delivered via `onEvent`.
   */
  subscribe(
    seasonId: string,
    onEvent: Listener,
    sinceSeq?: number,
  ): { missed: SeasonStreamEvent[]; unsubscribe: () => void } {
    const channel = this.getOrCreate(seasonId);
    const missed = channel.buffer.filter((e) => sinceSeq === undefined || e.seq > sinceSeq);
    channel.listeners.add(onEvent);
    return {
      missed,
      unsubscribe: () => {
        channel.listeners.delete(onEvent);
      },
    };
  }
}

/** Formats one SSE wire message (`data: <json>\n\n`) for a SeasonStreamEvent. */
export function formatSseMessage(event: SeasonStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
