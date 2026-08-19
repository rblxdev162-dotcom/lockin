import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../store/context';
import { Card, EmptyState } from '../components/ui/Card';
import { Chip, Select, TextInput } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { AssignmentCard } from '../components/features/AssignmentCard';
import { AssignmentForm } from '../components/features/AssignmentForm';
import { createAssignment } from '../store/factories';
import type { Assignment } from '../types';
import { PLATFORMS, PRIORITIES } from '../types';
import { dueTimestamp, isComplete, sortByDue } from '../lib/selectors';
import { SectionHeader } from '../components/ui/Status';
import { cx } from '../lib/cx';
import { toast } from '../components/ui/Toast';
import { useCanvas } from '../hooks/useCanvas';
import { CanvasLinkModal } from '../components/features/CanvasLinkModal';
import { QuickAdd } from '../components/features/QuickAdd';
import { CanvasCallout } from '../components/features/CanvasCallout';

const ALL = 'All';

/**
 * The four views a student actually thinks in.
 *
 * These replaced a status dropdown and a priority dropdown. A dropdown makes
 * you name the thing you want before you can see it; a tab shows you what is
 * there. `overdue` comes second rather than last because it is the one people
 * open the page to check.
 */
const VIEWS = [
  { id: 'today', label: 'Today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];

const DAY = 86_400_000;

/** Empty states say what is true, not that a filter returned nothing. */
const EMPTY_TITLES: Record<ViewId, string> = {
  today: 'Nothing due today',
  overdue: 'Nothing overdue',
  upcoming: 'Nothing coming up',
  completed: 'Nothing finished yet',
};

/** The first view with work in it, in priority order. */
export function initialView(assignments: Assignment[], now: number): ViewId {
  const counts: Record<ViewId, number> = { today: 0, overdue: 0, upcoming: 0, completed: 0 };
  for (const assignment of assignments) counts[viewOf(assignment, now)] += 1;
  if (counts.overdue > 0) return 'overdue';
  if (counts.today > 0) return 'today';
  if (counts.upcoming > 0) return 'upcoming';
  return 'today';
}

const EMPTY_HINTS: Record<ViewId, string> = {
  today: 'Check Upcoming to get ahead.',
  overdue: 'Everything with a due date is still in time.',
  upcoming: 'Connect Canvas and your week fills itself in.',
  completed: 'Finished work collects here.',
};

/** Which view an assignment belongs to. One assignment, one view. */
function viewOf(assignment: Assignment, now: number): ViewId {
  if (isComplete(assignment)) return 'completed';
  const due = dueTimestamp(assignment);

  // Undated work sits in Today, not Upcoming.
  //
  // `dueTimestamp` returns MAX_SAFE_INTEGER when there is no due date, which
  // would file it at the far end of Upcoming — the one place nobody looks.
  // Phase 9's rule was that undated work is real work; hiding it behind a tab
  // is the same mistake as refusing to accept it without a date.
  if (!Number.isFinite(due) || due === Number.MAX_SAFE_INTEGER) return 'today';

  if (due < now) return 'overdue';
  // "Today" is the rest of today plus tonight's work — anything due before
  // tomorrow ends, which is what a student means when they ask what is due.
  const endOfTomorrow = new Date(now);
  endOfTomorrow.setHours(23, 59, 59, 999);
  return due <= endOfTomorrow.getTime() + DAY ? 'today' : 'upcoming';
}

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
  const [view, setView] = useState<ViewId>(() => initialView(state.assignments, Date.now()));
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
    return sortByDue(
      state.assignments.filter((a) => {
        if (platform !== ALL && a.platform !== platform) return false;
        if (priority !== ALL && a.priority !== priority) return false;
        if (q && !`${a.title} ${a.subject}`.toLowerCase().includes(q)) return false;
        return true;
      }),
    );
  }, [state.assignments, query, platform, priority]);

  /** Counts for the tabs, computed once rather than per tab. */
  const buckets = useMemo(() => {
    const out: Record<ViewId, Assignment[]> = { today: [], overdue: [], upcoming: [], completed: [] };
    for (const assignment of matching) out[viewOf(assignment, now)].push(assignment);
    // Completed reads newest-first: the useful question there is "what did I
    // just finish", not "what was due first".
    out.completed.reverse();
    return out;
  }, [matching, now]);

  const shown = buckets[view];
  const filtersOn = platform !== ALL || priority !== ALL || query.trim() !== '';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-extrabold lk-strong">Assignments</h1>
          <p className="mt-1 text-body lk-muted">
            {state.assignments.length} total ·{' '}
            {buckets.today.length + buckets.overdue.length + buckets.upcoming.length} unfinished
          </p>
        </div>

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
        <section className="space-y-2.5" aria-live="polite">
          <SectionHeader
            title={`${VIEWS.find((v) => v.id === view)?.label} (${shown.length})`}
          />
          {shown.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
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
          ))}
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
