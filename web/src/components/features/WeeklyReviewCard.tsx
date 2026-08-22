import { useMemo } from 'react';
import { useApp } from '../../store/context';
import { buildStudentWeeklyReview } from '../../lib/studentReview';
import { Card, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';

export function WeeklyReviewCard() {
  const { state, now } = useApp();
  const review = useMemo(
    () => buildStudentWeeklyReview(state, new Date(now)),
    // The display is weekly; a minute-granularity refresh is more than enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.assignments, state.completedSessions, state.focusRuns, state.activity, Math.floor(now / 60_000)],
  );

  const calibration =
    review.estimateDeltaPercent === null
      ? 'More focus time is needed before estimates can be calibrated.'
      : review.estimateDeltaPercent === 0
        ? 'Finished sessions matched their planned time.'
        : `Finished sessions ran ${Math.abs(review.estimateDeltaPercent)}% ${
            review.estimateDeltaPercent > 0 ? 'longer' : 'shorter'
          } than planned.`;

  return (
    <Card>
      <CardHeader
        title="Your last seven days"
        subtitle="A factual review from this device — no score, streak, or comparison with anyone else."
        action={<Badge tone="neutral">Local only</Badge>}
      />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Work completed', value: review.completed },
          { label: 'Minutes focused', value: review.focusMinutes },
          { label: 'Focus sessions', value: review.focusSessions },
          { label: 'Blocked attempts', value: review.blockedAttempts },
        ].map((item) => (
          <div key={item.label} className="lk-sunken rounded-2xl border lk-border p-3.5">
            <dd className="text-2xl font-extrabold lk-strong">{item.value}</dd>
            <dt className="mt-0.5 text-caption font-semibold lk-muted">{item.label}</dt>
          </div>
        ))}
      </dl>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border lk-border p-3.5">
          <p className="text-caption font-extrabold tracking-wide lk-muted uppercase">Estimate check</p>
          <p className="mt-1 text-sm lk-strong">{calibration}</p>
          {review.estimateDeltaPercent !== null && (
            <p className="mt-1 text-caption lk-muted">
              {review.plannedSessionMinutes}m planned · {review.actualSessionMinutes}m used
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-brand-500/30 bg-brand-500/5 p-3.5">
          <p className="text-caption font-extrabold tracking-wide text-brand-700 uppercase dark:text-brand-300">
            One adjustment
          </p>
          <p className="mt-1 text-sm lk-strong">{review.suggestion}</p>
        </div>
      </div>
    </Card>
  );
}
