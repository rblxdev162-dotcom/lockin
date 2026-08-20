/**
 * The Pace Engine, memoised for React.
 *
 * `now` ticks every second in the store, so calling `computePace` in a render
 * body would re-run the whole engine sixty times a minute and re-render every
 * consumer with a new object. It is recomputed on the inputs that can actually
 * change the answer, plus a coarse clock — the minute, not the second, because
 * no pace verdict turns on a second.
 */
import { useMemo } from 'react';
import { useApp } from '../store/context';
import { computePace } from '../lib/pace/engine';
import type { PaceReport } from '../types/pace';

/** Rounded down to the minute, so the memo key changes 60× less often. */
function minuteOf(now: number): number {
  return Math.floor(now / 60_000);
}

export function usePace(): { report: PaceReport; now: number } {
  const { state, now } = useApp();
  const minute = minuteOf(now);

  const report = useMemo(
    () => computePace({ state, now: minute * 60_000 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.assignments, minute],
  );


  return { report, now };
}
