/**
 * Keeping Edgenuity progress current without anyone clicking anything.
 *
 * The extension reports readings as they happen, because a content script sits
 * inside the page. The bridge cannot — it is a local service that has to *ask*
 * Chrome — so something has to do the asking on a timer. That is this hook.
 *
 * ## Why the interval is minutes and not seconds
 *
 * Course progress moves a few times an hour at best; a student finishing an
 * activity every thirty seconds is not the case worth optimising. Each poll
 * spawns a process and talks to Chrome, so the cost is real and the benefit of
 * going faster is zero. Five minutes keeps "how behind am I" honest without
 * turning the Mac into a polling loop.
 *
 * ## Why it does not stop when the tab is hidden
 *
 * That is the whole point. This runs while the student is working in another
 * window — that *is* the hidden case. Chrome throttles background timers to
 * roughly once a minute, which is far finer than the interval here, so the
 * throttle never actually bites.
 *
 * ## What it will not do
 *
 * It never opens Edgenuity, never navigates, never clicks. If no course page
 * is open there is nothing to read, and the honest answer is "no Edgenuity tab
 * open" rather than a request LockIn made on the student's behalf.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../store/context';
import { bridgeRead, bridgeStatus } from '../lib/edgenuity/nativeBridge';
import type { BridgeProblem, BridgeStatus } from '../lib/edgenuity/nativeBridge';
import { isBrowserSource } from '../lib/edgenuity/browserVerification';

const POLL_INTERVAL_MS = 5 * 60_000;
/** A first read shortly after load, so the UI is not blank for five minutes. */
const FIRST_POLL_DELAY_MS = 4_000;

export interface BridgeState {
  status: BridgeStatus | null;
  lastReadAt: string | null;
  lastProblem: BridgeProblem | null;
  coursesSeen: number;
  checking: boolean;
}

export function useEdgenuityBridge(): BridgeState & {
  checkNow: () => Promise<void>;
  refreshStatus: () => Promise<void>;
} {
  const { state, dispatch } = useApp();
  const enabled = state.settings.edgenuityBridgeEnabled === true;

  /**
   * Whether any assignment is actually waiting on a reading.
   *
   * Polling Chrome for a course nothing is tracking would be work nobody asked
   * for. Turning the feature on is consent to read *for a purpose*, not a
   * standing instruction to watch.
   */
  const hasWork = state.assignments.some(
    (a) => a.edgenuity && isBrowserSource(a.edgenuity.config) && a.status !== 'Completed',
  );

  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [lastProblem, setLastProblem] = useState<BridgeProblem | null>(null);
  const [coursesSeen, setCoursesSeen] = useState(0);
  const [checking, setChecking] = useState(false);

  // Kept in a ref so the polling effect never re-subscribes when state changes.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const refreshStatus = useCallback(async () => {
    setStatus(await bridgeStatus());
  }, []);

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const result = await bridgeRead();
      setLastProblem(result.ok ? null : (result.problem ?? 'unknown'));
      setCoursesSeen(result.courses.length);
      if (result.courses.length > 0) {
        setLastReadAt(new Date().toISOString());
        for (const reading of result.courses) {
          dispatchRef.current({ type: 'EDGENUITY_BROWSER_READING', reading });
        }
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setLastProblem(null);
      return;
    }
    void refreshStatus();
  }, [enabled, refreshStatus]);

  useEffect(() => {
    if (!enabled || !hasWork) return;

    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await checkNow();
    };

    const first = window.setTimeout(run, FIRST_POLL_DELAY_MS);
    const interval = window.setInterval(run, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [enabled, hasWork, checkNow]);

  return { status, lastReadAt, lastProblem, coursesSeen, checking, checkNow, refreshStatus };
}
