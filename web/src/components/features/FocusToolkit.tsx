import { useEffect, useState } from 'react';
import type { Assignment } from '../../types';
import { Button } from '../ui/Button';
import { Chip, TextInput } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { readToolkit, updateToolkit } from '../../lib/localExperience';
import { setLocalAmbience } from '../../lib/localExperience';
import type { FocusAmbience, FocusKind } from '../../lib/localExperience';
import { useApp } from '../../store/context';

export function FocusToolkit({ assignments, selectedId, minutes, onSelect, onMinutes }: { assignments: Assignment[]; selectedId: string; minutes: number; onSelect: (id: string) => void; onMinutes: (minutes: number) => void }) {
  const { state } = useApp();
  const [toolkit, setToolkit] = useState(readToolkit);
  const [note, setNote] = useState('');
  const queue = toolkit.focusQueue.flatMap((id) => { const item = assignments.find((assignment) => assignment.id === id); return item ? [item] : []; });
  const selected = assignments.find((assignment) => assignment.id === selectedId);
  const preset = selected ? toolkit.focusPresets[selected.subject] : undefined;
  const update = (patch: Parameters<typeof updateToolkit>[0]) => setToolkit(updateToolkit(patch));
  const addQueue = () => { if (!selectedId || toolkit.focusQueue.includes(selectedId)) return; update({ focusQueue: [...toolkit.focusQueue, selectedId].slice(0, 12) }); };
  const intentionCopy = { start: 'Open it and create momentum.', progress: 'Move it forward without demanding completion.', finish: 'Aim to close this task if the time is realistic.' } as const;
  const selectedTool = selected ? toolkit.assignmentTools[selected.id] : undefined;
  const habitatLevel = Math.min(5, Math.floor(state.completedSessions.length / 4));
  useEffect(() => () => setLocalAmbience('silence'), []);

  return <details className="lk-focus-options rounded-2xl border lk-border lk-sunken p-4">
    <summary className="cursor-pointer list-none"><span className="flex items-center justify-between gap-3"><span><span className="block text-body font-extrabold lk-strong">Customize this session</span><span className="block text-caption lk-muted">Queue, intention, class presets, soundscape, and practice modes</span></span><span className="lk-details-chevron text-brand-600 dark:text-brand-300">⌄</span></span></summary>
    <div className="animate-fade mt-4 grid gap-3 border-t lk-border pt-4 lg:grid-cols-2">
    <div className="rounded-2xl border lk-border lk-sunken p-4">
      <div className="flex items-center justify-between gap-2"><div><p className="text-heading font-extrabold lk-strong">Focus queue</p><p className="text-caption lk-muted">Line up a few tasks, not the whole week.</p></div>{selected && <Button size="sm" variant="ghost" onClick={addQueue}>Queue selected</Button>}</div>
      {queue.length ? <div className="mt-3 space-y-2">{queue.slice(0, 4).map((item, index) => <div key={item.id} className="flex items-center gap-2 rounded-xl lk-raised px-3 py-2"><span className="text-caption font-black text-brand-600 dark:text-brand-300">{index + 1}</span><button type="button" className="min-w-0 flex-1 truncate text-left text-caption font-bold lk-strong" onClick={() => onSelect(item.id)}>{item.title}</button><button type="button" aria-label={`Remove ${item.title} from queue`} className="lk-muted hover:lk-strong" onClick={() => update({ focusQueue: toolkit.focusQueue.filter((id) => id !== item.id) })}><Icon name="close" size={13}/></button></div>)}</div> : <p className="mt-3 text-caption lk-muted">Your queue is empty. Pick an assignment and queue it.</p>}
    </div>
    <div className="rounded-2xl border lk-border lk-sunken p-4">
      <p className="text-heading font-extrabold lk-strong">Session intention</p>
      <div className="mt-2 flex flex-wrap gap-2">{(['start', 'progress', 'finish'] as const).map((value) => <Chip key={value} active={toolkit.sessionIntention === value} onClick={() => update({ sessionIntention: value })}>{value === 'progress' ? 'Make progress' : `${value.charAt(0).toUpperCase()}${value.slice(1)}`}</Chip>)}</div>
      <p className="mt-2 text-caption lk-muted">{intentionCopy[toolkit.sessionIntention]}</p>
      {selected && <div className="mt-3 flex flex-wrap items-center gap-2 border-t lk-border pt-3"><p className="mr-auto text-caption font-bold lk-strong">{selected.subject} preset</p>{preset && <Button size="sm" variant="ghost" onClick={() => onMinutes(preset)}>Use {preset}m</Button>}<Button size="sm" variant="ghost" onClick={() => update({ focusPresets: { ...toolkit.focusPresets, [selected.subject]: minutes } })}>Save {minutes}m</Button></div>}
    </div>
    <div className="rounded-2xl border lk-border lk-sunken p-4 lg:col-span-2">
      <div className="flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><label htmlFor="focus-note" className="text-caption font-extrabold lk-strong">Distraction note</label><TextInput id="focus-note" value={note} maxLength={240} placeholder="Write it down without leaving Focus…" onChange={(event) => setNote(event.target.value)} /></div><Button variant="secondary" disabled={!note.trim()} onClick={() => { update({ focusNotes: [...toolkit.focusNotes, { id: crypto.randomUUID(), text: note.trim(), at: new Date().toISOString() }].slice(-40) }); setNote(''); }}>Park thought</Button></div>
      {toolkit.focusNotes.length > 0 && <p className="mt-2 text-caption lk-muted">{toolkit.focusNotes.length} parked thought{toolkit.focusNotes.length === 1 ? '' : 's'} waiting—not competing with this session.</p>}
    </div>
    <details className="rounded-2xl border lk-border lk-sunken p-4 lg:col-span-2">
      <summary className="cursor-pointer text-heading font-extrabold lk-strong">Focus environment & modes</summary>
      <div className="animate-fade mt-3 grid gap-4 lg:grid-cols-2">
        <div><p className="text-caption font-extrabold lk-strong">Session mode</p><div className="mt-2 flex flex-wrap gap-2">{(['standard','reading','practice'] as FocusKind[]).map((kind) => <Chip key={kind} ariaLabel={`Use ${kind} focus mode`} active={toolkit.focusKind === kind} onClick={() => update({ focusKind: kind })}>{kind === 'standard' ? 'Standard' : kind === 'reading' ? 'Reading / chapters' : 'Practice / repetitions'}</Chip>)}</div><p className="mt-2 text-caption lk-muted">{toolkit.focusKind === 'reading' ? `Track pages or chapters${selectedTool?.target ? `: ${selectedTool.target}` : ' in the assignment toolkit'}.` : toolkit.focusKind === 'practice' ? `Track questions, repetitions, and corrections${selectedTool?.target ? `: ${selectedTool.target}` : ''}.` : 'A normal time-and-outcome session.'}</p></div>
        <div><p className="text-caption font-extrabold lk-strong">Local soundscape</p><div className="mt-2 flex flex-wrap gap-2">{(['silence','rain','library','fireplace','brown'] as FocusAmbience[]).map((sound) => <Chip key={sound} ariaLabel={`Use ${sound} focus soundscape`} active={toolkit.focusAmbience === sound} onClick={() => { update({ focusAmbience: sound }); setLocalAmbience(sound); }}>{sound === 'brown' ? 'Brown noise' : sound.charAt(0).toUpperCase()+sound.slice(1)}</Chip>)}</div><p className="mt-2 text-caption lk-muted">Synthesized on this device. Silence is the default; nothing downloads.</p></div>
        <div><p className="text-caption font-extrabold lk-strong">Start ritual</p><label className="mt-2 flex items-center gap-2 text-caption lk-muted"><input type="checkbox" checked={toolkit.focusRitual} onChange={(event) => update({ focusRitual: event.target.checked })}/>Use a ten-second transition before the timer starts</label></div>
        <div className="lk-habitat rounded-2xl border lk-border p-3"><p className="text-caption font-extrabold lk-strong">Companion habitat · level {habitatLevel + 1}</p><div className="mt-2 flex h-12 items-end justify-center gap-2" aria-label={`${state.completedSessions.length} completed sessions have decorated the habitat`}>{Array.from({ length: habitatLevel + 1 }, (_, index) => <span key={index} className="lk-habitat-plant" style={{ height: `${18 + index * 5}px` }}/>)}</div><p className="mt-1 text-center text-[0.65rem] lk-muted">Sessions quietly grow the room. Inactivity changes nothing.</p></div>
      </div>
    </details>
    </div>
  </details>;
}

export function BreakCockpit({ until, onEnd }: { until: number; onEnd: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const remaining = Math.max(0, until - now);
  useEffect(() => { if (remaining === 0) onEnd(); }, [remaining, onEnd]);
  const clock = `${String(Math.floor(remaining / 60_000)).padStart(2, '0')}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, '0')}`;
  return <div className="lk-break-cockpit relative overflow-hidden rounded-[1.7rem] border lk-border p-6 text-center"><p className="text-caption font-extrabold tracking-[.18em] lk-muted uppercase">Break cockpit</p><p className="mt-2 font-mono text-display font-extrabold tabular-nums lk-strong">{clock}</p><p className="mt-2 text-body lk-muted">Stand up, drink water, look away from the screen. Nothing to earn.</p><div className="mt-4 flex justify-center gap-2"><Button variant="secondary" onClick={onEnd}>Return now</Button></div></div>;
}
