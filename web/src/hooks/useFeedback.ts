/**
 * Choosing and remembering positive feedback.
 *
 * The history lives in its own `localStorage` key rather than in `AppState`.
 * Two reasons, and the second is the load-bearing one:
 *
 *  - it is presentation state, not school data — nobody exports "when did
 *    LockIn last say well done";
 *  - `lib/export.ts` is an allowlist, so a field added to `AppState` is a
 *    field somebody has to decide about. Keeping this out of the state means
 *    there is nothing to decide.
 *
 * It is deliberately not synced across tabs. Two open tabs showing the same
 * encouragement is not a problem worth a BroadcastChannel.
 */
import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../store/context';
import { usePace } from './usePace';
import { chooseFeedback } from '../lib/feedback';
import type { Feedback, FeedbackHistory } from '../lib/feedback';

const KEY = 'lockin.feedback.v1';

function readHistory(): FeedbackHistory {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    // Rebuilt rather than trusted, like everything else read back from
    // storage: a corrupted value must not become a timestamp in the future
    // that silences a line forever.
    const out: FeedbackHistory = {};
    for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        (out as Record<string, number>)[kind] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function useFeedback(): { feedback: Feedback | null; dismiss: () => void } {
  const { state, now } = useApp();
  const { report } = usePace();
  const [history, setHistory] = useState<FeedbackHistory>(readHistory);

  // Recomputed on the hour rather than the second: nothing here changes
  // minute to minute, and a per-second recompute would re-render the whole
  // dashboard for a sentence that has not moved.
  const hour = Math.floor(now / 3_600_000);

  const feedback = useMemo(
    () => chooseFeedback({ state, report, now: hour * 3_600_000, history }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.assignments, report.status, hour, history],
  );

  const dismiss = useCallback(() => {
    if (!feedback) return;
    const next = { ...history, [feedback.kind]: Date.now() };
    setHistory(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* a full or blocked storage is not worth breaking the page over */
    }
  }, [feedback, history]);

  return { feedback, dismiss };
}
