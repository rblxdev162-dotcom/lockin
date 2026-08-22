import { useMemo } from 'react';
import { useApp } from '../../../store/context';
import { selectWeeklySummary } from '../../../lib/parent/selectors';
import { Icon } from '../../ui/Icon';

/**
 * Student-visible description of the PIN-gated dashboard.
 *
 * This is intentionally outside Parent View: a rule should never bind a
 * student while hiding what the person setting that rule can inspect. It shows
 * categories and the student's own headline numbers, but exposes no new data —
 * every fact is already visible elsewhere in Student View.
 */
export function ParentTransparencyPreview() {
  const { state, now } = useApp();
  const summary = useMemo(
    () => selectWeeklySummary(state, new Date(now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.assignments, state.completedSessions, state.focusRuns, state.activity, Math.floor(now / 60_000)],
  );

  return (
    <details className="mt-4 rounded-2xl border lk-border p-3.5">
      <summary className="cursor-pointer text-sm font-bold lk-strong">
        Preview what Parent View can see
      </summary>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Completed', value: summary.assignmentsCompleted },
            { label: 'Focused', value: `${summary.focusMinutes}m` },
            { label: 'Overrides', value: summary.parentOverrides },
          ].map((item) => (
            <div key={item.label} className="lk-sunken rounded-xl border lk-border p-2.5 text-center">
              <p className="text-lg font-extrabold lk-strong">{item.value}</p>
              <p className="text-[0.68rem] font-semibold lk-muted">{item.label} this week</p>
            </div>
          ))}
        </div>

        <div>
          <p className="text-caption font-extrabold tracking-wide lk-muted uppercase">It can see</p>
          <ul className="mt-1.5 space-y-1.5 text-sm lk-strong">
            {[
              'Assignments, exams, due dates, completion state, and the current study plan.',
              'Whether a completion was reported by Canvas or marked manually.',
              'Focus sessions, Focus Mode outcomes, temporary unlocks, overrides, and emergency exits.',
              'Per-domain blocked-attempt counts recorded during Focus Mode.',
              'The parent-control rules currently configured on this device.',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Icon name="check" size={14} className="mt-0.5 shrink-0 text-mint-500" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border lk-border p-3 text-caption lk-muted">
          <p className="font-bold lk-strong">It cannot see</p>
          <p className="mt-1">
            Full browsing history, page contents, screenshots, messages, keystrokes, location, or
            activity from another device. LockIn does not collect those things.
          </p>
        </div>
      </div>
    </details>
  );
}
