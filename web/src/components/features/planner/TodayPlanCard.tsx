/**
 * "What should I work on today?" — the answer, on the dashboard and on the
 * planner page. One component, so the two can never disagree.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../../store/context';
import { Card, CardHeader, EmptyState } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { Icon } from '../../ui/Icon';
import { ProgressBar } from '../../ui/Progress';
import { PlanItemRow } from './PlanItemRow';
import { usePlanner } from '../../../hooks/usePlanner';
import { dayProgress } from '../../../lib/planner/reschedule';
import { livePlan, statusContext } from '../../../lib/planner';
import { formatMinutes } from '../../../lib/planner/explanations';
import { todayISO } from '../../../lib/time';

export function TodayPlanCard({ showActions = true }: { showActions?: boolean }) {
  const { state, now } = useApp();
  const at = new Date(now);
  const planner = usePlanner();

  /**
   * Annotated once per state change, not once per clock tick.
   *
   * `now` updates every second for the timer, and re-deriving statuses for the
   * whole horizon at 1 Hz is pure waste — the plan only changes when the state
   * does, or when the date does.
   */
  const today = todayISO(at);
  const plan = useMemo(
    () => livePlan(state, new Date(now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.planner.plan,
      state.assignments,
      state.exams,
      state.completedSessions,
      state.activeSession,
      today,
    ],
  );
  const day = plan?.days.find((d) => d.date === today) ?? null;
  const progress = plan ? dayProgress(plan, today, statusContext(state, at)) : null;
  // Recorded at the rollover: after a rebuild the plan has no past days left,
  // so this cannot be worked out again afterwards.
  const recovery = state.planner.lastRecovery;
  const missed =
    recovery && todayISO(new Date(recovery.recordedAt)) === today ? recovery : null;

  if (!plan) {
    return (
      <Card>
        <CardHeader title="Today’s plan" subtitle="LockIn can work out what to do today" />
        <EmptyState
          icon={<Icon name="calendar" size={28} />}
          title="No study plan yet"
          hint="Tell LockIn when you’re usually free and it will turn your assignments and exams into a realistic daily schedule."
          action={
            <Button size="sm" onClick={planner.rebuild}>
              Build my plan
            </Button>
          }
        />
      </Card>
    );
  }

  const items = day?.items ?? [];
  const fm = state.focusMode;

  return (
    <Card data-testid="today-plan">
      <CardHeader
        title="Today’s plan"
        subtitle={
          items.length === 0
            ? day?.restDay
              ? 'Rest day — nothing scheduled.'
              : 'Nothing scheduled for today.'
            : `${items.length} session${items.length === 1 ? '' : 's'} · ${formatMinutes(
                day?.plannedMinutes ?? 0,
              )} planned`
        }
        action={
          <Link
            to="/planner"
            className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
          >
            Planner
          </Link>
        }
      />

      {/* Missed-day recovery: say what moved, without a lecture. */}
      {missed && missed.unfinishedMinutes > 0 && (
        <div className="mb-4 rounded-xl border border-brand-400/40 bg-brand-50/70 p-3 text-sm dark:bg-brand-900/25">
          <p className="font-bold lk-strong">Plan updated</p>
          <p className="mt-0.5 lk-muted">
            {formatMinutes(missed.unfinishedMinutes)} from {missed.date} wasn’t finished, so it was
            spread across the days ahead. Nothing was dropped.
          </p>
        </div>
      )}

      {progress && progress.totalItems > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-sm font-bold lk-strong">
              {progress.completedItems} / {progress.totalItems} sessions complete
            </p>
            <p className="text-xs font-semibold lk-muted">
              {progress.completedMinutes} / {progress.plannedMinutes} min
            </p>
          </div>
          <ProgressBar
            value={progress.completedMinutes}
            max={Math.max(1, progress.plannedMinutes)}
            tone={progress.completedMinutes >= progress.plannedMinutes ? 'mint' : 'brand'}
          />
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<Icon name="check" size={26} />}
          title={day?.restDay ? 'Rest day' : 'Nothing planned today'}
          hint={
            day?.restDay
              ? 'You marked this day as a rest day, so LockIn left it free.'
              : 'Either everything is done, or there is no study time set for today.'
          }
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((item, index) => (
            <PlanItemRow
              key={item.id}
              item={item}
              compact
              onStart={showActions ? () => planner.startItem(item) : undefined}
              onSkip={showActions ? () => planner.skipItem(item) : undefined}
              onMove={
                showActions && !planner.locked
                  ? (direction) => planner.reorderToday(item, direction)
                  : undefined
              }
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
            />
          ))}
        </div>
      )}

      {showActions && items.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!fm.active && (
            <Button
              size="sm"
              icon={<Icon name="lock" size={15} />}
              onClick={planner.startFocusFromPlan}
            >
              Start today’s plan
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={planner.rebuild}>
            Rebuild plan
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => planner.setLock(!planner.locked)}
          >
            {planner.locked ? 'Unlock order' : 'Lock today’s order'}
          </Button>
          {planner.locked && <Badge tone="brand">Order locked</Badge>}
        </div>
      )}
    </Card>
  );
}
