/**
 * Approve / reject-with-notes UI (Phase 4, AC-HAPPY-4 / AC-HAPPY-5). Polls
 * the same read-only draft endpoint DraftPreview uses (torn-read-safe via
 * DraftWatcher) purely to know whether Approve should be enabled — this
 * panel never writes the draft file itself.
 *
 * Approve POSTs to `/approve`, which commits the draft exactly as-is (no
 * regeneration) and returns the file paths written; on success we show a
 * confirmation naming them. Reject POSTs `{ notes }` to `/reject`, which
 * resumes the SAME season-drafting session server-side and streams the
 * reply into the transcript over the existing SSE channel — this panel
 * doesn't render that reply itself, it just confirms the notes were sent.
 */
import { useEffect, useState } from "react";
import type { SeasonDraft } from "../../server/draft-watcher.js";

export interface SignoffPanelProps {
  seasonId: string;
  /** Poll interval in ms — defaults to 1000ms, matching DraftPreview. */
  pollIntervalMs?: number;
  /** Injectable for tests — defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
}

interface ApproveResponse {
  seasonFile: string;
  ledgerFile: string;
}

export function SignoffPanel({ seasonId, pollIntervalMs = 1000, fetchFn = fetch }: SignoffPanelProps) {
  const [draft, setDraft] = useState<SeasonDraft | null>(null);
  const [notes, setNotes] = useState("");
  const [approveResult, setApproveResult] = useState<ApproveResponse | null>(null);
  const [rejectSubmitted, setRejectSubmitted] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Same cancellation-guard pattern as DraftPreview: avoid setState after unmount.
    let cancelled = false;

    const poll = async () => {
      const res = await fetchFn(`/api/seasons/${encodeURIComponent(seasonId)}/draft`);
      if (cancelled) return;
      if (res.status === 200) {
        const data = (await res.json()) as SeasonDraft;
        if (!cancelled) setDraft(data);
      }
      // 204 (no draft yet) or any other status: keep the last-known state (AC-ASYNC-3 mirror).
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [seasonId, pollIntervalMs, fetchFn]);

  const canApprove = (draft?.episodes.length ?? 0) >= 1 && !busy;
  const canReject = notes.trim().length > 0 && !busy;

  const handleApprove = async () => {
    setBusy(true);
    try {
      const res = await fetchFn(`/api/seasons/${encodeURIComponent(seasonId)}/approve`, { method: "POST" });
      if (res.status === 200) {
        const data = (await res.json()) as ApproveResponse;
        setApproveResult(data);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    const trimmed = notes.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    try {
      const res = await fetchFn(`/api/seasons/${encodeURIComponent(seasonId)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: trimmed }),
      });
      if (res.status === 200) {
        setRejectSubmitted(true);
        setRejectError(null);
        setNotes("");
      } else {
        // AC-ERROR-1: a crashed resumed turn (server returns non-200, e.g. 502) must
        // read as failure here — never the "Notes sent" success message, since nothing
        // will land in the transcript for a turn that never completed.
        setRejectSubmitted(false);
        setRejectError("The turn failed to complete — check the transcript or try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Signoff" data-testid="signoff-panel">
      <h3>Signoff</h3>
      <button type="button" disabled={!canApprove} onClick={() => void handleApprove()}>
        Approve
      </button>
      {approveResult && (
        <p role="status">
          Committed to {approveResult.seasonFile} and {approveResult.ledgerFile}
        </p>
      )}

      <label htmlFor="signoff-panel-notes">Notes</label>
      <textarea
        id="signoff-panel-notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="What should change?"
      />
      <button type="button" disabled={!canReject} onClick={() => void handleReject()}>
        Reject with notes
      </button>
      {rejectSubmitted && <p role="status">Notes sent — see the transcript for the response.</p>}
      {rejectError && <p role="alert">{rejectError}</p>}
    </section>
  );
}
