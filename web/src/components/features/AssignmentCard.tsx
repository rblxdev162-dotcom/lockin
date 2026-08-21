import type { Assignment } from '../../types';
import { PriorityBadge, Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { formatDue, parseDueDate } from '../../lib/time';
import { cx } from '../../lib/cx';
import { SourceBadge } from '../ui/Status';
import { WORK_STATE_LABEL, WORK_STATE_TONE, isSettled, workStateOf } from '../../lib/workState';
import { CanvasStatusBadge } from './CanvasStatusBadge';

export function AssignmentCard({
  assignment,
  required,
  onToggleComplete,
  onEdit,
  onDelete,
  onFocus,
  onOpenCanvas,
  onCheckCanvas,
  onLinkCanvas,
  onToggleStep,
  canvasBusy,
  now,
}: {
  assignment: Assignment;
  now: number;
  required?: boolean;
  onToggleComplete?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onFocus?: () => void;
  onOpenCanvas?: (assignment: Assignment) => void;
  onCheckCanvas?: (assignment: Assignment) => void;
  onLinkCanvas?: () => void;
  onToggleStep?: (stepId: string) => void;
  canvasBusy?: boolean;
}) {
  const done = assignment.status === 'Completed';
  const canvas = assignment.canvas;
  /**
   * Canvas-verified work is not completed by ticking a box — the whole point is
   * that Canvas provides the evidence. The checkbox is therefore hidden for
   * Canvas-linked assignments and replaced by Check Canvas Status.
   */
  const canvasControlled = !!canvas && (assignment.completionMethod === 'canvas' || isSettled(workStateOf(assignment, now)));
  const verificationControlled = canvasControlled;
  /**
   * The state, in one word.
   *
   * This is the difference the old card could not express: graded work,
   * submitted-but-unmarked work, and work the student ticked off themselves
   * all looked identical. Canvas's own word wins where it has one.
   */
  const state = workStateOf(assignment, now);
  const dueLabel =
    state === 'needs_sync'
      ? staleDueLabel(assignment)
      : formatDue(assignment.dueDate, assignment.dueTime);

  return (
    <div
      className={cx(
        'lk-assignment-card lk-card lk-interactive group flex gap-3.5 p-4',
        // Completed work fades rather than vanishing: it is still evidence of
        // a finished day, and a list that empties itself gives no credit.
        done && 'opacity-55',
        required && !done && 'border-brand-400 ring-1 ring-brand-400/40',
      )}
    >
      {verificationControlled ? (
        <span
          title="Completed through Canvas verification"
          className={cx(
            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2',
            done ? 'border-mint-500 bg-mint-500 text-white' : 'lk-border lk-muted',
          )}
        >
          {done ? (
            <Icon name="check" size={13} strokeWidth={3} />
          ) : (
            <Icon name="canvas" size={12} />
          )}
        </span>
      ) : onToggleComplete ? (
        <button
          onClick={onToggleComplete}
          aria-label={done ? `Mark ${assignment.title} not done` : `Mark ${assignment.title} done`}
          className={cx(
            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 transition-all active:scale-90',
            done
              ? 'border-mint-500 bg-mint-500 text-white'
              : 'lk-border hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/40',
          )}
        >
          {done && <Icon name="check" size={13} strokeWidth={3} />}
        </button>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold tracking-wide text-brand-600 uppercase dark:text-brand-300">
            {assignment.subject}
          </span>
          {required && !done && <Badge tone="brand">Required</Badge>}
        </div>

        <p className={cx('mt-0.5 font-bold lk-strong', done && 'line-through')}>
          {assignment.title}
        </p>

        {/*
          One line of facts, in the order they are asked for: when, how long,
          where it came from. The platform, priority and status badges that used
          to sit above this are gone from the row — three coloured pills per row
          turned a list of twelve into a legend, and each is still on the detail
          view where somebody is actually asking.
        */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption lk-muted">
          <span
            className={cx(
              WORK_STATE_TONE[state],
              'lk-status-chip rounded-full px-2 py-0.5 font-bold',
            )}
          >
            {WORK_STATE_LABEL[state]}
          </span>
          <span
            className={cx(
              (state === 'overdue' || state === 'missing') &&
                'lk-status-behind lk-status-text font-bold',
            )}
          >
            {dueLabel}
          </span>
          <span>~{assignment.estimatedMinutes} min</span>
          {assignment.loggedMinutes > 0 && (
            <span className="text-mint-600 dark:text-mint-400">
              {assignment.loggedMinutes} min logged
            </span>
          )}
          <SourceBadge source={assignment.source} />
          {assignment.priority !== 'Normal' && <PriorityBadge priority={assignment.priority} />}
        </div>

        {canvas && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t lk-border pt-2.5">
            <CanvasStatusBadge link={canvas} />
            {onOpenCanvas && (
              <button
                onClick={() => onOpenCanvas(assignment)}
                className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline dark:text-brand-300"
              >
                <Icon name="external" size={13} />
                Open in Canvas
              </button>
            )}
            {onCheckCanvas && !done && (
              <button
                onClick={() => onCheckCanvas(assignment)}
                disabled={canvasBusy}
                className="inline-flex items-center gap-1 text-xs font-bold lk-muted transition-colors hover:lk-strong disabled:opacity-50"
              >
                <Icon name="refresh" size={13} className={canvasBusy ? 'animate-spin' : undefined} />
                {canvasBusy ? 'Checking…' : 'Check Canvas Status'}
              </button>
            )}
          </div>
        )}


        {!canvas && onLinkCanvas && (
          <button
            onClick={onLinkCanvas}
            className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold lk-muted transition-colors hover:text-brand-600 dark:hover:text-brand-300"
          >
            <Icon name="link" size={13} />
            Link to Canvas Assignment
          </button>
        )}

        {assignment.steps.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t lk-border pt-2.5">
            {assignment.steps.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={() => onToggleStep?.(step.id)}
                className="flex w-full items-center gap-2 text-left text-caption lk-muted hover:lk-strong"
              >
                <span className={cx('grid h-4 w-4 shrink-0 place-items-center rounded border', step.done ? 'border-mint-500 bg-mint-500 text-white' : 'lk-border')}>
                  {step.done && <Icon name="check" size={10} />}
                </span>
                <span className={cx(step.done && 'line-through opacity-60')}>{step.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {onFocus && !done && (
          <button
            onClick={onFocus}
            title="Start a focus session"
            aria-label={`Start a focus session on ${assignment.title}`}
            className="rounded-lg p-1.5 lk-muted transition-colors hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-900/40 dark:hover:text-brand-300"
          >
            <Icon name="timer" size={17} />
          </button>
        )}
        {onEdit && (
          <button
            onClick={onEdit}
            title="Edit"
            aria-label={`Edit ${assignment.title}`}
            className="rounded-lg p-1.5 lk-muted transition-colors hover:lk-sunken hover:lk-strong"
          >
            <Icon name="edit" size={17} />
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete"
            aria-label={`Delete ${assignment.title}`}
            className="rounded-lg p-1.5 lk-muted transition-colors hover:bg-flame-400/15 hover:text-flame-600"
          >
            <Icon name="trash" size={17} />
          </button>
        )}
      </div>
    </div>
  );
}

function staleDueLabel(assignment: Assignment): string {
  const due = parseDueDate(assignment.dueDate, assignment.dueTime);
  if (!due) return 'Date needs checking';
  return `Was due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · sync to confirm`;
}
