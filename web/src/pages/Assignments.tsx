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
import { PLATFORMS, PRIORITIES, STATUSES } from '../types';
import { sortByDue } from '../lib/selectors';
import { toast } from '../components/ui/Toast';
import { useCanvas } from '../hooks/useCanvas';
import { CanvasLinkModal } from '../components/features/CanvasLinkModal';
import { QuickAdd } from '../components/features/QuickAdd';
import { CanvasCallout } from '../components/features/CanvasCallout';

const ALL = 'All';

export function AssignmentsPage() {
  const { state, dispatch } = useApp();
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
  const [status, setStatus] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);

  // Deep link from the dashboard: /assignments?new=1
  useEffect(() => {
    if (params.get('new')) {
      setCreating(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortByDue(
      state.assignments.filter((a) => {
        if (platform !== ALL && a.platform !== platform) return false;
        if (status !== ALL && a.status !== status) return false;
        if (priority !== ALL && a.priority !== priority) return false;
        if (q && !`${a.title} ${a.subject}`.toLowerCase().includes(q)) return false;
        return true;
      }),
    );
  }, [state.assignments, query, platform, status, priority]);

  const active = filtered.filter((a) => a.status !== 'Completed');
  const done = filtered.filter((a) => a.status === 'Completed');
  const filtersOn = platform !== ALL || status !== ALL || priority !== ALL || query.trim() !== '';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight lk-strong">Assignments</h1>
          <p className="mt-1 text-sm lk-muted">
            {state.assignments.length} total · {active.length} unfinished
          </p>
        </div>

      </header>

      <CanvasCallout />

      <Card>
        <QuickAdd onOpenFull={() => setCreating(true)} autoFocus={state.assignments.length === 0} />
      </Card>

      <Card>
        <div className="relative">
          <Icon
            name="search"
            size={17}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 lk-muted"
          />
          <TextInput
            value={query}
            placeholder="Search title or subject…"
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          <Select
            value={platform}
            options={[ALL, ...PLATFORMS]}
            onChange={(e) => setPlatform(e.target.value)}
            aria-label="Filter by platform"
          />
          <Select
            value={status}
            options={[ALL, ...STATUSES]}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
          />
          <Select
            value={priority}
            options={[ALL, ...PRIORITIES]}
            onChange={(e) => setPriority(e.target.value)}
            aria-label="Filter by priority"
          />
        </div>

        {filtersOn && (
          <div className="mt-3">
            <Chip
              onClick={() => {
                setQuery('');
                setPlatform(ALL);
                setStatus(ALL);
                setPriority(ALL);
              }}
            >
              Clear filters
            </Chip>
          </div>
        )}
      </Card>

      {filtered.length === 0 ? (
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
            icon={<Icon name="list" size={28} />}
            title="Nothing matches"
            hint="Try clearing the filters."
          />
        )
      ) : (
        <div className="space-y-5">
          {active.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-xs font-bold tracking-wide lk-muted uppercase">
                Unfinished ({active.length})
              </h2>
              {active.map((a) => (
                <AssignmentCard
                  key={a.id}
                  assignment={a}
                  required={state.focusMode.active && state.focusMode.requiredTaskIds.includes(a.id)}
                  onToggleComplete={() => {
                    dispatch({ type: 'COMPLETE_ASSIGNMENT', id: a.id, method: 'manual' });
                    toast(`“${a.title}” marked complete.`, 'success');
                  }}
                  onEdit={() => setEditing(a)}
                  onDelete={() => setDeleting(a)}
                  onFocus={() => navigate(`/focus?assignment=${a.id}`)}
                  onOpenCanvas={(x) => x.canvas && openInCanvas(x.canvas.url)}
                  onCheckCanvas={checkStatus}
                  canvasBusy={canvasBusy === 'check' || canvasBusy === 'sync'}
                  onLinkCanvas={canvasConnected && !a.canvas ? () => setLinking(a) : undefined}
                />
              ))}
            </section>
          )}

          {done.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-xs font-bold tracking-wide lk-muted uppercase">
                Completed ({done.length})
              </h2>
              {done.map((a) => (
                <AssignmentCard
                  key={a.id}
                  assignment={a}
                  onToggleComplete={() => dispatch({ type: 'UNCOMPLETE_ASSIGNMENT', id: a.id })}
                  onEdit={() => setEditing(a)}
                  onDelete={() => setDeleting(a)}
                  onOpenCanvas={(x) => x.canvas && openInCanvas(x.canvas.url)}
                />
              ))}
            </section>
          )}
        </div>
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
