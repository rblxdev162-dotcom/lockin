/**
 * The week at a glance: totals, the verification breakdown, and a small chart.
 *
 * Two rules shaped this file. First, no invented scores — there is no
 * "productivity 83", because there is no honest formula behind one and a made-up
 * number invites arguments about the number instead of the work. Second, the
 * chart is never the only way to get the information: every bar has its value
 * in text beneath it and the totals are listed in full.
 */
import type { AppState } from '../../../types';
import { Card, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import {
  selectDailySeries,
  selectVerificationBreakdown,
  selectWeeklySummary,
} from '../../../lib/parent/selectors';
import { selectWeekLoad } from '../../../lib/planner';
import { cx } from '../../../lib/cx';

export function ParentSummary({ state, now }: { state: AppState; now: Date }) {
  const summary = selectWeeklySummary(state, now);
  const breakdown = selectVerificationBreakdown(state, now);
  const series = selectDailySeries(state, now);

  const hours = Math.floor(summary.focusMinutes / 60);
  const minutes = summary.focusMinutes % 60;

  const week = selectWeekLoad(state, 7, now);
  const plannedMinutes = week.reduce((sum, day) => sum + day.plannedMinutes, 0);
  const plannedSessions = week.reduce((sum, day) => sum + day.itemCount, 0);

  const cards = [
    { label: 'Assignments completed', value: summary.assignmentsCompleted },
    { label: 'Verified completions', value: summary.verifiedCompletions },
    { label: 'Focus sessions', value: summary.focusSessions },
    { label: 'Parent overrides', value: summary.parentOverrides },
    { label: 'Emergency exits', value: summary.emergencyExits },
  ];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="This week"
          subtitle={`${formatDay(summary.from)} – ${formatDay(summary.to)}`}
          action={
            <Badge tone="neutral">
              {hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`} focused
            </Badge>
          }
        />
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((card) => (
            <div key={card.label} className="lk-sunken rounded-2xl border lk-border p-3.5">
              <dd className="text-2xl font-extrabold lk-strong">{card.value}</dd>
              <dt className="mt-0.5 text-[0.72rem] font-semibold lk-muted">{card.label}</dt>
            </div>
          ))}
        </dl>
        {/* Phase 7: read-only. A parent may see how much study the student has
            planned; approving schedule changes is deliberately not a thing —
            the planner is a study tool, not a control surface. */}
        {state.planner.plan && (
          <p className="mt-3 text-xs lk-muted">
            Planned study this week: <strong className="lk-strong">{plannedMinutes} min</strong>{' '}
            across {plannedSessions} session{plannedSessions === 1 ? '' : 's'}. The student sets
            their own availability and can change the plan without a PIN.
          </p>
        )}
        <p className="mt-3 text-xs lk-muted">
          {summary.temporaryUnlocks > 0
            ? `${summary.temporaryUnlocks} temporary unlock${summary.temporaryUnlocks === 1 ? '' : 's'} — blocking paused briefly and then resumed on its own. Counted separately from overrides.`
            : 'No temporary unlocks this week.'}
        </p>
      </Card>

      <Card>
        <CardHeader
          title="How work was verified"
          subtitle="What kind of evidence each completion had behind it."
        />
        <div className="space-y-2.5">
          {breakdown.map((row) => (
            <div key={row.kind} className="lk-sunken rounded-2xl border lk-border p-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-bold lk-strong">{row.label}</p>
                <p className="text-xl font-extrabold lk-strong tabular-nums">{row.count}</p>
              </div>
              <p className="mt-1 text-xs lk-muted">{row.explanation}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Completions per day"
          subtitle="Verified and manual completions over the last seven days."
        />
        <DailyChart series={series} />
      </Card>
    </div>
  );
}

/**
 * A plain SVG-free bar chart built from divs.
 *
 * Each column carries its own numbers as text under the bar, and the whole
 * thing has a table-shaped summary underneath for screen readers, so nothing
 * here is communicated by colour or height alone.
 */
function DailyChart({ series }: { series: ReturnType<typeof selectDailySeries> }) {
  const max = Math.max(1, ...series.map((point) => point.verified + point.manual));
  const totalVerified = series.reduce((sum, p) => sum + p.verified, 0);
  const totalManual = series.reduce((sum, p) => sum + p.manual, 0);

  if (totalVerified + totalManual === 0) {
    return (
      <p className="lk-sunken rounded-2xl border lk-border p-4 text-sm lk-muted">
        Nothing completed in the last seven days.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-2" role="presentation">
        {series.map((point) => {
          const total = point.verified + point.manual;
          return (
            <div key={point.date} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex h-28 w-full max-w-12 flex-col justify-end gap-0.5">
                {point.manual > 0 && (
                  <div
                    className="w-full rounded-t-md bg-brand-200 dark:bg-brand-800"
                    style={{ height: `${(point.manual / max) * 100}%` }}
                  />
                )}
                {point.verified > 0 && (
                  <div
                    className={cx(
                      'w-full bg-mint-500',
                      point.manual > 0 ? 'rounded-b-md' : 'rounded-md',
                    )}
                    style={{ height: `${(point.verified / max) * 100}%` }}
                  />
                )}
              </div>
              <span className="text-[0.7rem] font-bold lk-strong tabular-nums">{total}</span>
              <span className="text-[0.7rem] lk-muted">{point.label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs lk-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-mint-500" />
          Verified — {totalVerified}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-200 dark:bg-brand-800" />
          Manual — {totalManual}
        </span>
      </div>

      {/* The same numbers as text, for anyone who cannot use the bars. */}
      <p className="sr-only">
        {series
          .map((p) => `${p.label}: ${p.verified} verified, ${p.manual} manual`)
          .join('. ')}
      </p>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
