import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Assignment } from '../../types';
import { useApp } from '../../store/context';
import { todayISO } from '../../lib/time';
import { isSettled, workStateOf } from '../../lib/workState';
import { readToolkit, updateToolkit } from '../../lib/localExperience';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { Card, CardHeader } from '../ui/Card';

export function DailyToolkit({ assignments }: { assignments: Assignment[] }) {
  const { state, dispatch, now } = useApp();
  const [toolkit, setToolkit] = useState(readToolkit);
  const [open, setOpen] = useState(false);
  const [bagDraft, setBagDraft] = useState('');
  const [routineDraft, setRoutineDraft] = useState('');
  const update = (patch: Parameters<typeof updateToolkit>[0]) => setToolkit(updateToolkit(patch));
  const openWork = useMemo(() => assignments.filter((item) => !isSettled(workStateOf(item, now)) && !toolkit.assignmentTools[item.id]?.waitingOnTeacher), [assignments, now, toolkit.assignmentTools]);
  const topThree = toolkit.topThree.flatMap((id) => { const item = openWork.find((entry) => entry.id === id); return item ? [item] : []; });
  const candidates = openWork.filter((item) => !toolkit.topThree.includes(item.id)).slice(0, 8);
  const late = openWork.filter((item) => ['missing', 'overdue'].includes(workStateOf(item, now))).sort((a, b) => remaining(a) - remaining(b));
  const tiny = openWork.filter((item) => remaining(item) <= 10).slice(0, 6);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = todayISO(tomorrow);
  const tomorrowClasses = state.settings.schoolSchedule.classes.filter((item) => item.days.includes(tomorrow.getDay()));
  const bag = toolkit.bagItems[tomorrowKey] ?? [];
  const today = todayISO(new Date(now));
  /**
   * No-school days live in settings, not the local toolkit, because blocking
   * has to know about them: a holiday Monday must not be treated as a school
   * day by the pause, or LockIn goes quiet for a day spent at home.
   */
  const noSchoolDates = state.settings.schoolSchedule.noSchoolDates;
  const noSchool = noSchoolDates.includes(today);
  const setNoSchool = (dates: string[]) =>
    dispatch({
      type: 'UPDATE_SETTINGS',
      patch: { schoolSchedule: { ...state.settings.schoolSchedule, noSchoolDates: dates } },
    });
  const todayPlan = state.planner.plan?.days.find((day) => day.date === today);
  const planned = todayPlan?.items.reduce((sum, item) => sum + item.plannedMinutes, 0) ?? 0;
  const bedtime = new Date(now); const [bedHour, bedMinute] = toolkit.bedtime.split(':').map(Number); bedtime.setHours(bedHour, bedMinute, 0, 0); if (bedtime.getTime() < now) bedtime.setDate(bedtime.getDate() + 1);
  const freeMinutes = Math.max(0, Math.round((bedtime.getTime() - now) / 60_000) - planned);
  const totals = openWork.reduce<Record<string, number>>((out, item) => { out[item.subject || 'No class'] = (out[item.subject || 'No class'] ?? 0) + remaining(item); return out; }, {});
  const pressure = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  const weather = late.length >= 3 || planned > 180 ? 'Crowded' : planned > 120 ? 'Building' : openWork.length ? 'Clear' : 'Open';
  const latestDone = [...assignments].filter((item) => item.status === 'Completed').sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0];

  const toggleTop = (id: string) => update({ topThree: toolkit.topThree.includes(id) ? toolkit.topThree.filter((value) => value !== id) : [...toolkit.topThree, id].slice(-3) });
  const saveBag = () => { if (!bagDraft.trim()) return; update({ bagItems: { ...toolkit.bagItems, [tomorrowKey]: [...bag, { id: crypto.randomUUID(), text: bagDraft.trim(), done: false }].slice(0, 30) } }); setBagDraft(''); };
  const saveRoutine = () => { const parts = routineDraft.split(/→|->/).map((part) => part.trim()).filter(Boolean); if (!parts.length) return; update({ routines: [...toolkit.routines, { id: crypto.randomUUID(), name: parts[0], steps: parts.slice(1) }].slice(0, 20) }); setRoutineDraft(''); };

  return (
    <Card className="lk-daily-lab">
      <CardHeader title="Daily top three" subtitle="Choose three outcomes. Everything else stays out of the way." action={<Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>{open ? 'Hide tools' : 'More tools'}</Button>}/>
      <div className="grid gap-2 sm:grid-cols-3">
        {[0, 1, 2].map((index) => { const item = topThree[index]; return item ? <Link key={item.id} to={`/focus?assignment=${item.id}`} className="lk-top-three-card rounded-2xl border lk-border p-3"><span className="text-[0.65rem] font-black tracking-widest text-brand-600 uppercase dark:text-brand-300">Outcome {index + 1}</span><span className="mt-1 block text-body font-extrabold lk-strong">{item.title}</span><span className="mt-1 block text-caption lk-muted">{item.subject} · {remaining(item)}m</span></Link> : <div key={index} className="rounded-2xl border border-dashed lk-border p-3"><p className="text-caption font-bold lk-muted">Outcome {index + 1} is open</p></div>; })}
      </div>
      {open && <div className="animate-fade mt-4 grid gap-2 border-t lk-border pt-4">
        <Tool title="Choose the top three" hint="Tap to pin or unpin. Waiting-on-teacher work is excluded."><div className="flex flex-wrap gap-2">{[...topThree, ...candidates].map((item) => <button key={item.id} type="button" onClick={() => toggleTop(item.id)} className={`rounded-full border px-3 py-1.5 text-caption font-bold ${toolkit.topThree.includes(item.id) ? 'border-brand-500 bg-brand-500/15 text-brand-600 dark:text-brand-300' : 'lk-border lk-muted'}`}>{item.title}</button>)}</div></Tool>
        <Tool title={`Workload weather · ${weather}`} hint={`${planned}m planned · ${freeMinutes}m protected before ${toolkit.bedtime}`}><div className="lk-balance-dial mt-2 h-3 overflow-hidden rounded-full lk-sunken"><span className="block h-full rounded-full bg-gradient-to-r from-mint-400 via-brand-500 to-flame-500" style={{ width: `${Math.min(100, planned / Math.max(1, planned + freeMinutes) * 100)}%` }}/></div><p className="mt-2 text-caption lk-muted">{pressure ? `${pressure[0]} creates the most pressure (${pressure[1]}m open).` : 'No class is creating workload pressure.'} {freeMinutes < 30 ? 'Rest protection: the current plan reaches bedtime.' : 'Rest remains protected.'}</p></Tool>
        <Tool title="Catch-up mode" hint="Smallest overdue wins first—nothing disappears.">{late.length ? <ol className="space-y-1.5">{late.slice(0, 4).map((item, index) => <li key={item.id}><Link to={`/focus?assignment=${item.id}`} className="flex items-center gap-2 rounded-xl lk-sunken px-3 py-2 text-caption font-bold lk-strong"><span>{index + 1}</span><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="lk-muted">{remaining(item)}m</span></Link></li>)}</ol> : <p className="text-caption lk-muted">Nothing genuinely missing or overdue.</p>}</Tool>
        <Tool title="Two-minute cleanup" hint="Tiny tasks are bundled into one quick pass.">{tiny.length ? <div className="flex flex-wrap gap-2">{tiny.map((item) => <Link key={item.id} to={`/focus?assignment=${item.id}`} className="rounded-full lk-sunken px-3 py-1.5 text-caption font-bold lk-strong">{item.title} · {remaining(item)}m</Link>)}</div> : <p className="text-caption lk-muted">No tasks with ten minutes or less remaining.</p>}</Tool>
        <Tool title="Exam countdown lanes" hint="Preparation surfaces gradually; there is no predicted score."><div className="space-y-2">{state.exams.slice().sort((a,b) => a.examDate.localeCompare(b.examDate)).slice(0,4).map((exam) => { const days = Math.ceil((Date.parse(`${exam.examDate}T23:59`) - now) / 86_400_000); return <div key={exam.id}><div className="flex justify-between text-caption font-bold"><span className="lk-strong">{exam.name}</span><span className="lk-muted">{Math.max(0, days)}d</span></div><div className="mt-1 h-1.5 rounded-full lk-sunken"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(8, Math.min(100, 100 - days * 5))}%` }}/></div></div>; })}{state.exams.length === 0 && <p className="text-caption lk-muted">No exams listed.</p>}</div></Tool>
        <Tool title="Tomorrow & pack my bag" hint={tomorrowClasses.length ? tomorrowClasses.map((item) => item.name).join(' · ') : 'No classes scheduled tomorrow.'}><div className="space-y-1.5">{bag.map((item) => <label key={item.id} className="flex items-center gap-2 text-caption lk-strong"><input type="checkbox" checked={item.done} onChange={() => update({ bagItems: { ...toolkit.bagItems, [tomorrowKey]: bag.map((entry) => entry.id === item.id ? { ...entry, done: !entry.done } : entry) } })}/><span className={item.done ? 'line-through lk-muted' : ''}>{item.text}</span></label>)}</div><div className="mt-2 flex gap-2"><TextInput value={bagDraft} placeholder="Calculator, book, form…" aria-label="Add item to tomorrow bag" onChange={(event) => setBagDraft(event.target.value)}/><Button size="sm" variant="secondary" disabled={!bagDraft.trim()} onClick={saveBag}>Add</Button></div></Tool>
        <Tool title="Reusable routines" hint="Write a name followed by arrow-separated steps."><div className="space-y-1.5">{toolkit.routines.map((routine) => <details key={routine.id} className="rounded-xl lk-sunken px-3 py-2"><summary className="cursor-pointer text-caption font-bold lk-strong">{routine.name}</summary><p className="mt-1 text-caption lk-muted">{routine.steps.join(' → ') || 'No steps yet'}</p></details>)}</div><div className="mt-2 flex gap-2"><TextInput value={routineDraft} placeholder="Math reset → homework → check → pack" aria-label="New reusable routine" onChange={(event) => setRoutineDraft(event.target.value)}/><Button size="sm" variant="secondary" disabled={!routineDraft.trim()} onClick={saveRoutine}>Save</Button></div></Tool>
        <Tool title="School-day controls" hint={noSchool ? 'No school today: blocking runs from the morning instead of waiting for a last bell.' : 'Manual and private—LockIn never collects location.'}><div className="flex flex-wrap gap-2"><Button size="sm" variant={noSchool ? 'primary' : 'secondary'} onClick={() => setNoSchool(noSchool ? noSchoolDates.filter((date) => date !== today) : [...noSchoolDates, today].sort().slice(-180))}>{noSchool ? 'Today marked no-school' : 'Mark today no-school'}</Button><Button size="sm" variant={toolkit.commuteMode ? 'primary' : 'secondary'} onClick={() => update({ commuteMode: !toolkit.commuteMode })}>{toolkit.commuteMode ? 'Commute glance on' : 'Commute glance'}</Button></div>{toolkit.commuteMode && <p className="mt-2 rounded-xl lk-sunken px-3 py-2 text-caption lk-muted">Lightweight mode: review tomorrow, pack materials, or choose the top three. No location is read or stored.</p>}</Tool>
        <Tool title="Win archive" hint="Meaningful completions, not a competitive score.">{toolkit.wins.slice(-3).reverse().map((win) => <p key={win.id} className="mb-1 rounded-xl lk-sunken px-3 py-2 text-caption lk-strong">✦ {win.text}</p>)}{latestDone && <Button size="sm" variant="secondary" onClick={() => update({ wins: [...toolkit.wins, { id: crypto.randomUUID(), text: latestDone.title, at: latestDone.completedAt || new Date().toISOString() }].slice(-60) })}>Remember “{latestDone.title}”</Button>}</Tool>
        <Tool title="Fresh start" hint="Reset today’s choices without deleting work, history, or evidence."><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => update({ topThree: [], energy: { ...toolkit.energy, [today]: 'normal' }, commuteMode: false })}>Rebuild today gently</Button><Link to="/planner" className="inline-flex items-center rounded-xl px-3 text-caption font-bold text-brand-600 hover:underline dark:text-brand-300">Open planner →</Link></div></Tool>
      </div>}
    </Card>
  );
}

function Tool({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) { return <details className="lk-tool-row rounded-xl border lk-border px-3.5 py-3"><summary className="cursor-pointer list-none"><span className="flex items-center justify-between gap-3"><span><span className="block text-body font-extrabold lk-strong">{title}</span><span className="block text-caption lk-muted">{hint}</span></span><span className="lk-details-chevron text-brand-600 dark:text-brand-300">⌄</span></span></summary><div className="animate-fade mt-3 border-t lk-border pt-3">{children}</div></details>; }
function remaining(item: Assignment): number { return Math.max(0, item.estimatedMinutes - item.loggedMinutes); }
