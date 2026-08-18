import type { Assignment } from '../../types';
import { PlatformBadge, PriorityBadge, StatusBadge, Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { formatDue, parseDueDate } from '../../lib/time';
import { cx } from '../../lib/cx';
import { CanvasStatusBadge } from './CanvasStatusBadge';
import { EdgenuityPanel } from './EdgenuityPanel';

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
  canvasBusy,
}: {
  assignment: Assignment;
  required?: boolean;
  onToggleComplete?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onFocus?: () => void;
  onOpenCanvas?: (assignment: Assignment) => void;
  onCheckCanvas?: (assignment: Assignment) => void;
  onLinkCanvas?: () => void;
  canvasBusy?: boolean;
}) {
  const done = assignment.status === 'Completed';
  const canvas = assignment.canvas;
  /**
   * Canvas-verified work is not completed by ticking a box — the whole point is
   * that Canvas provides the evidence. The checkbox is therefore hidden for
   * Canvas-linked assignments and replaced by Check Canvas Status.
   */
  const canvasControlled = !!canvas && assignment.completionMethod === 'canvas';
  /**
   * Same reasoning for Edgenuity: an assignment whose completion is supposed to
   * come from photographed progress must not be completable by ticking a box.
   */
  const edgenuityControlled = !!assignment.edgenuity;
  const verificationControlled = canvasControlled || edgenuityControlled;
  const due = parseDueDate(assignment.dueDate, assignment.dueTime);
  const isOverdue = !done && !!due && due.getTime() < Date.now();

  return (
    <div
      className={cx(
        'lk-card group flex gap-3.5 p-4 transition-all',
        done && 'opacity-60',
        required && !done && 'border-brand-400 ring-1 ring-brand-400/40',
      )}
    >
      {verificationControlled ? (
        <span
          title={
            canvasControlled
              ? 'Completed through Canvas verification'
              : 'Completed through Edgenuity screen verification'
          }
          className={cx(
            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2',
            done ? 'border-mint-500 bg-mint-500 text-white' : 'lk-border lk-muted',
          )}
        >
          {done ? (
            <Icon name="check" size={13} strokeWidth={3} />
          ) : (
            <Icon name={canvasControlled ? 'canvas' : 'edgenuity'} size={12} />
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

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PlatformBadge platform={assignment.platform} />
          <PriorityBadge priority={assignment.priority} />
          <StatusBadge status={assignment.status} />
          {isOverdue && <Badge tone="flame">Overdue</Badge>}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs lk-muted">
          <span className={cx(isOverdue && 'font-bold text-flame-600 dark:text-flame-400')}>
            {formatDue(assignment.dueDate, assignment.dueTime)}
          </span>
          <span>~{assignment.estimatedMinutes} min</span>
          {assignment.loggedMinutes > 0 && (
            <span className="text-mint-600 dark:text-mint-400">
              {assignment.loggedMinutes} min logged
            </span>
          )}
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
                <Icon name="refresh" size={13} />
                {canvasBusy ? 'Checking…' : 'Check Canvas Status'}
              </button>
            )}
          </div>
        )}

        {/* Edgenuity verification is offered on Edgenuity work only — every
            other card would just be carrying an option it can't use. */}
        {!canvas && (assignment.edgenuity || assignment.platform === 'Edgenuity') && (
          <div className="mt-2.5">
            <EdgenuityPanel assignment={assignment} />
          </div>
        )}

        {!canvas && !assignment.edgenuity && onLinkCanvas && (
          <button
            onClick={onLinkCanvas}
            className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold lk-muted transition-colors hover:text-brand-600 dark:hover:text-brand-300"
          >
            <Icon name="link" size={13} />
            Link to Canvas Assignment
          </button>
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
