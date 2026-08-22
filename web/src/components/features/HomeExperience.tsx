import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Assignment } from '../../types';
import { useApp } from '../../store/context';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { SectionHeader } from '../ui/Status';
import { todayISO } from '../../lib/time';
import { workStateOf } from '../../lib/workState';
import { cx } from '../../lib/cx';
import { importCandidates } from '../../lib/selectors';
import { readToolkit, updateToolkit } from '../../lib/localExperience';
import { TextInput } from '../ui/Field';

const SECTIONS = ['changes', 'reset', 'confidence'] as const;
type HomeSection = (typeof SECTIONS)[number];

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function SmartDayHeader({ next }: { next?: Assignment }) {
  const { state, now } = useApp();
  const schedule = state.settings.schoolSchedule;
  const date = new Date(now);
  const current = date.getHours() * 60 + date.getMinutes();
  const schoolStart = minutes(schedule.schoolStart);
  const schoolEnd = minutes(schedule.schoolEnd);
  const noSchool = readToolkit().noSchoolDays.includes(todayISO(date));
  const afterSchool = schedule.configured && !noSchool && current >= schoolEnd;
  const morning = schedule.configured && !noSchool && current < schoolEnd;
  const marker = Math.max(2, Math.min(98, ((current - schoolStart) / Math.max(1, 21 * 60 - schoolStart)) * 100));
  const [briefing, setBriefing] = useState(() => {
    const key = `lockin.briefing.${todayISO(date)}`;
    return afterSchool && sessionStorage.getItem(key) !== 'seen';
  });
  const changes = state.activity.filter((event) => event.type === 'feed_assignment_updated' || event.type === 'feed_assignment_cancelled').slice(0, 2);
  const todaysClasses = schedule.classes.filter((item) => item.days.includes(date.getDay()));
  const dueToday = state.assignments.filter((assignment) => assignment.status !== 'Completed' && assignment.dueDate === todayISO(date));
  const carryover = state.assignments.filter((assignment) => assignment.status === 'In Progress');

  useEffect(() => {
    if (!briefing) return;
    const key = `lockin.briefing.${todayISO(date)}`;
    sessionStorage.setItem(key, 'seen');
    const timer = window.setTimeout(() => setBriefing(false), 6500);
    return () => window.clearTimeout(timer);
  }, [briefing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {briefing && (
        <div className="lk-launch-screen animate-fade fixed inset-0 z-[70] grid place-items-center p-5" role="dialog" aria-modal="true" aria-label="After-school briefing" onKeyDown={(event) => { if (event.key === 'Escape') setBriefing(false); if (event.key === 'Tab') { event.preventDefault(); event.currentTarget.querySelector('button')?.focus(); } }}>
          <div className="lk-launch-panel w-full max-w-lg rounded-[1.75rem] border lk-border p-6 shadow-2xl">
            <p className="text-caption font-extrabold tracking-[0.18em] text-brand-300 uppercase">After school · ready when you are</p>
            <h2 className="mt-2 text-title font-extrabold text-white">Here’s what changed.</h2>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <Brief label="Changed" value={changes.length ? `${changes.length} calendar update${changes.length === 1 ? '' : 's'}` : 'No new changes'} />
              <Brief label="Due today" value={dueToday.length ? `${dueToday.length} assignment${dueToday.length === 1 ? '' : 's'}` : 'Nothing due'} />
              <Brief label="Class carryover" value={carryover.length ? `${carryover.length} already started` : 'Nothing unfinished'} />
            </div>
            <div className="mt-3 rounded-2xl bg-white/10 p-4 text-white">
              <p className="text-caption font-bold text-white/60 uppercase">Best first task</p>
              <p className="mt-1 text-heading font-extrabold">{next?.title ?? 'Your plan is clear'}</p>
              {next && <p className="mt-1 text-caption text-white/70">{next.subject} · about {Math.max(0, next.estimatedMinutes - next.loggedMinutes)} minutes</p>}
            </div>
            <Button autoFocus className="mt-5" onClick={() => setBriefing(false)}>Enter command center</Button>
          </div>
        </div>
      )}

      {schedule.configured && (
        <Card className="lk-day-rail-card" aria-label="School-day progress">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><p className="text-heading font-extrabold lk-strong">{noSchool ? 'No-school day' : morning ? 'Morning mode' : afterSchool ? 'After-school mode' : 'Evening mode'}</p><p className="break-words text-caption lk-muted">{noSchool ? `Normal school prompts are paused · ${dueToday.length} deadline${dueToday.length === 1 ? '' : 's'} still visible` : morning ? `Between-class glance · ${todaysClasses.map((item) => item.name).join(' · ') || 'No classes listed'} · ${dueToday.length} due today` : afterSchool ? `${carryover.length} class task${carryover.length === 1 ? '' : 's'} already started · your next action is ready.` : 'Wrap up and reset for tomorrow.'}</p></div>
            <span className="rounded-full lk-sunken px-3 py-1 text-caption font-bold lk-muted">Automatic</span>
          </div>
          <div className="relative mt-5">
            <div className="h-1.5 rounded-full bg-gradient-to-r from-sky-400 via-violet-500 to-mint-500 opacity-70" />
            <span className="lk-you-are-here absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-500" style={{ left: `${marker}%` }}><span className="sr-only">You are here</span></span>
            <div className="mt-2 grid grid-cols-4 text-[0.65rem] font-bold lk-muted"><span>School</span><span className="text-center">Break</span><span className="text-center">Homework</span><span className="text-right">Finished</span></div>
          </div>
        </Card>
      )}
    </>
  );
}

function Brief({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-white/10 p-3 text-white"><p className="text-caption font-bold text-white/55 uppercase">{label}</p><p className="mt-1 text-body font-extrabold">{value}</p></div>;
}

export function WorkHorizon({ assignments }: { assignments: Assignment[] }) {
  const { state, now } = useApp();
  const open = assignments.filter((item) => item.status !== 'Completed');
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const endSoon = endToday.getTime() + 3 * 86_400_000;
  const due = (item: Assignment) => item.dueDate ? Date.parse(`${item.dueDate}T${item.dueTime || '23:59'}`) : Number.MAX_SAFE_INTEGER;
  const horizons = [
    { label: 'Today', value: open.filter((item) => due(item) <= endToday.getTime()).length, detail: 'due or already needs attention', tone: 'from-flame-500/18' },
    { label: 'Soon', value: open.filter((item) => due(item) > endToday.getTime() && due(item) <= endSoon).length, detail: 'next three days', tone: 'from-brand-500/18' },
    { label: 'Later', value: open.filter((item) => due(item) > endSoon && due(item) < Number.MAX_SAFE_INTEGER).length, detail: 'safe to keep folded', tone: 'from-mint-500/18' },
  ];
  const parking = open.filter((item) => !item.dueDate).length;
  const inbox = importCandidates(state).length;
  return <section aria-labelledby="horizon-heading"><div className="mb-2 flex items-center justify-between"><div><h2 id="horizon-heading" className="text-heading font-extrabold lk-strong">Work horizon</h2><p className="text-caption lk-muted">Counts first. Open the list only when you need the rows.</p></div><Link to="/assignments" className="text-caption font-extrabold text-brand-600 hover:underline dark:text-brand-300">Open work →</Link></div><div className="grid grid-cols-3 gap-2">{horizons.map((item) => <Link key={item.label} to={`/assignments?horizon=${item.label.toLowerCase()}`} className={cx('lk-horizon-card min-w-0 rounded-2xl border lk-border bg-gradient-to-br p-3', item.tone, 'to-transparent')}><p className="text-[0.65rem] font-extrabold tracking-widest lk-muted uppercase">{item.label}</p><p className="mt-1 text-display font-extrabold tabular-nums lk-strong">{item.value}</p><p className="hidden text-[0.65rem] lk-muted sm:block">{item.detail}</p></Link>)}</div>{(inbox > 0 || parking > 0) && <div className="mt-2 flex flex-wrap gap-2 text-caption"><Link to="/assignments" className="rounded-full lk-sunken px-3 py-1.5 font-bold lk-strong">Inbox · {inbox} new</Link><Link to="/assignments?horizon=parking" className="rounded-full lk-sunken px-3 py-1.5 font-bold lk-strong">Parking lot · {parking}</Link></div>}</section>;
}

export function HomeCommandCenter({ assignments }: { assignments: Assignment[] }) {
  const { state, now, dispatch } = useApp();
  const uncertain = assignments.filter((assignment) => workStateOf(assignment, now) === 'needs_sync' || assignment.canvas?.submissionStatus === 'verification_unavailable');
  const completedThisWeek = assignments.filter((assignment) => assignment.completedAt && now - new Date(assignment.completedAt).getTime() <= 7 * 86_400_000).length;
  const conflicts = Object.entries(assignments.filter((assignment) => assignment.status !== 'Completed').reduce<Record<string, Assignment[]>>((out, assignment) => { if (assignment.dueDate) (out[assignment.dueDate] ??= []).push(assignment); return out; }, {})).filter(([, items]) => items.length >= 2).sort(([a], [b]) => a.localeCompare(b)).slice(0, 3);
  const [dismissed, setDismissed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('lockin.dismissed.teacherChanges') ?? '[]'); } catch { return []; } });
  const recentChanges = state.activity.filter((event) => (event.type === 'feed_assignment_updated' || event.type === 'feed_assignment_cancelled') && !dismissed.includes(event.id)).slice(0, 4);
  const dismissChange = (id: string) => { const next = [...dismissed, id].slice(-100); setDismissed(next); try { localStorage.setItem('lockin.dismissed.teacherChanges', JSON.stringify(next)); } catch { /* optional */ } };

  const content: Record<HomeSection, ReactNode> = {
    reset: <Card><SectionHeader title="Weekly reset" hint={`${completedThisWeek} finished in the last 7 days`} /><div className="grid grid-cols-3 gap-2 text-center"><Metric value={assignments.filter((a) => a.status !== 'Completed').length} label="Open" /><Metric value={conflicts.length} label="Busy dates" /><Metric value={uncertain.length} label="Check data" /></div>{conflicts.length > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-caption font-semibold text-amber-700 dark:text-amber-300">{conflicts.map(([date, items]) => `${items.length} due ${date}`).join(' · ')}</p><Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'PLANNER_REBUILD', reason: 'manual_rebuild' })}>Revise plan</Button></div>}<FocusConstellation /><WeeklyStory /></Card>,
    changes: <Card><SectionHeader title="Teacher changes" hint="What moved in the Canvas calendar" />{recentChanges.length ? <div className="space-y-2">{recentChanges.map((event) => <div key={event.id} className="lk-deadline-move flex items-start gap-2 rounded-xl lk-sunken px-3 py-2 text-caption font-semibold lk-strong"><p className="min-w-0 flex-1">{event.message}</p><button type="button" className="shrink-0 lk-muted hover:lk-strong" aria-label="Dismiss change" onClick={() => dismissChange(event.id)}>Dismiss</button></div>)}</div> : <p className="text-body lk-muted">No teacher changes since your last review.</p>}</Card>,
    confidence: <Card><SectionHeader title="Data confidence" hint="LockIn shows uncertainty instead of guessing" /><p className="text-body lk-muted">{uncertain.length === 0 ? 'Every visible deadline has a usable source.' : `${uncertain.length} assignment${uncertain.length === 1 ? '' : 's'} need a fresh Canvas date or clearer gradebook status.`}</p><Link to="/assignments" className="mt-3 inline-block text-caption font-extrabold text-brand-600 hover:underline dark:text-brand-300">Review accuracy →</Link><DeadlineRadar assignments={assignments} now={now} /></Card>,
  };

  return <details className="lk-secondary-insights min-w-0 rounded-2xl border lk-border lk-sunken p-3" aria-label="Secondary insights and weekly review"><summary className="cursor-pointer list-none px-1"><span className="flex items-center justify-between gap-3"><span><span className="block text-heading font-extrabold lk-strong">Insights & weekly review</span><span className="block text-caption lk-muted">Teacher changes, data confidence, and reflection stay folded until you need them.</span></span><span className="lk-details-chevron text-brand-600 dark:text-brand-300">⌄</span></span></summary><div className="animate-fade mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">{SECTIONS.map((key) => <div key={key} className="min-w-0">{content[key]}</div>)}</div></details>;
}

function Metric({ value, label }: { value: number; label: string }) { return <div className="lk-metric rounded-xl lk-sunken p-3"><p className="text-heading font-extrabold lk-strong">{value}</p><p className="text-caption lk-muted">{label}</p></div>; }

function FocusConstellation() {
  const { state, now } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const sessions = state.completedSessions.filter((session) => new Date(session.endedAt).getTime() >= start.getTime()).slice(-12);
  const chosen = sessions.find((session) => session.id === selected);
  return <div className="mt-4 border-t lk-border pt-3"><div className="flex items-center justify-between"><p className="text-caption font-extrabold lk-strong">This week’s constellation</p><p className="text-caption lk-muted">{sessions.length} focus star{sessions.length === 1 ? '' : 's'} · resets Monday</p></div><div className="lk-constellation relative mt-2 h-16 overflow-hidden rounded-xl lk-sunken">{sessions.length === 0 ? <p className="grid h-full place-items-center text-caption lk-muted">Your first session adds the first star. No missed-day penalty.</p> : sessions.map((session, index) => <button type="button" key={session.id} className="lk-star absolute" style={{ left: `${8 + (index * 79) / Math.max(1, sessions.length - 1)}%`, top: `${18 + ((index * 31) % 48)}%`, animationDelay: `${index * 70}ms` }} aria-label={`Open ${session.actualMinutes} minute focus session`} onClick={() => setSelected(session.id)}>✦</button>)}</div>{chosen && <p className="mt-2 text-caption lk-muted">That star remembers <strong className="lk-strong">{chosen.actualMinutes} minutes</strong>{chosen.assignmentTitle ? ` on ${chosen.assignmentTitle}` : ''}, finished {new Date(chosen.endedAt).toLocaleString()}.</p>}</div>;
}

function WeeklyStory() {
  const { state, now } = useApp();
  const [open, setOpen] = useState(false);
  const [toolkit, setToolkit] = useState(readToolkit);
  const week = new Date(now); week.setHours(0,0,0,0); week.setDate(week.getDate()-((week.getDay()+6)%7));
  const weekOf = todayISO(week);
  const sessions = state.completedSessions.filter((session) => new Date(session.endedAt).getTime() >= week.getTime());
  const minutes = sessions.reduce((sum, session) => sum + session.actualMinutes, 0);
  const days = new Set(sessions.map((session) => session.endedAt.slice(0,10))).size;
  const longest = sessions.reduce((best, session) => Math.max(best, session.actualMinutes), 0);
  const last = [...state.completedSessions].sort((a,b) => new Date(b.endedAt).getTime()-new Date(a.endedAt).getTime())[0];
  const quietDays = last ? Math.floor((now-new Date(last.endedAt).getTime())/86_400_000) : 99;
  const reflection = toolkit.reflection?.weekOf === weekOf ? toolkit.reflection : { weekOf, worked:'', heavy:'', change:'' };
  const save = (patch: Partial<typeof reflection>) => { const next = { ...reflection, ...patch }; setToolkit(updateToolkit({ reflection: next })); };
  return <div className="mt-4 border-t lk-border pt-3"><div className="flex items-start justify-between gap-3"><div><p className="text-caption font-extrabold lk-strong">Your weekly story</p><p className="mt-1 text-caption lk-muted">{sessions.length ? `You focused ${sessions.length} time${sessions.length === 1 ? '' : 's'} for ${minutes} minutes across ${days} day${days === 1 ? '' : 's'}.` : quietDays >= 3 ? 'No debt, no broken streak. Start fresh with one small session.' : 'This week is still open.'}</p>{longest > 0 && <p className="mt-1 text-[0.68rem] lk-muted">Personal best this week: {longest} focused minutes · balanced across {days} day{days === 1 ? '' : 's'}.</p>}</div><Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>{open ? 'Close' : 'Reflect'}</Button></div>{open && <div className="animate-fade mt-3 grid gap-2"><TextInput value={reflection.worked} placeholder="What worked?" aria-label="What worked this week" onChange={(event) => save({ worked:event.target.value })}/><TextInput value={reflection.heavy} placeholder="What felt heavy?" aria-label="What felt heavy this week" onChange={(event) => save({ heavy:event.target.value })}/><TextInput value={reflection.change} placeholder="What will you change next week?" aria-label="What will you change next week" onChange={(event) => save({ change:event.target.value })}/></div>}</div>;
}

function DeadlineRadar({ assignments, now }: { assignments: Assignment[]; now: number }) {
  const points = assignments.filter((assignment) => assignment.status !== 'Completed' && assignment.dueDate).map((assignment) => ({ assignment, due: Date.parse(`${assignment.dueDate}T${assignment.dueTime || '23:59'}`) })).filter((item) => Number.isFinite(item.due) && item.due >= now && item.due <= now + 7 * 86_400_000).sort((a, b) => a.due - b.due).slice(0, 10);
  return <div className="mt-4 border-t lk-border pt-3"><div className="flex items-center justify-between"><p className="text-caption font-extrabold lk-strong">Deadline radar</p><p className="text-caption lk-muted">Closer to center = sooner</p></div><div className="mt-2 flex items-center gap-3"><svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0" role="img" aria-label={`${points.length} deadlines in the next seven days`}><circle cx="60" cy="60" r="50" fill="none" stroke="var(--border-soft)"/><circle cx="60" cy="60" r="33" fill="none" stroke="var(--border-soft)"/><circle cx="60" cy="60" r="16" fill="none" stroke="var(--border-soft)"/><circle cx="60" cy="60" r="3" fill="var(--color-mint-500)"/>{points.map(({ assignment, due }, index) => { const age = (due - now) / (7 * 86_400_000); const radius = 10 + age * 42; const angle = (index / Math.max(1, points.length)) * Math.PI * 2 - Math.PI / 2; return <circle key={assignment.id} cx={60 + Math.cos(angle) * radius} cy={60 + Math.sin(angle) * radius} r="3.2" fill="var(--color-brand-500)"><title>{assignment.title} · {assignment.dueDate}</title></circle>; })}</svg><div className="min-w-0 space-y-1">{points.slice(0, 3).map(({ assignment }) => <p key={assignment.id} className="truncate text-caption font-semibold lk-strong">{assignment.title} <span className="lk-muted">· {assignment.dueDate}</span></p>)}{points.length === 0 && <p className="text-caption lk-muted">No deadlines in radar range.</p>}</div></div></div>;
}
