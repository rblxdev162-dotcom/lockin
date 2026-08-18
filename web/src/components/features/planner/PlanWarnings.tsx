/**
 * Calculated problems with the plan.
 *
 * Every line comes from a number the scheduler produced — a shortfall it could
 * not place, a day whose demand exceeds its capacity. None of it is a guess,
 * and none of it is hidden: a plan that quietly drops three hours of work is
 * worse than one that says it cannot fit them.
 */
import type { PlanWarning } from '../../../types';
import { Icon } from '../../ui/Icon';
import { cx } from '../../../lib/cx';
import { explainWarning } from '../../../lib/planner/explanations';

const TONE = {
  critical: 'border-flame-400/50 bg-flame-400/10 text-flame-700 dark:text-flame-300',
  warning: 'border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300',
  info: 'lk-border lk-sunken lk-muted',
} as const;

export function PlanWarnings({
  warnings,
  limit,
  onAdjust,
}: {
  warnings: PlanWarning[];
  limit?: number;
  onAdjust?: () => void;
}) {
  if (warnings.length === 0) return null;
  const shown = limit ? warnings.slice(0, limit) : warnings;

  return (
    <div className="space-y-2" data-testid="plan-warnings">
      {shown.map((warning) => {
        const { title, detail } = explainWarning(warning);
        return (
          <div
            key={warning.id}
            className={cx('flex items-start gap-2.5 rounded-xl border p-3', TONE[warning.severity])}
          >
            <Icon
              name={warning.severity === 'info' ? 'calendar' : 'alert'}
              size={15}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-bold">{title}</p>
              {detail && <p className="mt-0.5 text-xs opacity-90">{detail}</p>}
              {warning.severity !== 'info' && onAdjust && (
                <button
                  type="button"
                  onClick={onAdjust}
                  className="mt-1.5 text-xs font-bold underline underline-offset-2"
                >
                  Adjust availability or estimates
                </button>
              )}
            </div>
          </div>
        );
      })}
      {limit && warnings.length > limit && (
        <p className="text-xs lk-muted">+{warnings.length - limit} more in the planner.</p>
      )}
    </div>
  );
}
