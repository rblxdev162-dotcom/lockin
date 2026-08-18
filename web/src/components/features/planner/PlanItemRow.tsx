/**
 * One line of a plan: what to work on, for how long, and why.
 *
 * The Start button hands the item straight to the existing focus timer — there
 * is no second timer, and no second completion path. Everything this component
 * can do is either "start the session you already have" or "tell the planner
 * something changed".
 */
import { useState } from 'react';
import type { PlannedWorkItem } from '../../../types';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { cx } from '../../../lib/cx';
import { explainItem, formatMinutes, itemTimeRange } from '../../../lib/planner/explanations';

const STATUS_TONE = {
  planned: 'neutral',
  in_progress: 'brand',
  completed: 'mint',
  missed: 'amber',
  rescheduled: 'brand',
} as const;

const STATUS_LABEL = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Done',
  missed: 'Not done',
  rescheduled: 'Moved',
} as const;

export function PlanItemRow({
  item,
  onStart,
  onSkip,
  onMove,
  canMoveUp,
  canMoveDown,
  compact,
}: {
  item: PlannedWorkItem;
  onStart?: () => void;
  onSkip?: () => void;
  onMove?: (direction: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  compact?: boolean;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const time = itemTimeRange(item);
  const done = item.status === 'completed';

  return (
    <div
      className={cx(
        'lk-sunken rounded-2xl border lk-border p-3.5',
        done && 'opacity-70',
        item.status === 'missed' && 'border-amber-400/50',
      )}
      data-plan-item={item.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {time && (
              <span className="font-mono text-xs font-bold tabular-nums lk-muted">{time}</span>
            )}
            <Badge tone={item.sourceType === 'exam' ? 'amber' : 'brand'}>
              {item.sourceType === 'exam' ? 'Exam study' : 'Assignment'}
            </Badge>
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
          </div>

          <p
            className={cx(
              'mt-1.5 truncate text-sm font-bold lk-strong',
              done && 'line-through',
            )}
          >
            {item.title}
            {item.finalReview && ' — Final review'}
          </p>
          <p className="truncate text-xs lk-muted">
            {item.subject} · {formatMinutes(item.plannedMinutes)}
            {item.chunkCount > 1 && ` · session ${item.chunkIndex} of ${item.chunkCount}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onMove && (
            <div className="flex flex-col">
              <button
                type="button"
                aria-label={`Move ${item.title} earlier`}
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
                className="rounded px-1 text-xs lk-muted hover:lk-strong disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${item.title} later`}
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
                className="rounded px-1 text-xs lk-muted hover:lk-strong disabled:opacity-30"
              >
                ▼
              </button>
            </div>
          )}
          {onStart && !done && (
            <Button size="sm" icon={<Icon name="play" size={14} />} onClick={onStart}>
              Start
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => setShowWhy((v) => !v)}
          className="text-xs font-bold text-brand-600 hover:underline dark:text-brand-300"
        >
          {showWhy ? 'Hide' : 'Why this?'}
        </button>
        {onSkip && !done && (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-semibold lk-muted hover:lk-strong"
          >
            Can’t do this today
          </button>
        )}
      </div>

      {showWhy && (
        <div className="mt-2 rounded-xl border lk-border bg-brand-50/60 p-3 dark:bg-brand-900/20">
          <p className="text-xs font-bold lk-strong">LockIn scheduled this because:</p>
          <ul className="mt-1 space-y-0.5">
            {explainItem(item).map((line) => (
              <li key={line} className="text-xs lk-muted">
                • {line}
              </li>
            ))}
          </ul>
          {!compact && (
            <p className="mt-2 text-[0.7rem] lk-muted">
              Priority score {item.priorityScore} — worked out from the due date, how much work is
              left, your priority setting and how many study days remain.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
