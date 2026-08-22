import { useMemo, useState } from 'react';
import { useApp } from '../../../store/context';
import { Card, CardHeader } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Chip, TextInput } from '../../ui/Field';
import { toast } from '../../ui/Toast';
import { readToolkit, updateToolkit } from '../../../lib/localExperience';
import { sourceKey } from '../../../types/planner';
import { todayISO } from '../../../lib/time';

export function PlannerIntelligence({ onAvailability }: { onAvailability: () => void }) {
  const { state, now, dispatch } = useApp();
  const [toolkit, setToolkit] = useState(readToolkit);
  const [delta, setDelta] = useState(0);
  const today = todayISO(new Date(now));
  const weekday = String(new Date(now).getDay());
  const day = state.planner.plan?.days.find((entry) => entry.date === today);
  const energy = toolkit.energy[weekday] ?? 'normal';
  const bedtime = toolkit.bedtime;
  const [bedHour, bedMinute] = bedtime.split(':').map(Number);
  const bedtimeAt = new Date(now); bedtimeAt.setHours(bedHour, bedMinute, 0, 0); if (bedtimeAt.getTime() < now) bedtimeAt.setDate(bedtimeAt.getDate() + 1);
  const runway = Math.max(0, Math.floor((bedtimeAt.getTime() - now) / 60_000));
  const planned = day?.items.filter((item) => item.status !== 'completed').reduce((sum, item) => sum + item.plannedMinutes, 0) ?? 0;
  const overloaded = (state.planner.plan?.days ?? []).filter((entry) => entry.plannedMinutes > entry.capacityMinutes + delta);
  const recommended = useMemo(() => {
    const items = [...(day?.items ?? [])].filter((item) => item.status !== 'completed');
    if (energy === 'low') return items.sort((a, b) => a.plannedMinutes - b.plannedMinutes)[0];
    if (energy === 'high') return items.sort((a, b) => b.plannedMinutes - a.plannedMinutes || b.priorityScore - a.priorityScore)[0];
    return items[0];
  }, [day, energy]);
  const setEnergy = (value: 'low' | 'normal' | 'high') => setToolkit(updateToolkit({ energy: { ...toolkit.energy, [weekday]: value } }));
  const applyEnergyOrder = () => {
    if (!day) return;
    const items = [...day.items];
    if (energy === 'low') items.sort((a, b) => a.plannedMinutes - b.plannedMinutes);
    if (energy === 'high') items.sort((a, b) => b.plannedMinutes - a.plannedMinutes || b.priorityScore - a.priorityScore);
    dispatch({ type: 'PLANNER_SET_ORDER', date: day.date, order: items.map((item) => sourceKey(item.sourceType, item.sourceId)) });
    toast('Today’s blocks were reordered for your selected energy.', 'success');
  };
  const protectDinner = () => {
    if (state.planner.settings.fixedBlocks.some((block) => block.label === 'Protected free time' && block.weekday === Number(weekday))) return toast('Protected free time already exists today.', 'info');
    dispatch({ type: 'PLANNER_UPDATE_SETTINGS', patch: { fixedBlocks: [...state.planner.settings.fixedBlocks, { id: `free-${Date.now()}`, weekday: Number(weekday) as 0|1|2|3|4|5|6, label: 'Protected free time', startTime: '18:00', endTime: '19:00' }] } });
    toast('Protected 6–7 PM on this weekday.', 'success');
  };

  return <Card className="lk-planner-intelligence">
    <CardHeader title="Planning lab" subtitle="Preview the evening before changing it." action={<Button size="sm" variant="ghost" onClick={onAvailability}>Availability</Button>} />
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-2xl lk-sunken p-4"><p className="text-caption font-extrabold tracking-wider lk-muted uppercase">Homework runway</p><p className="mt-2 text-display font-extrabold lk-strong">{planned}m <span className="text-body lk-muted">/ {runway}m left</span></p><p className="mt-1 text-caption lk-muted">Until your {bedtime} bedtime. {planned <= runway ? 'Tonight fits.' : `${planned - runway} minutes extend past the runway.`}</p><div className="mt-3 flex items-end gap-2"><div className="flex-1"><label htmlFor="bedtime" className="text-caption font-bold lk-strong">Bedtime</label><TextInput id="bedtime" type="time" value={bedtime} onChange={(event) => setToolkit(updateToolkit({ bedtime: event.target.value }))}/></div><Button size="sm" variant="secondary" onClick={protectDinner}>Protect 6–7</Button></div></div>
      <div className="rounded-2xl lk-sunken p-4"><p className="text-caption font-extrabold tracking-wider lk-muted uppercase">Energy-aware order</p><div className="mt-2 flex flex-wrap gap-1.5">{(['low','normal','high'] as const).map((value) => <Chip key={value} active={energy === value} onClick={() => setEnergy(value)}>{value.charAt(0).toUpperCase()+value.slice(1)}</Chip>)}</div><p className="mt-2 text-caption lk-muted">{recommended ? `Best match: ${recommended.title} · ${recommended.plannedMinutes}m` : 'Nothing is planned today.'}</p><Button size="sm" variant="secondary" className="mt-3" disabled={!day?.items.length} onClick={applyEnergyOrder}>Apply energy order</Button></div>
      <div className="rounded-2xl lk-sunken p-4"><p className="text-caption font-extrabold tracking-wider lk-muted uppercase">What-if capacity</p><input className="mt-3 w-full accent-brand-600" type="range" min="-60" max="120" step="15" value={delta} aria-label="Preview change in daily capacity" onChange={(event) => setDelta(Number(event.target.value))}/><p className="mt-2 text-heading font-extrabold lk-strong">{delta >= 0 ? '+' : ''}{delta}m per day</p><p className="text-caption lk-muted">Preview: {overloaded.length} overloaded day{overloaded.length === 1 ? '' : 's'}. Nothing changes until you edit Availability.</p></div>
    </div>
    <div className="mt-3 rounded-xl border lk-border px-3 py-2 text-caption lk-muted"><strong className="lk-strong">Spillover:</strong> {state.planner.lastRecovery ? `${state.planner.lastRecovery.unfinishedMinutes} minutes from ${state.planner.lastRecovery.date} were carried forward—none disappeared.` : 'No unfinished day has needed recovery in the current plan.'} {overloaded.length ? `Collision preview: ${overloaded.map((item) => item.date).slice(0,3).join(', ')} need more room.` : 'No capacity collisions in this preview.'}</div>
  </Card>;
}
