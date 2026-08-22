/** The week at a glance: planned minutes against capacity, day by day. */
import { useState } from 'react';
import { useApp } from '../../../store/context';
import { Card, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { PlanItemRow } from './PlanItemRow';
import { WEEKDAY_SHORT } from '../../../types/planner';
import { livePlan, selectWeekLoad } from '../../../lib/planner';
import { formatMinutes } from '../../../lib/planner/explanations';
import { weekdayOf } from '../../../lib/time';
import { cx } from '../../../lib/cx';

export function WeekView({ days = 7 }: { days?: number }) {
  const { state, now, dispatch } = useApp();
  const at = new Date(now);
  const load = selectWeekLoad(state, days, at);
  const plan = livePlan(state, at);
  const [open, setOpen] = useState<string | null>(null);
  const [dragged, setDragged] = useState<{ itemId: string; fromDate: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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
              onDragOver={(event) => {
                if (!dragged || state.planner.lockedDates.includes(day.date)) return;
                event.preventDefault();
                setDropTarget(day.date);
              }}
              onDragLeave={() => setDropTarget((value) => value === day.date ? null : value)}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged) dispatch({ type: 'PLANNER_MOVE_ITEM', ...dragged, toDate: day.date });
                setDragged(null);
                setDropTarget(null);
                setOpen(day.date);
              }}
              className={cx(
                'rounded-xl border p-2 text-center transition-all',
                open === day.date ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'lk-border lk-sunken',
                dropTarget === day.date && 'scale-[1.03] border-mint-500 bg-mint-400/10',
              )}
            >
              <p className="text-[0.62rem] font-bold lk-muted">{WEEKDAY_SHORT[weekday]}</p>
              <div className="lk-load-column mx-auto mt-2 flex h-16 w-5 items-end overflow-hidden rounded-full lk-sunken" aria-hidden="true"><span className={cx('lk-load-fill block w-full rounded-full', over || near ? 'bg-flame-500' : 'bg-brand-500')} style={{ height: `${Math.min(100, Math.max(5, day.utilisation * 100))}%` }} /></div>
              <p className="mt-1 text-[0.62rem] font-extrabold lk-strong tabular-nums">{day.plannedMinutes}m</p>
              <p className="text-[0.55rem] lk-muted">of {day.capacityMinutes}m</p>
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
            selected.items.map((item) => <div key={item.id} draggable={!state.planner.lockedDates.includes(selected.date)} onDragStart={() => setDragged({ itemId: item.id, fromDate: selected.date })} onDragEnd={() => { setDragged(null); setDropTarget(null); }} className="lk-draggable-plan cursor-grab active:cursor-grabbing"><PlanItemRow item={item} compact /></div>)
          )}
          {selected.items.length > 0 && <p className="text-[0.68rem] lk-muted">Drag a study block onto another day. Locked days stay put; conflicts update immediately.</p>}
        </div>
      )}
    </Card>
  );
}
