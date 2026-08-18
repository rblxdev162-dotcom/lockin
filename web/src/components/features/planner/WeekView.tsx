/** The week at a glance: planned minutes against capacity, day by day. */
import { useState } from 'react';
import { useApp } from '../../../store/context';
import { Card, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { ProgressBar } from '../../ui/Progress';
import { PlanItemRow } from './PlanItemRow';
import { WEEKDAY_SHORT } from '../../../types/planner';
import { livePlan, selectWeekLoad } from '../../../lib/planner';
import { formatMinutes } from '../../../lib/planner/explanations';
import { weekdayOf } from '../../../lib/time';
import { cx } from '../../../lib/cx';

export function WeekView({ days = 7 }: { days?: number }) {
  const { state, now } = useApp();
  const at = new Date(now);
  const load = selectWeekLoad(state, days, at);
  const plan = livePlan(state, at);
  const [open, setOpen] = useState<string | null>(null);

  if (load.length === 0) return null;
  const selected = open ? plan?.days.find((d) => d.date === open) : null;

  return (
    <Card>
      <CardHeader title="This week" subtitle="Planned minutes against the time you have" />
      <div className="grid grid-cols-7 gap-1.5">
        {load.map((day) => {
          const weekday = weekdayOf(day.date) ?? 0;
          const over = day.utilisation > 1;
          const near = day.utilisation >= 0.95;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => setOpen(open === day.date ? null : day.date)}
              className={cx(
                'rounded-xl border p-2 text-center transition-colors',
                open === day.date ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'lk-border lk-sunken',
              )}
            >
              <p className="text-[0.62rem] font-bold lk-muted">{WEEKDAY_SHORT[weekday]}</p>
              <p className="mt-0.5 text-sm font-extrabold lk-strong tabular-nums">
                {day.plannedMinutes}
              </p>
              <p className="text-[0.6rem] lk-muted">/ {day.capacityMinutes}</p>
              <div className="mt-1.5">
                <ProgressBar
                  value={day.plannedMinutes}
                  max={Math.max(1, day.capacityMinutes)}
                  tone={over || near ? 'flame' : 'brand'}
                />
              </div>
              {day.restDay && <p className="mt-1 text-[0.55rem] font-bold lk-muted">REST</p>}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mt-4 space-y-2.5 border-t lk-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold lk-strong">{selected.date}</p>
            <Badge
              tone={
                selected.plannedMinutes > selected.capacityMinutes
                  ? 'flame'
                  : selected.plannedMinutes >= selected.capacityMinutes * 0.95 &&
                      selected.capacityMinutes > 0
                    ? 'amber'
                    : 'neutral'
              }
            >
              {selected.plannedMinutes > selected.capacityMinutes
                ? 'OVERLOADED'
                : `${formatMinutes(selected.plannedMinutes)} / ${formatMinutes(
                    selected.capacityMinutes,
                  )} planned`}
            </Badge>
          </div>
          {selected.items.length === 0 ? (
            <p className="text-sm lk-muted">
              {selected.restDay
                ? 'Rest day — LockIn keeps it free unless you change it.'
                : 'Nothing scheduled.'}
            </p>
          ) : (
            selected.items.map((item) => <PlanItemRow key={item.id} item={item} compact />)
          )}
        </div>
      )}
    </Card>
  );
}
