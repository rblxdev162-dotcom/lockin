import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../store/context';
import { Card, EmptyState } from '../components/ui/Card';
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
import { byUrgency, groupByClass, isSettled, workStateOf } from '../lib/workState';
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

const ALL = 'All';

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
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const requestedClass = params.get('class')?.trim() || ALL;
  const [subject, setSubject] = useState<string>(requestedClass);
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
        if (subject !== ALL && (a.subject?.trim() || 'No class') !== subject) return false;
        if (q && !`${a.title} ${a.subject}`.toLowerCase().includes(q)) return false;
        return true;
      }),
      now,
    );
  }, [state.assignments, query, platform, priority, subject, now]);

  /** Counts for the tabs, computed once rather than per tab. */
  const buckets = useMemo(() => {
    const out: Record<ViewId, Assignment[]> = { next: [], overdue: [], upcoming: [], done: [] };
    for (const assignment of matching) out[viewOf(assignment, now)].push(assignment);
    // Finished work reads newest-first: the useful question there is "what did
    // I just finish", not "what was due first".
    out.done.reverse();
    return out;
  }, [matching, now]);

  const shown = buckets[view];
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

  const chooseClass = (next: string) => {
    setSubject(next);
    const classAssignments =
      next === ALL
        ? state.assignments
        : state.assignments.filter((a) => (a.subject?.trim() || 'No class') === next);
    setView(initialView(classAssignments, now));
    const nextParams = new URLSearchParams(params);
    if (next === ALL) nextParams.delete('class');
    else nextParams.set('class', next);
    setParams(nextParams, { replace: true });
  };

  const selectedClassAssignments =
    subject === ALL
      ? []
      : state.assignments.filter((a) => (a.subject?.trim() || 'No class') === subject);
  const selectedGradesUrl = selectedClassAssignments
    .map((a) => classGradesUrl(a.canvas?.url, state.canvas.connection?.domain ?? null))
    .find((url): url is string => url !== null) ?? null;

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
          return;
        }
        dispatch({ type: 'COMPLETE_ASSIGNMENT', id: a.id, method: 'manual' });
        toast(`“${a.title}” marked complete.`, 'success');
      }}
      onEdit={() => setEditing(a)}
      onDelete={() => setDeleting(a)}
      onFocus={isComplete(a) ? undefined : () => navigate(`/focus?assignment=${a.id}`)}
      onOpenCanvas={(x) => x.canvas && openInCanvas(x.canvas.url)}
      onCheckCanvas={isComplete(a) ? undefined : checkStatus}
      canvasBusy={canvasBusy === 'check' || canvasBusy === 'sync'}
      onLinkCanvas={canvasConnected && !a.canvas && !isComplete(a) ? () => setLinking(a) : undefined}
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

        {classTabs.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-caption font-bold tracking-wide lk-muted uppercase">
              Switch class
            </p>
            <div
              role="tablist"
              aria-label="Classes"
              className="lk-class-switcher flex gap-2 overflow-x-auto pb-1"
            >
              <ClassTab
                label="All classes"
                count={classTabs.reduce((sum, item) => sum + item.open, 0)}
                selected={subject === ALL}
                onClick={() => chooseClass(ALL)}
              />
              {classTabs.map((item) => (
                <ClassTab
                  key={item.subject}
                  label={item.label}
                  fullName={item.subject}
                  count={item.open}
                  selected={subject === item.subject}
                  onClick={() => chooseClass(item.subject)}
                />
              ))}
            </div>
          </div>
        )}

        {subject !== ALL && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border lk-border lk-sunken px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-body font-bold lk-strong">{subject}</p>
              <p className="text-caption lk-muted">
                Open this class’s Grades page, then Check Canvas to update scores and statuses.
              </p>
            </div>
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
            By class
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
            title={`${VIEWS.find((v) => v.id === view)?.label} (${shown.length})`}
            hint={
              layout === 'class'
                ? 'Grouped by class, most urgent class first.'
                : 'Most urgent first.'
            }
          />

          {layout === 'class' ? (
            /*
              One section per class. A full-width section keeps a class
              together without producing narrow newspaper columns.
            */
            <div className="lk-stagger space-y-5">
              {groupByClass(shown, now).map((group) => (
                <div
                  key={group.subject}
                  className="lk-assignment-group min-w-0 rounded-2xl border lk-border p-3 sm:p-4"
                >
                  <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
                    <h3 className="truncate text-heading font-extrabold lk-strong">
                      {group.subject}
                    </h3>
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
              ))}
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
                },
              });
              setEditing(null);
              toast('Changes saved.', 'success');
            }}
          />
        )}
      </Modal>

      <CanvasLinkModal
        open={!!linking}
        assignment={linking}
        onClose={() => setLinking(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        danger
        title="Delete this assignment?"
        confirmLabel="Delete"
        message={
          <>
            <strong className="lk-strong">{deleting?.title}</strong> will be removed from this
            device. This can’t be undone.
            {state.focusMode.active && state.focusMode.requiredTaskIds.includes(deleting?.id ?? '') && (
              <span className="mt-2 block font-semibold text-flame-600 dark:text-flame-400">
                It’s a required task for the active Focus Mode — the requirement will shrink by one.
              </span>
            )}
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) dispatch({ type: 'DELETE_ASSIGNMENT', id: deleting.id });
          setDeleting(null);
          toast('Assignment deleted.', 'info');
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
