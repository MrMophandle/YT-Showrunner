/**
 * Diagnostics panel — context usage (real, computed from stream-json `usage`
 * blocks) and best-effort plan usage (statusLine probe snapshot).
 *
 * Context usage: NormalizedTurn.usage carries the same four fields
 * `.agent-logs/claude_telemetry.py`'s USAGE_KEYS sums (input_tokens,
 * cache_read_input_tokens, cache_creation_input_tokens, output_tokens).
 * Each turn's usage block reflects the FULL context sent/received for that
 * turn's request (not an incremental delta), so "current context usage" is
 * the sum of those four fields on the MOST RECENT turn that carries a usage
 * block — not a running total across every turn, which would over-count
 * (AC-HAPPY-6: "updating each turn", not "growing every turn").
 *
 * Plan usage: polls the server's `/api/statusline` route (backed by
 * statusline-probe.ts), mirroring DraftPreview.tsx's polling pattern. Renders
 * fresh/stale/unavailable exactly as the probe reports it — AC-ERROR-6
 * requires an explicit "unavailable" + reason, never 0%/blank, and a stale
 * snapshot's as-of time; this state is independent of, and never blocks,
 * context-usage rendering.
 */
import { useEffect, useState } from "react";
import type { NormalizedTurn } from "../../server/stream-parser.js";

/**
 * Model context-window size in tokens, used only for the AC-ERROR-5 warning
 * threshold. NEW convention established by this task (no prior constant
 * exists in this codebase) — 200,000 tokens matches Claude's standard
 * context window at the time of writing. Not per-model (NormalizedTurn
 * carries no model identifier), so this is a single global approximation;
 * revisit if per-model context windows become relevant.
 */
export const CONTEXT_WINDOW_TOKENS = 200_000;

/** Warning fires once usage crosses this fraction of CONTEXT_WINDOW_TOKENS — chosen to give a clear margin before the hard wall (AC-ERROR-5). */
export const CONTEXT_WARNING_THRESHOLD_RATIO = 0.8;

export interface ContextUsage {
  totalTokens: number;
  turnIndex: number;
}

/**
 * Sums the four usage fields on the most recent turn carrying a usage block.
 * Each turn's usage reflects the FULL context sent/received for that request
 * (not an incremental delta), so "current context usage" is the most-recent
 * complete measurement, not a running total (AC-HAPPY-6). Returns null if no
 * turn has carried a usage block yet (e.g., before the first turn completes).
 */
export function computeContextUsage(turns: NormalizedTurn[]): ContextUsage | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const usage = turns[i]?.usage;
    if (!usage) continue;
    const totalTokens =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.output_tokens ?? 0);
    return { totalTokens, turnIndex: i };
  }
  return null;
}

/**
 * Discriminated union mirroring the server's StatuslineProbeResult.
 * - "loading": initial state before first poll completes
 * - "fresh" | "stale": snapshot received with age and optional percent-used fields
 * - "unavailable": read failed (no_snapshot, unreadable, etc.); render explicit message, never fabricate
 */
type PlanUsageState =
  | { status: "loading" }
  | ({ status: "fresh" | "stale" } & { asOf: string; fiveHourPercentUsed?: number; sevenDayPercentUsed?: number; resetsAt?: string })
  | { status: "unavailable"; reason: string };

export interface DiagnosticsPanelProps {
  turns: NormalizedTurn[];
  /** Poll interval in ms — defaults to 5000ms; plan usage changes far slower than draft content, no need to match DraftPreview's 1000ms. */
  pollIntervalMs?: number;
  /** Injectable for tests — defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}

function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

function PlanUsageDisplay({ state }: { state: PlanUsageState }) {
  if (state.status === "loading") {
    return <p>Checking plan usage…</p>;
  }
  if (state.status === "unavailable") {
    return (
      <p data-testid="plan-usage-unavailable">
        Plan usage unavailable ({state.reason === "no_snapshot" ? "no snapshot yet" : "snapshot unreadable"}).
      </p>
    );
  }
  const parts: string[] = [];
  if (state.fiveHourPercentUsed !== undefined) parts.push(`5h: ${state.fiveHourPercentUsed}%`);
  if (state.sevenDayPercentUsed !== undefined) parts.push(`7d: ${state.sevenDayPercentUsed}%`);
  return (
    <p data-testid="plan-usage-value">
      {parts.length > 0 ? parts.join(" · ") : "Plan usage snapshot present, no percentages reported"}
      {state.status === "stale" && ` (stale — as of ${state.asOf})`}
    </p>
  );
}

export function DiagnosticsPanel({ turns, pollIntervalMs = 5000, fetchFn = fetch }: DiagnosticsPanelProps) {
  const [planUsage, setPlanUsage] = useState<PlanUsageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetchFn("/api/statusline");
        if (cancelled) return;
        if (res.status === 200) {
          const data = (await res.json()) as PlanUsageState;
          if (!cancelled) setPlanUsage(data);
        } else {
          if (!cancelled) setPlanUsage({ status: "unavailable", reason: "unreadable" });
        }
      } catch {
        if (!cancelled) setPlanUsage({ status: "unavailable", reason: "unreadable" });
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollIntervalMs, fetchFn]);

  const contextUsage = computeContextUsage(turns);
  const warningCrossed =
    contextUsage !== null && contextUsage.totalTokens / CONTEXT_WINDOW_TOKENS >= CONTEXT_WARNING_THRESHOLD_RATIO;

  return (
    <section aria-label="Diagnostics" data-testid="diagnostics-panel">
      <h3>Diagnostics</h3>

      <div data-testid="context-usage">
        <h4>Context usage</h4>
        {contextUsage === null ? (
          <p>No usage data yet.</p>
        ) : (
          <p>
            {formatTokens(contextUsage.totalTokens)} / {formatTokens(CONTEXT_WINDOW_TOKENS)} tokens (
            {Math.round((contextUsage.totalTokens / CONTEXT_WINDOW_TOKENS) * 100)}%)
          </p>
        )}
        {warningCrossed && (
          <p role="alert">Context usage is nearing the conversation's limit — consider wrapping up soon.</p>
        )}
      </div>

      <div data-testid="plan-usage">
        <h4>Plan usage</h4>
        <PlanUsageDisplay state={planUsage} />
      </div>
    </section>
  );
}
