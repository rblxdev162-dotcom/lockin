/**
 * Home — five seconds to four answers.
 *
 *   1. What should I do now?      → NEXT UP, the one primary card
 *   2. Am I ahead or behind?      → the line under the greeting
 *   3. What does each class need? → CLASSES, one compact summary per course
 *   4. Is LockIn connected?       → the integrations strip at the bottom
 *
 * ## The rule this page is built around
 *
 * **Exactly one thing is visually primary.** The old dashboard had a dozen
 * cards of equal weight, which is the same as having none: a screen where
 * everything is emphasised has nothing to land on. Focus Mode, the plan, exams
 * and Canvas detections are all still reachable — they are just not competing
 * with the next action.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../store/context';
import { usePace } from '../hooks/usePace';
import { useFeedback } from '../hooks/useFeedback';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Badge } from '../components/ui/Badge';
import { CanvasCallout } from '../components/features/CanvasCallout';
import { PaceBadge, SectionHeader, SourceBadge, STATUS_CLASS } from '../components/ui/Status';
import { TodayPlanCard } from '../components/features/planner/TodayPlanCard';
import { requiredAssignments } from '../lib/selectors';
import { groupByClass, whatToDoNext, workStateOf, WORK_STATE_LABEL, WORK_STATE_TONE } from '../lib/workState';
import { paceHeadline } from '../lib/pace/engine';
import { classify } from '../lib/sources/freshness';
import { CheckCanvasButton } from '../components/features/CheckCanvasButton';
import { formatScore, hasPublishedTotal } from '../types/grades';
import { formatClock, greeting } from '../lib/time';
import { cx } from '../lib/cx';
import type { Assignment } from '../types';

export function Dashboard() {
  const { state, now, extension } = useApp();
  const navigate = useNavigate();
  const { report } = usePace();
  const { feedback, dismiss } = useFeedback();

  /**
   * Everything still to do, most urgent first.
   *
   * `whatToDoNext` orders by urgency band and then strictly by due time, so
   * this list *is* the answer to "what should I do next" read top to bottom —
   * missing work, then overdue, then today, then the rest.
   */
  const soon = useMemo(() => whatToDoNext(state.assignments, now), [state.assignments, now]);
  const fm = state.focusMode;
  const unlocked = fm.temporaryUnlockUntil !== null && fm.temporaryUnlockUntil > now;

  /**
   * The one assignment the page is about.
   *
   * It comes from the Pace Engine rather than being picked here, so the
   * dashboard, the reminders and the popup can never disagree about what is
   * next.
   */
  const nextId = report.suggestedAction.assignmentId;
  const next = nextId ? state.assignments.find((a) => a.id === nextId) : undefined;

  return (
    <div className="space-y-6">
      <CanvasCallout />

      {/* ---- Greeting and verdict ---- */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-extrabold lk-strong">
            {greeting()}, {state.profile?.firstName}
          </h1>
          <p className={cx('mt-1 flex flex-wrap items-center gap-2', STATUS_CLASS[report.status])}>
            <span className="text-body font-semibold lk-status-text">{paceHeadline(report)}</span>
            <PaceBadge status={report.status} size="sm" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CheckCanvasButton showStatus={false} />
          <Button
            size="sm"
            variant="secondary"
            icon={<Icon name="plus" size={15} />}
            onClick={() => navigate('/assignments?new=1')}
          >
            Add work
          </Button>
        </div>
      </header>

      {/*
        Positive feedback, when there is something true to say.
        It sits above the primary card rather than inside it: praise attached
        to the next action reads as a reward for work not yet done.
      */}
      {feedback && (
        <div className="animate-fade flex items-start gap-2.5 rounded-2xl lk-status-ahead lk-status-chip px-4 py-3">
          <Icon name="check" size={16} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1 text-body font-semibold">{feedback.text}</p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded-lg p-0.5 opacity-70 transition-opacity hover:opacity-100"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {/* ---- The one primary thing ---- */}
      {fm.active ? (
        <FocusRunningCard unlocked={unlocked} />
      ) : next ? (
        <NextUpCard assignment={next} actionText={report.suggestedAction.text} />
      ) : (
        <NothingDueCard reason={report.suggestedAction} />
      )}

      {/* ---- Classes ---- */}
      <section aria-labelledby="classes-heading">
        <SectionHeader
          id="classes-heading"
          title="Classes"
          hint={
            soon.length === 0
              ? 'Nothing outstanding.'
              : `${soon.length} open assignment${soon.length === 1 ? '' : 's'}, organised by class.`
          }
          action={
            <Link
              to="/assignments"
              className="text-caption font-bold lk-muted underline-offset-2 hover:underline"
            >
              All work
            </Link>
          }
        />
        {soon.length === 0 ? (
          <Card>
            <p className="text-body lk-muted">
              Nothing due right now.{' '}
              <Link to="/planner" className="font-semibold underline underline-offset-2">
                Look at the week
              </Link>
              .
            </p>
          </Card>
        ) : (
          <ClassOverview assignments={soon} />
        )}
      </section>

      {/* ---- The plan, when there is one ---- */}
      <TodayPlanCard />

      {/*
        ---- Connections ----
        One line, not a section. Phase 18: this had a heading, a "Manage" link
        and a card of its own, which gave plumbing the same weight as the work
        — the thing the page is supposed to be about. It matters only when it
        is wrong, and when it is wrong the banner across every screen says so.
      */}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-caption lk-muted">
        <ConnectionDot
          label="Canvas"
          ok={
            state.integrations.records.find((r) => r.id === 'canvas_calendar')?.status ===
            'connected'
          }
          detail={canvasDetail(state, now)}
        />
        <ConnectionDot
          label="Companion"
          ok={extension.status === 'connected'}
          detail={
            extension.status === 'connected'
              ? 'Connected'
              : state.settings.extensionSeen
                ? 'Not answering'
                : 'Not installed'
          }
        />
        <Link to="/integrations" className="font-bold underline-offset-2 hover:underline">
          Manage
        </Link>
      </p>

    </div>
  );
}

function ClassOverview({ assignments }: { assignments: Assignment[] }) {
  const { state, now } = useApp();
  const groups = useMemo(() => groupByClass(assignments, now), [assignments, now]);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="lk-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => {
        const next = group.assignments[0];
        const nextState = workStateOf(next, now);
        const late = group.assignments.filter((a) => {
          const state = workStateOf(a, now);
          return state === 'missing' || state === 'overdue';
        }).length;
        const needsSync = group.assignments.filter(
          (a) => workStateOf(a, now) === 'needs_sync',
        ).length;
        const grade = state.grades.courses.find(
          (item) => item.courseName?.toLowerCase() === group.subject.toLowerCase(),
        );

        return (
          <div
            key={group.subject}
            className="lk-card lk-class-card min-w-0 p-4"
          >
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 text-left"
              aria-expanded={expanded === group.subject}
              onClick={() => setExpanded((value) => value === group.subject ? null : group.subject)}
            >
              <div className="min-w-0">
                <h3 className="truncate text-heading font-extrabold lk-strong">{group.subject}</h3>
                <p className="mt-0.5 text-caption lk-muted">
                  {group.assignments.length} open
                  {late > 0
                    ? ` · ${late} late`
                    : needsSync > 0
                      ? ` · ${needsSync} date${needsSync === 1 ? '' : 's'} to check`
                      : ''}
                </p>
              </div>
              {grade && hasPublishedTotal(grade) && (
                <span className="shrink-0 text-heading font-extrabold tabular-nums lk-strong">
                  {grade.currentScore !== null ? formatScore(grade.currentScore) : grade.currentGrade}
                </span>
              )}
            </button>
            <div className="mt-4 border-t lk-border pt-3">
              <p className="truncate text-body font-bold lk-strong">{next.title}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-caption lk-muted">
                <span
                  className={cx(
                    WORK_STATE_TONE[nextState],
                    'lk-status-chip rounded-full px-2 py-0.5 font-bold',
                  )}
                >
                  {WORK_STATE_LABEL[nextState]}
                </span>
                <span>{duePhrase(next, now)}</span>
              </div>
            </div>
            {expanded === group.subject && (
              <div className="animate-fade mt-3 space-y-2 border-t lk-border pt-3">
                {group.assignments.slice(0, 3).map((assignment) => (
                  <div key={assignment.id} className="flex items-center justify-between gap-3 text-caption">
                    <span className="min-w-0 truncate font-semibold lk-strong">{assignment.title}</span>
                    <span className="shrink-0 lk-muted">{duePhrase(assignment, now)}</span>
                  </div>
                ))}
                <Link
                  to={`/assignments?class=${encodeURIComponent(group.subject)}`}
                  className="inline-block pt-1 text-caption font-extrabold text-brand-600 hover:underline dark:text-brand-300"
                >
                  Open class →
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The primary card, in its three states                               */
/* ------------------------------------------------------------------ */

function NextUpCard({
  assignment,
  actionText,
}: {
  assignment: Assignment;
  actionText: string;
}) {
  const navigate = useNavigate();
  const { now } = useApp();
  const remaining = Math.max(0, assignment.estimatedMinutes - assignment.loggedMinutes);

  return (
    <Card className="lk-card-primary">
      <p className="text-caption font-bold tracking-wide lk-muted uppercase">Next up</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-caption font-semibold lk-muted">{assignment.subject}</p>
          <h2 className="mt-0.5 text-title font-extrabold lk-strong">{assignment.title}</h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-body lk-muted">
            <span>{duePhrase(assignment, now)}</span>
            <span aria-hidden>·</span>
            <span>~{remaining} min</span>
            <SourceBadge source={assignment.source} />
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            icon={<Icon name="timer" size={16} />}
            onClick={() => navigate(`/focus?assignment=${assignment.id}`)}
          >
            Start Focus
          </Button>
        </div>
      </div>
      <p className="mt-3 text-caption lk-muted">{actionText}</p>
    </Card>
  );
}

function FocusRunningCard({ unlocked }: { unlocked: boolean }) {
  const { state, now } = useApp();
  const navigate = useNavigate();
  const fm = state.focusMode;
  const required = requiredAssignments(state);
  const current = required.find((a) => a.status !== 'Completed');

  return (
    <Card className="lk-card-primary">
      <p className="text-caption font-bold tracking-wide lk-muted uppercase">
        {fm.isTest ? 'Blocking test' : 'Focus Mode'}
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-title font-extrabold lk-strong">
            {current ? current.title : 'Running'}
          </h2>
          <p className="mt-1 text-body lk-muted">
            {fm.requiredCompletionCount > 0
              ? `${fm.completedCount} of ${fm.requiredCompletionCount} required finished`
              : `${state.settings.blockedDomains.length} sites blocked`}
          </p>
          {unlocked && (
            <Badge tone="mint" className="mt-2">
              Temporary unlock · {formatClock((fm.temporaryUnlockUntil ?? 0) - now)} left
            </Badge>
          )}
        </div>
        <Button variant="secondary" onClick={() => navigate('/focus')}>
          Open Focus
        </Button>
      </div>
    </Card>
  );
}

function NothingDueCard({ reason }: { reason: { kind: string; text: string } }) {
  const navigate = useNavigate();
  return (
    <Card className="lk-card-primary">
      <p className="text-caption font-bold tracking-wide lk-muted uppercase">Right now</p>
      <h2 className="mt-2 text-title font-extrabold lk-strong">
        {reason.kind === 'connect' ? 'Nothing here yet' : 'Nothing needs doing'}
      </h2>
      <p className="mt-1.5 text-body lk-muted">{reason.text}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {reason.kind === 'connect' ? (
          <Button onClick={() => navigate('/integrations')}>Connect your school tools</Button>
        ) : reason.kind === 'sync' ? (
          <Button onClick={() => navigate('/integrations')}>Sync now</Button>
        ) : (
          <Button variant="secondary" onClick={() => navigate('/planner')}>
            Look at the week
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function ConnectionDot({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      {/* The word carries the state; the dot only reinforces it. */}
      <span
        aria-hidden
        className={cx('h-2 w-2 shrink-0 rounded-full', ok ? 'bg-mint-500' : 'lk-sunken border lk-border')}
      />
      <span className="text-caption font-bold lk-strong">{label}</span>
      <span className="text-caption lk-muted">{detail}</span>
    </div>
  );
}

function duePhrase(assignment: Assignment, now: number): string {
  const due = Date.parse(`${assignment.dueDate}T${assignment.dueTime || '23:59'}`);
  if (Number.isNaN(due)) return 'No due date';
  const time = new Date(due).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round(startOfDay(due) - startOfDay(now)) / 86_400_000;
  if (days === 0) return `Due today, ${time}`;
  if (days === 1) return `Due tomorrow, ${time}`;
  if (days < 0) {
    return workStateOf(assignment, now) === 'needs_sync'
      ? `Date passed · sync to confirm`
      : `Overdue since ${new Date(due).toLocaleDateString()}`;
  }
  return `Due ${new Date(due).toLocaleDateString(undefined, { weekday: 'long' })}, ${time}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function canvasDetail(state: ReturnType<typeof useApp>['state'], now: number): string {
  const record = state.integrations.records.find((r) => r.id === 'canvas_calendar');
  if (!record || record.status === 'not_configured') return 'Not connected';
  if (record.status === 'error') return 'Sync failed';
  const source = state.assignments.find((a) => a.source?.kind === 'CANVAS_CALENDAR')?.source;
  return classify(source, now).label;
}
