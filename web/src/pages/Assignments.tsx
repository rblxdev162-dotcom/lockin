import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../store/context';
import { Card, EmptyState } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Chip, Select, TextInput } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { AssignmentCard } from '../components/features/AssignmentCard';
import { AssignmentForm } from '../components/features/AssignmentForm';
import { createAssignment } from '../store/factories';
import type { Assignment } from '../types';
import { PLATFORMS, PRIORITIES } from '../types';
import { isComplete } from '../lib/selectors';
import { byUrgency, groupByClass, isContested, isSettled, workStateOf } from '../lib/workState';
import { SectionHeader } from '../components/ui/Status';
import { cx } from '../lib/cx';
import { toast } from '../components/ui/Toast';
import { useCanvas } from '../hooks/useCanvas';
import { CanvasLinkModal } from '../components/features/CanvasLinkModal';
import { QuickAdd } from '../components/features/QuickAdd';
import { CanvasCallout } from '../components/features/CanvasCallout';
import { CheckCanvasButton } from '../components/features/CheckCanvasButton';
import { formatScore, hasPublishedTotal } from '../types/grades';
import { classGradesUrl, classSwitchLabel } from '../lib/classNames';
import { relativeTime } from '../lib/time';
import { classStyle } from '../lib/schoolSchedule';
import { readToolkit } from '../lib/localExperience';
import { describeStoredCoverage } from '../lib/canvas/readCoverage';

const ALL = 'All';
type BrowseTabs = 'class' | 'teacher';

function teacherFor(subject: string, contacts: ReturnType<typeof readToolkit>['teacherContacts']): string {
  return contacts[subject]?.name.trim() || 'Teacher not set';
}

/**
 * The views a student actually thinks in.
 *
 * These replaced a status dropdown and a priority dropdown. A dropdown makes
 * you name the thing you want before you can see it; a tab shows you what is
 * there. `To do` is first and is the default, because "what do I do now" is
 * the question the page is opened to answer.
 *
 * Phase 18 took the wording from the two systems students already read every
 * day — Canvas's own coursework widget filters by Missing / Upcoming, and
 * Google Classroom's tabs are Assigned / Missing / Done. Inventing a fifth
 * vocabulary for the same four ideas costs recognition and buys nothing.
 * `Missing` still means "late or unhanded-in", which is what it means in both.
 */
const VIEWS = [
  { id: 'next', label: 'To do' },
  { id: 'overdue', label: 'Missing' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'done', label: 'Done' },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];

/**
 * Which view an assignment belongs to.
 *
 * Derived from `workStateOf` so the tabs, the badges and the ordering can
 * never disagree — the alternative is three places deciding separately what
 * "done" means, which is how the old page ended up unable to tell graded work
 * from work somebody had ticked off.
 */
function viewOf(assignment: Assignment, now: number): ViewId {
  const state = workStateOf(assignment, now);
  if (isSettled(state)) return 'done';
  if (state === 'missing' || state === 'overdue') return 'overdue';
  if (state === 'upcoming') return 'upcoming';
  // Due today and undated are both "now" work.
  return 'next';
}

/** Empty states say what is true, not that a filter returned nothing. */
const EMPTY_TITLES: Record<ViewId, string> = {
  next: 'Nothing to do right now',
  overdue: 'Nothing missing',
  upcoming: 'Nothing coming up',
  done: 'Nothing finished yet',
};

/** The first view with work in it, in priority order. */
export function initialView(assignments: Assignment[], now: number): ViewId {
  const counts: Record<ViewId, number> = { next: 0, overdue: 0, upcoming: 0, done: 0 };
  for (const assignment of assignments) counts[viewOf(assignment, now)] += 1;
  if (counts.overdue > 0) return 'overdue';
  if (counts.next > 0) return 'next';
  if (counts.upcoming > 0) return 'upcoming';
  return 'next';
}

const EMPTY_HINTS: Record<ViewId, string> = {
  next: 'Check Upcoming to get ahead.',
  overdue: 'Everything with a due date is still in time.',
  upcoming: 'Connect Canvas and your week fills itself in.',
  done: 'Finished work collects here.',
};


export function AssignmentsPage() {
  const { state, dispatch, now } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const { openInCanvas, checkStatus, busy: canvasBusy, connection } = useCanvas();
  const canvasConnected = !!connection;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [deleting, setDeleting] = useState<Assignment | null>(null);
  const [linking, setLinking] = useState<Assignment | null>(null);
  const [renamingClass, setRenamingClass] = useState<string | null>(null);
  const [classNameDraft, setClassNameDraft] = useState('');
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const [toolkit] = useState(readToolkit);
  const requestedClass = params.get('class')?.trim() || ALL;
  const requestedTeacher = params.get('teacher')?.trim() || ALL;
  const [subject, setSubject] = useState<string>(requestedClass);
  const [teacher, setTeacher] = useState<string>(requestedTeacher);
  const [browseTabs, setBrowseTabs] = useState<BrowseTabs>(() => {
    if (requestedClass !== ALL) return 'class';
    if (requestedTeacher !== ALL) return 'teacher';
    try { return localStorage.getItem('lockin.assignments.tabs') === 'teacher' ? 'teacher' : 'class'; } catch { return 'class'; }
  });
  /**
   * Which view to land on.
   *
   * Not always Today. A student whose next deadline is Thursday would open the
   * page to an empty screen and have to go looking for their own work — so the
   * first view with something in it wins, in the order that matters: anything
   * late, then today, then what is coming.
   *
   * Chosen once, on mount. Re-deriving it as data changes would move the page
   * out from under somebody who deliberately opened an empty tab.
   */
  const [view, setView] = useState<ViewId>(() =>
    initialView(
      requestedClass === ALL
        ? state.assignments
        : state.assignments.filter((a) => (a.subject?.trim() || 'No class') === requestedClass),
      Date.now(),
    ),
  );
  /**
   * List or class sections.
   *
   * Remembered across visits, because it is a preference about how somebody
   * reads rather than a filter they set for one question. It lives in its own
   * key rather than in `AppState` — see `hooks/useFeedback.ts` for the same
   * reasoning about presentation state.
   */
  const [layout, setLayout] = useState<'list' | 'class'>(() => {
    try {
      return localStorage.getItem('lockin.assignments.layout') === 'list' ? 'list' : 'class';
    } catch {
      return 'class';
    }
  });
  const [showFilters, setShowFilters] = useState(false);

  // Deep link from the dashboard: /assignments?new=1
  useEffect(() => {
    if (params.get('new')) {
      setCreating(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  /** Everything matching the search and the optional filters, before views. */
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Most urgent first, always. `byUrgency` is the app's one comparator.
    return byUrgency(
      state.assignments.filter((a) => {
        if (platform !== ALL && a.platform !== platform) return false;
        if (priority !== ALL && a.priority !== priority) return false;
        if (browseTabs === 'class' && subject !== ALL && (a.subject?.trim() || 'No class') !== subject) return false;
        if (browseTabs === 'teacher' && teacher !== ALL && teacherFor(a.subject?.trim() || 'No class', toolkit.teacherContacts) !== teacher) return false;
        if (q && !`${a.title} ${a.subject} ${teacherFor(a.subject, toolkit.teacherContacts)}`.toLowerCase().includes(q)) return false;
        return true;
      }),
      now,
    );
  }, [state.assignments, query, platform, priority, subject, teacher, browseTabs, toolkit.teacherContacts, now]);

  /** Counts for the tabs, computed once rather than per tab. */
  const buckets = useMemo(() => {
    const out: Record<ViewId, Assignment[]> = { next: [], overdue: [], upcoming: [], done: [] };
    for (const assignment of matching) out[viewOf(assignment, now)].push(assignment);
    // Finished work reads newest-first: the useful question there is "what did
    // I just finish", not "what was due first".
    out.done.reverse();
    return out;
  }, [matching, now]);

  const horizon = params.get('horizon');
  const shown = useMemo(() => {
    if (!horizon) return buckets[view];
    const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
    const endSoon = endToday.getTime() + 3 * 86_400_000;
    const due = (assignment: Assignment) => assignment.dueDate ? Date.parse(`${assignment.dueDate}T${assignment.dueTime || '23:59'}`) : Number.MAX_SAFE_INTEGER;
    return matching.filter((assignment) => {
      if (assignment.status === 'Completed') return false;
      if (horizon === 'parking') return !assignment.dueDate;
      if (horizon === 'today') return due(assignment) <= endToday.getTime();
      if (horizon === 'soon') return due(assignment) > endToday.getTime() && due(assignment) <= endSoon;
      if (horizon === 'later') return due(assignment) > endSoon && due(assignment) < Number.MAX_SAFE_INTEGER;
      return true;
    });
  }, [buckets, view, horizon, matching, now]);
  const filtersOn = platform !== ALL || priority !== ALL || query.trim() !== '';
  const classTabs = useMemo(
    () =>
      groupByClass(state.assignments, now).map((group) => ({
        subject: group.subject,
        label: classSwitchLabel(group.subject),
        open: group.assignments.filter((a) => !isSettled(workStateOf(a, now))).length,
      })),
    [state.assignments, now],
  );
  const teacherTabs = useMemo(() => {
    const grouped = new Map<string, { teacher: string; subjects: Set<string>; open: number }>();
    for (const assignment of state.assignments) {
      const name = teacherFor(assignment.subject?.trim() || 'No class', toolkit.teacherContacts);
      const entry = grouped.get(name) ?? { teacher: name, subjects: new Set<string>(), open: 0 };
      entry.subjects.add(assignment.subject?.trim() || 'No class');
      if (!isSettled(workStateOf(assignment, now))) entry.open += 1;
      grouped.set(name, entry);
    }
    return [...grouped.values()].sort((a, b) => a.teacher === 'Teacher not set' ? 1 : b.teacher === 'Teacher not set' ? -1 : a.teacher.localeCompare(b.teacher));
  }, [state.assignments, toolkit.teacherContacts, now]);

  const chooseClass = (next: string) => {
    setBrowseTabs('class');
    setSubject(next);
    setTeacher(ALL);
    const classAssignments =
      next === ALL
        ? state.assignments
        : state.assignments.filter((a) => (a.subject?.trim() || 'No class') === next);
    setView(initialView(classAssignments, now));
    const nextParams = new URLSearchParams(params);
    if (next === ALL) nextParams.delete('class');
    else nextParams.set('class', next);
    nextParams.delete('teacher');
    setParams(nextParams, { replace: true });
    try { localStorage.setItem('lockin.assignments.tabs', 'class'); } catch { /* presentation preference */ }
  };

  const chooseTeacher = (next: string) => {
    setBrowseTabs('teacher');
    setTeacher(next);
    setSubject(ALL);
    const teacherAssignments = next === ALL ? state.assignments : state.assignments.filter((assignment) => teacherFor(assignment.subject?.trim() || 'No class', toolkit.teacherContacts) === next);
    setView(initialView(teacherAssignments, now));
    const nextParams = new URLSearchParams(params);
    if (next === ALL) nextParams.delete('teacher'); else nextParams.set('teacher', next);
    nextParams.delete('class');
    setParams(nextParams, { replace: true });
    try { localStorage.setItem('lockin.assignments.tabs', 'teacher'); } catch { /* presentation preference */ }
  };

  const chooseBrowseTabs = (next: BrowseTabs) => {
    setBrowseTabs(next);
    if (next === 'class') setTeacher(ALL); else setSubject(ALL);
    try { localStorage.setItem('lockin.assignments.tabs', next); } catch { /* presentation preference */ }
    const nextParams = new URLSearchParams(params);
    nextParams.delete(next === 'class' ? 'teacher' : 'class');
    setParams(nextParams, { replace: true });
  };

  const selectedClassAssignments =
    subject === ALL
      ? []
      : state.assignments.filter((a) => (a.subject?.trim() || 'No class') === subject);
  const selectedGradesUrl = selectedClassAssignments
    .map((a) => classGradesUrl(a.canvas?.url, state.canvas.connection?.domain ?? null))
    .find((url): url is string => url !== null) ?? null;
  const selectedOpen = selectedClassAssignments.filter(
    (a) => !isSettled(workStateOf(a, now)),
  ).length;
  const selectedNeedsReview = selectedClassAssignments.filter((a) => {
    const status = workStateOf(a, now);
    return status === 'needs_sync' || a.canvas?.submissionStatus === 'verification_unavailable';
  }).length;
  const reviewQueue = state.assignments.filter((a) => {
    const status = workStateOf(a, now);
    return (
      status === 'needs_sync' ||
      a.canvas?.submissionStatus === 'verification_unavailable' ||
      isContested(a)
    );
  });
  /**
   * Work the student marked done that Canvas says was never handed in.
   *
   * It keeps its completion — a gradebook that lags a day must not re-block a
   * browser on its own — but it is exactly the disagreement a student wants to
   * find before their teacher does, so it is named rather than buried.
   */
  const contested = state.assignments.filter(isContested);
  const checkReport = state.canvas.lastCheckReport;
  const checkCoverage = checkReport
    ? describeStoredCoverage(checkReport.coverage, checkReport.rowsRead)
    : null;

  /**
   * A class's current grade, matched by the Canvas course name LockIn stored
   * when it read the Grades page. Matched on the name because that is what the
   * column is keyed by; no match simply shows nothing, which is the right
   * answer for a class that was typed in by hand.
   */
  const gradeFor = (subject: string) => {
    const grade = state.grades.courses.find(
      (g) => g.courseName && g.courseName.toLowerCase() === subject.toLowerCase(),
    );
    if (!grade || !hasPublishedTotal(grade)) return null;
    return (
      <span className="mr-2 font-bold lk-strong">
        {grade.currentScore !== null ? formatScore(grade.currentScore) : grade.currentGrade}
      </span>
    );
  };

  /**
   * One row, wired the same way in both layouts.
   *
   * Written once rather than duplicated per layout: the list and the columns
   * differ in arrangement only, and two copies of this wiring is two places to
   * forget the Canvas handlers.
   */
  const renderCard = (a: Assignment) => (
    <AssignmentCard
      key={a.id}
      assignment={a}
      now={now}
      required={state.focusMode.active && state.focusMode.requiredTaskIds.includes(a.id)}
      onToggleComplete={() => {
        if (isComplete(a)) {
          dispatch({ type: 'UNCOMPLETE_ASSIGNMENT', id: a.id });
          toast(`“${a.title}” moved back to your list.`, 'info', {
            label: 'Undo',
            run: () => dispatch({ type: 'COMPLETE_ASSIGNMENT', id: a.id, method: 'manual' }),
          });
          return;
        }
        dispatch({ type: 'COMPLETE_ASSIGNMENT', id: a.id, method: 'manual' });
        toast(`“${a.title}” marked complete.`, 'success', {
          label: 'Undo',
          run: () => dispatch({ type: 'UNCOMPLETE_ASSIGNMENT', id: a.id }),
        });
      }}
      onEdit={() => setEditing(a)}
      onDelete={() => setDeleting(a)}
      onFocus={isComplete(a) ? undefined : () => navigate(`/focus?assignment=${a.id}`)}
      onOpenCanvas={(x) => x.canvas && openInCanvas(x.canvas.url)}
      onCheckCanvas={isComplete(a) ? undefined : checkStatus}
      canvasBusy={canvasBusy === 'check' || canvasBusy === 'sync'}
      onLinkCanvas={canvasConnected && !a.canvas && !isComplete(a) ? () => setLinking(a) : undefined}
      onToggleStep={(stepId) => dispatch({
        type: 'UPDATE_ASSIGNMENT',
        id: a.id,
        patch: { steps: a.steps.map((step) => step.id === stepId ? { ...step, done: !step.done } : step) },
      })}
    />
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-extrabold lk-strong">Assignments</h1>
          <p className="mt-1 text-body lk-muted">
            {state.assignments.length} total ·{' '}
            {buckets.next.length + buckets.overdue.length + buckets.upcoming.length} unfinished
          </p>
        </div>
        <CheckCanvasButton showStatus={false} />
      </header>

      <CanvasCallout />

      {(checkReport || reviewQueue.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {checkReport && (
            <Card className="p-4">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-mint-500/15 p-2 text-mint-700 dark:text-mint-300">
                  <Icon name="refresh" size={16} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body font-extrabold lk-strong">Last Canvas check</p>
                    {checkCoverage && (
                      <Badge
                        tone={
                          checkCoverage.coverage === 'gradebook'
                            ? 'mint'
                            : checkCoverage.coverage === 'unreadable'
                              ? 'flame'
                              : 'neutral'
                        }
                      >
                        {checkCoverage.label}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-caption lk-muted">
                    {checkReport.message} · {relativeTime(checkReport.checkedAt, new Date(now))}
                    {checkReport.origin === 'automatic' ? ' · after-school refresh' : ''}
                  </p>
                  <p className="mt-2 text-caption font-semibold lk-strong">
                    {checkReport.newAssignments} new · {checkReport.updatedAssignments} changed ·{' '}
                    {checkReport.cancelledAssignments} cancelled
                  </p>
                  {checkCoverage && (
                    <p className="mt-1 text-caption lk-muted">
                      {checkCoverage.detail}
                      {(checkReport.rowsSeen ?? 0) > 0 && (
                        <> Candidate rows seen: {checkReport.rowsSeen}.</>
                      )}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}
          {reviewQueue.length > 0 && (
            <Card className="p-4">
              <p className="text-body font-extrabold lk-strong">Accuracy review</p>
              <p className="mt-0.5 text-caption lk-muted">
                {reviewQueue.length} item{reviewQueue.length === 1 ? '' : 's'} need a fresh date or a
                clearer Canvas status. LockIn will not guess.
              </p>
              {contested.length > 0 && (
                <p className="mt-1.5 text-caption font-bold lk-status-behind lk-status-text">
                  {contested.length === 1
                    ? 'One of these is marked done here, but Canvas still says nothing was handed in.'
                    : `${contested.length} of these are marked done here, but Canvas still says nothing was handed in.`}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {reviewQueue.slice(0, 3).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => chooseClass(a.subject || 'No class')}
                    className="rounded-full lk-sunken px-2.5 py-1 text-caption font-bold lk-strong"
                  >
                    {a.title}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <Card>
        <QuickAdd onOpenFull={() => setCreating(true)} autoFocus={state.assignments.length === 0} />
      </Card>

      {/*
        Views first, filters second and folded away. The three-dropdown row
        this replaced made an assignment list look like a report builder; the
        common questions are "what's due" and "what's late", and those are now
        one tap rather than two selections.
      */}
      <div>
        <div
          role="tablist"
          aria-label="Assignment views"
          className="flex gap-1 overflow-x-auto rounded-2xl lk-sunken border lk-border p-1"
        >
          {VIEWS.map((entry) => {
            const selected = view === entry.id;
            const count = buckets[entry.id].length;
            return (
              <button
                key={entry.id}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setView(entry.id)}
                className={cx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2',
                  'text-caption font-bold whitespace-nowrap transition-colors duration-150',
                  selected ? 'lk-raised lk-strong shadow-sm' : 'lk-muted hover:lk-strong',
                )}
              >
                {entry.label}
                <span
                  className={cx(
                    'rounded-full px-1.5 py-0.5 text-[0.65rem] tabular-nums',
                    selected ? 'lk-sunken' : 'opacity-70',
                    entry.id === 'overdue' && count > 0 && 'lk-status-behind lk-status-chip',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {(classTabs.length > 0 || teacherTabs.length > 0) && (
          <div className="mt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-caption font-bold tracking-wide lk-muted uppercase">Browse assignments</p>
              <div className="flex rounded-xl border lk-border lk-sunken p-1" role="tablist" aria-label="Assignment tab type">
                <button type="button" role="tab" aria-selected={browseTabs === 'class'} onClick={() => chooseBrowseTabs('class')} className={cx('rounded-lg px-3 py-1.5 text-caption font-extrabold transition-all', browseTabs === 'class' ? 'lk-raised lk-strong shadow-sm' : 'lk-muted')}>Classes</button>
                <button type="button" role="tab" aria-selected={browseTabs === 'teacher'} onClick={() => chooseBrowseTabs('teacher')} className={cx('rounded-lg px-3 py-1.5 text-caption font-extrabold transition-all', browseTabs === 'teacher' ? 'lk-raised lk-strong shadow-sm' : 'lk-muted')}>Teachers</button>
              </div>
            </div>
            {browseTabs === 'class' ? (
              <div role="tablist" aria-label="Classes" className="lk-class-switcher flex gap-2 overflow-x-auto pb-1">
                <ClassTab label="All classes" count={classTabs.reduce((sum, item) => sum + item.open, 0)} selected={subject === ALL} onClick={() => chooseClass(ALL)} />
                {classTabs.map((item) => <ClassTab key={item.subject} label={item.label} fullName={item.subject} count={item.open} selected={subject === item.subject} onClick={() => chooseClass(item.subject)} />)}
              </div>
            ) : (
              <div role="tablist" aria-label="Teachers" className="lk-teacher-switcher flex gap-2 overflow-x-auto pb-1">
                <ClassTab label="All teachers" count={teacherTabs.reduce((sum, item) => sum + item.open, 0)} selected={teacher === ALL} onClick={() => chooseTeacher(ALL)} />
                {teacherTabs.map((item) => <ClassTab key={item.teacher} label={item.teacher} fullName={`${item.subjects.size} class${item.subjects.size === 1 ? '' : 'es'}`} count={item.open} selected={teacher === item.teacher} onClick={() => chooseTeacher(item.teacher)} />)}
              </div>
            )}
            {browseTabs === 'teacher' && teacherTabs.some((item) => item.teacher === 'Teacher not set') && <p className="mt-1.5 text-caption lk-muted">Teacher names come from each local class dashboard. Unset classes stay together without LockIn guessing.</p>}
          </div>
        )}

        {browseTabs === 'class' && subject !== ALL && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border lk-border lk-sunken px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-body font-bold lk-strong">{subject}</p>
              <p className="text-caption lk-muted">
                {selectedOpen} open · {selectedNeedsReview} to review. Open Grades, then Check Canvas
                to update scores and statuses.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRenamingClass(subject);
                  setClassNameDraft(classSwitchLabel(subject));
                }}
              >
                Clean up name
              </Button>
              {selectedGradesUrl && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Icon name="external" size={14} />}
                onClick={() => void openInCanvas(selectedGradesUrl)}
              >
                Open Grades
              </Button>
              )}
            </div>
          </div>
        )}

        {browseTabs === 'teacher' && teacher !== ALL && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border lk-border lk-sunken px-4 py-3">
            <div className="min-w-0"><p className="truncate text-body font-bold lk-strong">{teacher}</p><p className="text-caption lk-muted">{teacherTabs.find((item) => item.teacher === teacher)?.subjects.size ?? 0} class{(teacherTabs.find((item) => item.teacher === teacher)?.subjects.size ?? 0) === 1 ? '' : 'es'} · {teacherTabs.find((item) => item.teacher === teacher)?.open ?? 0} open assignments</p></div>
            {teacher !== 'Teacher not set' && (() => { const firstSubject = [...(teacherTabs.find((item) => item.teacher === teacher)?.subjects ?? [])][0]; return firstSubject ? <Button size="sm" variant="ghost" onClick={() => navigate(`/class/${encodeURIComponent(firstSubject)}`)}>Open teacher details</Button> : null; })()}
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 lk-muted"
            />
            <TextInput
              value={query}
              placeholder="Search title or subject…"
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              aria-label="Search assignments"
            />
          </div>
          {/*
            List or class sections. Class sections are the calm default; list
            view remains for scanning one flat deadline queue.
          */}
          <Chip
            active={layout === 'class'}
            onClick={() => {
              const next = layout === 'class' ? 'list' : 'class';
              setLayout(next);
              try {
                localStorage.setItem('lockin.assignments.layout', next);
              } catch {
                /* a blocked storage is not worth breaking the page over */
              }
            }}
            aria-pressed={layout === 'class'}
          >
            {layout === 'class' ? 'Grouped cards' : 'Flat list'}
          </Chip>
          <Chip
            onClick={() => setShowFilters((open) => !open)}
            aria-expanded={showFilters}
          >
            Filters{filtersOn ? ' ·' : ''}
          </Chip>
          {filtersOn && (
            <Chip
              onClick={() => {
                setQuery('');
                setPlatform(ALL);
                setPriority(ALL);
              }}
            >
              Clear
            </Chip>
          )}
        </div>

        {showFilters && (
          <div className="animate-fade mt-2.5 grid gap-2.5 sm:grid-cols-2">
            <Select
              value={platform}
              options={[ALL, ...PLATFORMS]}
              onChange={(e) => setPlatform(e.target.value)}
              aria-label="Filter by platform"
            />
            <Select
              value={priority}
              options={[ALL, ...PRIORITIES]}
              onChange={(e) => setPriority(e.target.value)}
              aria-label="Filter by priority"
            />
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        state.assignments.length === 0 ? (
          /* An empty list is the best place in the app to offer Canvas — it is
             the moment the offer is relevant, and the space is doing nothing
             else. The old copy named Canvas in prose and gave no way to reach
             it, which is the "mention without a path" the research warns
             about. */
          <div className="space-y-4">
            <EmptyState
              icon={<Icon name="list" size={28} />}
              title="No assignments yet"
              hint="Type what you owe in the box above — that is the whole thing."
            />
            <CanvasCallout variant="empty" />
          </div>
        ) : (
          <EmptyState
            icon={<Icon name="check" size={28} />}
            title={EMPTY_TITLES[view]}
            hint={filtersOn ? 'Try clearing the filters.' : EMPTY_HINTS[view]}
          />
        )
      ) : (
        <section aria-live="polite">
          <SectionHeader
            title={`${horizon ? (horizon === 'parking' ? 'Parking lot' : `${horizon.charAt(0).toUpperCase()}${horizon.slice(1)}`) : VIEWS.find((v) => v.id === view)?.label} (${shown.length})`}
            hint={
              horizon
                ? 'A calm time horizon from Home.'
                : layout === 'class'
                ? browseTabs === 'teacher' && teacher !== ALL ? `Filtered to ${teacher}, then grouped by class.` : 'Grouped by class, most urgent class first.'
                : 'Most urgent first.'
            }
            action={horizon ? <button type="button" className="text-caption font-extrabold lk-muted hover:underline" onClick={() => { const next = new URLSearchParams(params); next.delete('horizon'); setParams(next, { replace: true }); }}>Show normal views</button> : undefined}
          />

          {layout === 'class' ? (
            /*
              One section per class. A full-width section keeps a class
              together without producing narrow newspaper columns.
            */
            <div className="lk-stagger space-y-5">
              {groupByClass(shown, now).map((group) => {
                const style = classStyle(state.settings.schoolSchedule, group.subject);
                return (
                <div
                  key={group.subject}
                  className={cx('lk-assignment-group lk-class-pattern min-w-0 rounded-2xl border lk-border p-3 sm:p-4', `lk-class-theme-${style?.color ?? 'brand'}`)}
                >
                  <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
                    <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => navigate(`/class/${encodeURIComponent(group.subject)}`)} aria-label={`Open ${group.subject} dashboard`}><span className="lk-class-icon grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[0.62rem] font-black text-white">{style?.icon ?? group.subject.slice(0, 1).toUpperCase()}</span><h3 className="truncate text-heading font-extrabold lk-strong">{group.subject}</h3></button>
                    <span className="shrink-0 text-caption tabular-nums lk-muted">
                      {/* The class's own grade, when one has been read. It
                          belongs here rather than only on /grades: "how am I
                          doing in this class" and "what do I owe it" are the
                          same glance. */}
                      {gradeFor(group.subject)}
                      {group.assignments.length}
                    </span>
                  </div>
                  <div className="grid items-start gap-2 lg:grid-cols-2">
                    {group.assignments.map((a) => renderCard(a))}
                  </div>
                </div>
              );})}
            </div>
          ) : (
            <div className="space-y-2.5">{shown.map((a) => renderCard(a))}</div>
          )}
        </section>
      )}

      <Modal open={creating} title="New assignment" onClose={() => setCreating(false)} wide>
        <AssignmentForm
          submitLabel="Add assignment"
          onCancel={() => setCreating(false)}
          onSubmit={(draft) => {
            dispatch({ type: 'ADD_ASSIGNMENT', assignment: createAssignment(draft) });
            setCreating(false);
            toast('Assignment added.', 'success');
          }}
        />
      </Modal>

      <Modal
        open={!!editing}
        title="Edit assignment"
        onClose={() => setEditing(null)}
        wide
      >
        {editing && (
          <AssignmentForm
            key={editing.id}
            initial={editing}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={(draft) => {
              const before = editing;
              dispatch({
                type: 'UPDATE_ASSIGNMENT',
                id: editing.id,
                patch: {
                  title: draft.title.trim(),
                  subject: draft.subject.trim() || 'General',
                  platform: draft.platform,
                  dueDate: draft.dueDate,
                  dueTime: draft.dueTime,
                  estimatedMinutes: draft.estimatedMinutes,
                  priority: draft.priority,
                  status: draft.status,
                  completedAt: draft.status === 'Completed' ? new Date().toISOString() : undefined,
                  reminders: {
                    firstReminderMinutes: draft.firstReminderMinutes ?? 120,
                    escalationMinutes: draft.escalationMinutes ?? 60,
                    focusWarningMinutes: draft.focusWarningMinutes ?? 30,
                    enabled: editing.reminders.enabled,
                  },
                  steps: draft.steps?.map((text, index) => {
                    const existing = editing.steps.find((step) => step.text === text);
                    return existing ?? { id: `step-${Date.now()}-${index}`, text, done: false };
                  }) ?? [],
                },
              });
              setEditing(null);
              toast('Changes saved.', 'success', {
                label: 'Undo',
                run: () => dispatch({ type: 'UPDATE_ASSIGNMENT', id: before.id, patch: before }),
              });
            }}
          />
        )}
      </Modal>

      <CanvasLinkModal
        open={!!linking}
        assignment={linking}
        onClose={() => setLinking(null)}
      />

      <Modal open={!!renamingClass} title="Clean up class name" onClose={() => setRenamingClass(null)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const next = classNameDraft.trim();
            if (!renamingClass || !next) return;
            const previous = renamingClass;
            const movedIds = state.assignments
              .filter((assignment) => assignment.subject === previous)
              .map((assignment) => assignment.id);
            dispatch({ type: 'RENAME_CLASS', from: previous, to: next, ids: movedIds });
            setRenamingClass(null);
            chooseClass(next);
            toast(`Class renamed to “${next}”.`, 'success', {
              label: 'Undo',
              run: () => dispatch({ type: 'RENAME_CLASS', from: next, to: previous, ids: movedIds }),
            });
          }}
        >
          <p className="text-body lk-muted">
            This changes the label in LockIn only. Using an existing class name merges the two lists.
          </p>
          <TextInput value={classNameDraft} onChange={(e) => setClassNameDraft(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRenamingClass(null)}>Cancel</Button>
            <Button type="submit" aria-label="Save class name">Save name</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        danger
        title="Delete this assignment?"
        confirmLabel="Delete"
        message={
          <>
            <strong className="lk-strong">{deleting?.title}</strong> will be removed from this
            device. You can undo right after deleting it.
            {state.focusMode.active && state.focusMode.requiredTaskIds.includes(deleting?.id ?? '') && (
              <span className="mt-2 block font-semibold text-flame-600 dark:text-flame-400">
                It’s a required task for the active Focus Mode — the requirement will shrink by one.
              </span>
            )}
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const removed = deleting;
          const wasRequired = !!removed && state.focusMode.requiredTaskIds.includes(removed.id);
          if (removed) dispatch({ type: 'DELETE_ASSIGNMENT', id: removed.id });
          setDeleting(null);
          toast('Assignment deleted.', 'info', removed ? {
            label: 'Undo',
            run: () => dispatch({
              type: 'RESTORE_ASSIGNMENT',
              assignment: removed,
              requiredInFocus: wasRequired,
            }),
          } : undefined);
        }}
      />
    </div>
  );
}

function ClassTab({
  label,
  fullName,
  count,
  selected,
  onClick,
}: {
  label: string;
  fullName?: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title={fullName && fullName !== label ? fullName : undefined}
      onClick={onClick}
      className={cx(
        'lk-class-tab inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-caption font-bold transition-all',
        selected
          ? 'border-brand-500 bg-brand-600 text-white shadow-sm'
          : 'lk-border lk-raised lk-strong hover:border-brand-400',
      )}
    >
      <span>{label}</span>
      <span
        className={cx(
          'rounded-full px-1.5 py-0.5 text-[0.65rem] tabular-nums',
          selected ? 'bg-white/20 text-white' : 'lk-sunken lk-muted',
        )}
      >
        {count}
      </span>
    </button>
  );
}
