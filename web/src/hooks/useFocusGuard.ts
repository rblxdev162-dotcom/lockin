/**
 * Wires the Page Visibility API to Focus Guard.
 *
 * Only listens while Focus Mode is running and the setting is on. Outside a
 * session there is nothing to attribute a trip away to, and watching tab
 * switches during ordinary use would be exactly the ambient monitoring LockIn
 * refuses to do — so the listener is genuinely not attached, rather than
 * attached and ignored.
 *
 * The logic itself lives in `lib/focusGuard.ts`, pure and tested.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/context';
import { AWAY_GRACE_MS, applyVisibility, tally } from '../lib/focusGuard';
import type { AwayPeriod, FocusGuardTally } from '../lib/focusGuard';

export interface FocusGuardView extends FocusGuardTally {
  /** False when the setting is off, or Focus Mode isn't running. */
  watching: boolean;
}

export function useFocusGuard(): FocusGuardView {
  const { state, dispatch, now } = useApp();
  const active = state.focusMode.active && state.settings.focusGuard;

  /**
   * The authoritative list lives in a ref, and React state only mirrors it for
   * rendering.
   *
   * The obvious version — folding the new period inside a `setPeriods`
   * updater and dispatching from in there — double-counted every trip in
   * development, because StrictMode deliberately invokes state updaters twice
   * to surface exactly this: an updater that is not pure. The event handler is
   * the right place for a side effect; a render-phase updater never is.
   */
  const periodsRef = useRef<AwayPeriod[]>([]);
  const [periods, setPeriods] = useState<AwayPeriod[]>([]);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      periodsRef.current = [];
      setPeriods([]);
      return;
    }

    const onChange = () => {
      const visible = document.visibilityState === 'visible';
      const next = applyVisibility(periodsRef.current, visible, Date.now());
      if (next === periodsRef.current) return;
      periodsRef.current = next;
      setPeriods(next);

      // A period that just closed is reported once, as a finished trip. The
      // store never holds an open period, so a tab closed mid-trip simply
      // never reports it rather than leaving a timer running forever.
      const closed = next[next.length - 1];
      if (visible && closed?.returnedAt !== undefined) {
        const ms = closed.returnedAt - closed.leftAt;
        if (ms >= AWAY_GRACE_MS) dispatchRef.current({ type: 'FOCUS_GUARD_AWAY', ms });
      }
    };

    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [active]);

  return { ...tally(periods, now), watching: active };
}
