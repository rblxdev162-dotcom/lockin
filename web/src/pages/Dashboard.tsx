import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store/context';
import { Card, CardHeader, EmptyState } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/Progress';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import { AssignmentCard } from '../components/features/AssignmentCard';
import { useCanvas } from '../hooks/useCanvas';
import { CanvasCallout } from '../components/features/CanvasCallout';
import {
  blockingActive,
  dueSoon,
  requiredAssignments,
  todayProgress,
  upcomingExams,
} from '../lib/selectors';
import { daysUntil, formatClock, formatDaysRemaining, greeting } from '../lib/time';
import { cx } from '../lib/cx';
import { TodayPlanCard } from '../components/features/planner/TodayPlanCard';
import { PlanWarnings } from '../components/features/planner/PlanWarnings';
import { livePlan } from '../lib/planner';

export function Dashboard() {
  const { state, dispatch, now, extension } = useApp();
  const navigate = useNavigate();
  const { openInCanvas, checkStatus, busy: canvasBusy } = useCanvas();

  // Memoised: `now` ticks every second, but the plan only changes with state.
  const plan = useMemo(
    () => livePlan(state, new Date(now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.planner.plan, state.assignments, state.exams, state.completedSessions],
  );
  const soon = dueSoon(state, 2);
  const progress = todayProgress(state);
  const exams = upcomingExams(state);
  const fm = state.focusMode;
  const required = requiredAssignments(state);
  const unlocked = fm.temporaryUnlockUntil !== null && fm.temporaryUnlockUntil > now;

  return (
    <div className="space-y-5">
      <CanvasCallout />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight lk-strong">
            {greeting()}, {state.profile?.firstName}
          </h1>
          <p className="mt-1 text-sm lk-muted">
            {soon.length === 0
              ? 'Nothing due in the next couple of days. Nice.'
              : soon.length === 1
                ? '1 thing needs attention.'
                : `${soon.length} things need attention.`}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Icon name="plus" size={15} />}
          onClick={() => navigate('/assignments?new=1')}
        >
          Add work
        </Button>
      </header>

      {/* ---- Focus Mode ---- */}
      <Card
        className={cx(
          'relative overflow-hidden',
          fm.active && !unlocked && 'border-brand-500 ring-1 ring-brand-500/30',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cx(
                  'grid h-9 w-9 place-items-center rounded-xl',
                  fm.active
                    ? 'bg-brand-600 text-white'
                    : 'lk-sunken lk-muted border lk-border',
                )}
              >
                <Icon name={fm.active ? 'lock' : 'unlock'} size={18} />
              </span>
              <div>
                <p className="text-xs font-bold tracking-wide lk-muted uppercase">Focus Mode</p>
                <p className="text-lg font-extrabold tracking-tight lk-strong">
                  {fm.active ? (fm.isTest ? 'TEST MODE ACTIVE' : 'ACTIVE') : 'OFF'}
                </p>
              </div>
            </div>

            {fm.active ? (
              <div className="mt-3 space-y-2">
                {fm.requiredCompletionCount > 0 && (
                  <>
                    <p className="text-sm font-semibold lk-strong">
                      Required work: {fm.completedCount} / {fm.requiredCompletionCount} completed
                    </p>
                    <ProgressBar
                      value={fm.completedCount}
                      max={fm.requiredCompletionCount}
                      className="max-w-xs"
                    />
                  </>
                )}
                {unlocked && (
                  <Badge tone="mint">
                    Temporary unlock · {formatClock((fm.temporaryUnlockUntil ?? 0) - now)} left
                  </Badge>
                )}
                {fm.isTest && fm.testExpiresAt && (
                  <Badge tone="amber">
                    Test ends in {formatClock(fm.testExpiresAt - now)}
                  </Badge>
                )}
                <p className="text-xs lk-muted">
                  {blockingActive(state, now)
                    ? `${state.settings.blockedDomains.length} site${
                        state.settings.blockedDomains.length === 1 ? '' : 's'
                      } blocked right now.`
                    : 'Blocking is paused.'}
                </p>
              </div>
            ) : (
              <p className="mt-3 max-w-sm text-sm lk-muted">
                Turn on Focus Mode to block distracting sites until your required work is done.
              </p>
            )}
          </div>

          <Button variant={fm.active ? 'secondary' : 'primary'} onClick={() => navigate('/focus')}>
            {fm.active ? 'Manage' : 'Start Focus Mode'}
          </Button>
        </div>

        {extension.status === 'disconnected' && (
          <Link
            to="/settings"
            className="mt-4 flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-400/20 dark:text-amber-300"
          >
            <Icon name="alert" size={15} />
            Chrome extension not connected — sites won’t actually be blocked. Set it up →
          </Link>
        )}

        {required.length > 0 && fm.active && (
          <div className="mt-4 space-y-2 border-t lk-border pt-4">
            <p className="text-xs font-bold tracking-wide lk-muted uppercase">
              Required to unlock
            </p>
            {required.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                required
                onToggleComplete={() =>
                  dispatch(
                    a.status === 'Completed'
                      ? { type: 'UNCOMPLETE_ASSIGNMENT', id: a.id }
                      : { type: 'COMPLETE_ASSIGNMENT', id: a.id, method: 'manual' },
                  )
                }
                onFocus={() => navigate(`/focus?assignment=${a.id}`)}
                onOpenCanvas={(x) => x.canvas && openInCanvas(x.canvas.url)}
                onCheckCanvas={checkStatus}
                canvasBusy={canvasBusy === 'check' || canvasBusy === 'sync'}
              />
            ))}
          </div>
        )}
      </Card>

      {/* ---- Today's plan (Phase 7) ----
          The planner answers "what should I work on today?"; the card below
          still answers "what is due". They are different questions and the
          dashboard keeps both. */}
      {plan && plan.warnings.length > 0 && (
        <PlanWarnings warnings={plan.warnings} limit={2} onAdjust={() => navigate('/planner')} />
      )}
      <TodayPlanCard />

      {/* ---- Progress ---- */}
      <Card>
        <CardHeader
          title="Today’s progress"
          subtitle={
            progress.total === 0
              ? 'Nothing is due today.'
              : `${progress.done} / ${progress.total} tasks complete`
          }
        />
        <ProgressBar
          value={progress.done}
          max={Math.max(1, progress.total)}
          tone={progress.total > 0 && progress.done === progress.total ? 'mint' : 'brand'}
        />
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: 'Due today', value: progress.total },
            { label: 'Completed', value: progress.done },
            {
              label: 'Minutes logged',
              value: state.completedSessions.reduce((sum, s) => sum + s.actualMinutes, 0),
            },
          ].map((stat) => (
            <div key={stat.label} className="lk-sunken rounded-2xl border lk-border p-3 text-center">
              <p className="text-2xl font-extrabold tracking-tight lk-strong">{stat.value}</p>
              <p className="mt-0.5 text-[0.7rem] font-semibold lk-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ---- Today ---- */}
      <Card>
        <CardHeader
          title="Today"
          subtitle="Unfinished work due soon"
          action={
            <Link
              to="/assignments"
              className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
            >
              See all
            </Link>
          }
        />
        {soon.length === 0 ? (
          <EmptyState
            icon={<Icon name="check" size={28} />}
            title="You’re clear for now"
            hint="Nothing is due in the next two days."
            action={
              <Button size="sm" variant="secondary" onClick={() => navigate('/assignments?new=1')}>
                Add an assignment
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {soon.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                required={fm.active && fm.requiredTaskIds.includes(a.id)}
                onToggleComplete={() =>
                  dispatch({ type: 'COMPLETE_ASSIGNMENT', id: a.id, method: 'manual' })
                }
                onFocus={() => navigate(`/focus?assignment=${a.id}`)}
                onOpenCanvas={(x) => x.canvas && openInCanvas(x.canvas.url)}
                onCheckCanvas={checkStatus}
                canvasBusy={canvasBusy === 'check' || canvasBusy === 'sync'}
              />
            ))}
          </div>
        )}
      </Card>

      {/* ---- Exams ---- */}
      <Card>
        <CardHeader
          title="Upcoming exams"
          action={
            <Link
              to="/exams"
              className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
            >
              Manage
            </Link>
          }
        />
        {exams.length === 0 ? (
          <EmptyState
            icon={<Icon name="exam" size={28} />}
            title="No exams scheduled"
            hint="Add one and LockIn will count down the days."
            action={
              <Button size="sm" variant="secondary" onClick={() => navigate('/exams?new=1')}>
                Add an exam
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {exams.slice(0, 4).map((exam) => {
              const days = daysUntil(exam.examDate);
              return (
                <div
                  key={exam.id}
                  className="lk-sunken flex items-center justify-between gap-3 rounded-2xl border lk-border p-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold lk-strong">{exam.name}</p>
                    <p className="text-xs lk-muted">
                      {exam.subject} · {exam.materialAmount} material
                    </p>
                  </div>
                  <Badge tone={days !== null && days <= 3 ? 'flame' : 'brand'}>
                    {formatDaysRemaining(days)}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
