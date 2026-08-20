/**
 * Progress — the page that answers "how am I actually doing?"
 *
 * ## What it refuses to do
 *
 * No trend line is drawn from two data points, and no gap between readings is
 * interpolated. A chart implies a shape, and a shape drawn through invented
 * points is a claim LockIn cannot support. Where there is not enough history,
 * this page says so and shows the numbers it does have.
 *
 * Everything here comes from the Pace Engine and the source model. Nothing on
 * this page computes a status of its own.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/context';
import { usePace } from '../hooks/usePace';
import { Card } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/Progress';
import { Metric, PaceBadge, SectionHeader, STATUS_CLASS } from '../components/ui/Status';
import { isComplete } from '../lib/selectors';
import { classify } from '../lib/sources/freshness';
import { relativeTime } from '../lib/time';
import { cx } from '../lib/cx';

const DAY = 86_400_000;

export function ProgressPage() {
  const { state, now } = useApp();
  const { report } = usePace();

  const week = useMemo(() => weekSummary(state, now), [state.assignments, state.completedSessions, now]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title font-extrabold lk-strong">Progress</h1>
        <p className="mt-1 text-body lk-muted">
          Where you are against where you meant to be.
        </p>
      </header>

      {/* ---- The week ---- */}
      <section aria-labelledby="week-heading">
        <SectionHeader id="week-heading" title="Your week" />
        <Card className={cx('lk-status-edge', STATUS_CLASS[report.status])}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <PaceBadge status={report.status} />
              <ul className="mt-3 space-y-1.5">
                {report.reasons.map((reason, index) => (
                  <li key={`${reason.code}-${index}`} className="flex gap-2 text-body lk-strong">
                    <span
                      aria-hidden
                      className={cx(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        reason.tone === 'good' && 'bg-mint-500',
                        reason.tone === 'warn' && 'bg-flame-500',
                        reason.tone === 'neutral' && 'lk-sunken border lk-border',
                      )}
                    />
                    {reason.text}
                  </li>
                ))}
              </ul>
              {report.staleSources.length > 0 && (
                <p className="mt-3 text-caption lk-muted">
                  {report.staleSources
                    .map((source) => `${source.label} last updated ${source.age}`)
                    .join(' · ')}
                  .{' '}
                  <Link to="/integrations" className="font-semibold underline underline-offset-2">
                    Sync
                  </Link>
                </p>
              )}
            </div>

            <dl className="grid shrink-0 grid-cols-3 gap-x-6 gap-y-2 sm:gap-x-8">
              <Metric value={String(week.completed)} label="Finished" />
              <Metric
                value={String(week.early)}
                label="Early"
                sub={week.early > 0 ? 'before the due date' : undefined}
              />
              <Metric
                value={String(week.overdue)}
                label="Overdue"
                tone={week.overdue > 0 ? 'BEHIND' : 'AHEAD'}
              />
            </dl>
          </div>
        </Card>
      </section>


      {/* ---- Canvas ---- */}
      <section aria-labelledby="canvas-heading">
        <SectionHeader id="canvas-heading" title="Canvas" hint="Work due this week." />
        <Card>
          {week.thisWeekTotal === 0 ? (
            <p className="text-body lk-muted">Nothing is due in the next seven days.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <dl className="flex gap-8">
                  <Metric value={String(week.thisWeekTotal)} label="Due this week" />
                  <Metric value={String(week.thisWeekDone)} label="Complete" />
                  <Metric
                    value={String(week.thisWeekTotal - week.thisWeekDone)}
                    label="Remaining"
                  />
                </dl>
              </div>
              <ProgressBar className="mt-4" value={week.thisWeekDone} max={week.thisWeekTotal} />
            </>
          )}
        </Card>
      </section>

      {/* ---- History ---- */}
      <section aria-labelledby="history-heading">
        <SectionHeader
          id="history-heading"
          title="Recent activity"
          action={
            <Link
              to="/activity"
              className="text-caption font-bold lk-muted underline-offset-2 hover:underline"
            >
              Full log
            </Link>
          }
        />
        <Card>
          {state.activity.length === 0 ? (
            <p className="text-body lk-muted">Nothing has happened yet.</p>
          ) : (
            <ul className="divide-y lk-border">
              {state.activity.slice(0, 6).map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 text-body lk-strong">{event.message}</span>
                  <span className="shrink-0 text-caption lk-muted">
                    {relativeTime(event.timestamp, new Date(now))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}



/**
 * The week's counts.
 *
 * "Early" is measured against the assignment's own due date, not against a
 * plan: finishing something the day before it is due is worth noticing, and it
 * is a fact rather than an interpretation.
 */
function weekSummary(state: ReturnType<typeof useApp>['state'], now: number) {
  const weekAgo = now - 7 * DAY;
  const weekAhead = now + 7 * DAY;

  let completed = 0;
  let early = 0;
  let overdue = 0;
  let thisWeekTotal = 0;
  let thisWeekDone = 0;

  for (const assignment of state.assignments) {
    const due = Date.parse(`${assignment.dueDate}T${assignment.dueTime || '23:59'}`);
    const completedAt = assignment.completedAt ? Date.parse(assignment.completedAt) : null;

    if (completedAt !== null && completedAt >= weekAgo) {
      completed += 1;
      if (!Number.isNaN(due) && completedAt < due - DAY) early += 1;
    }

    if (!isComplete(assignment) && !Number.isNaN(due) && due < now) overdue += 1;

    if (!Number.isNaN(due) && due >= weekAgo && due <= weekAhead) {
      thisWeekTotal += 1;
      if (isComplete(assignment)) thisWeekDone += 1;
    }
  }

  return { completed, early, overdue, thisWeekTotal, thisWeekDone };
}

/** Whether there is enough history for a trend to mean anything. */
export function hasTrendData(state: ReturnType<typeof useApp>['state'], now: number): boolean {
  const recent = state.completedSessions.filter(
    (session) => Date.parse(session.endedAt) > now - 14 * DAY,
  );
  // Fewer than five points across a fortnight is a scatter, not a trend, and
  // drawing a line through it would invent a direction.
  return recent.length >= 5;
}

/** Re-exported so the Integrations page can show the same freshness wording. */
export { classify };
