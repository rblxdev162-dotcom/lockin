import { useEffect, useMemo, useState } from 'react';
import type { Assignment } from '../../types';
import { useApp } from '../../store/context';
import { readToolkit, updateToolkit } from '../../lib/localExperience';
import type { AssignmentToolState, SubmissionConfidence } from '../../lib/localExperience';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Field';
import { Icon } from '../ui/Icon';

const EMPTY: AssignmentToolState = {
  requirements: [], materials: '', dependencies: '', uncertainty: '', submissionConfidence: 'drafting',
  waitingOnTeacher: false, postmortem: '', target: '', snapshots: [],
};

const CONFIDENCE: { id: SubmissionConfidence; label: string }[] = [
  { id: 'drafting', label: 'Drafting' }, { id: 'reviewed', label: 'Reviewed' },
  { id: 'submitted', label: 'I submitted it' }, { id: 'verified', label: 'Receipt checked' },
];

export function AssignmentToolkit({ assignment }: { assignment: Assignment }) {
  const { state } = useApp();
  const [toolkit, setToolkit] = useState(readToolkit);
  const [requirement, setRequirement] = useState('');
  const item = toolkit.assignmentTools[assignment.id] ?? EMPTY;
  const save = (patch: Partial<AssignmentToolState>) => {
    const next = { ...item, ...patch };
    setToolkit(updateToolkit({ assignmentTools: { ...toolkit.assignmentTools, [assignment.id]: next } }));
  };

  useEffect(() => {
    const stored = readToolkit();
    const current = stored.assignmentTools[assignment.id] ?? EMPTY;
    const latest = current.snapshots.at(-1);
    if (latest && latest.title === assignment.title && latest.dueDate === assignment.dueDate && latest.status === assignment.status) return;
    const snapshot = { at: assignment.updatedAt || new Date().toISOString(), title: assignment.title, dueDate: assignment.dueDate, status: assignment.status };
    const next = { ...current, snapshots: [...current.snapshots, snapshot].slice(-12) };
    setToolkit(updateToolkit({ assignmentTools: { ...stored.assignmentTools, [assignment.id]: next } }));
  }, [assignment.id, assignment.title, assignment.dueDate, assignment.status, assignment.updatedAt]);

  const similar = useMemo(() => {
    const words = new Set(assignment.title.toLowerCase().split(/\W+/).filter((word) => word.length > 3));
    return state.assignments.find((other) => other.id !== assignment.id && other.title.toLowerCase().split(/\W+/).filter((word) => word.length > 3).filter((word) => words.has(word)).length >= 2);
  }, [assignment.id, assignment.title, state.assignments]);
  const changed = item.snapshots.length > 1 ? item.snapshots.slice(-2) : [];

  return (
    <details className="lk-assignment-tools mt-3 border-t lk-border pt-2.5">
      <summary className="cursor-pointer text-caption font-extrabold text-brand-600 dark:text-brand-300">Plan, requirements & materials</summary>
      <div className="animate-fade mt-3 grid gap-3">
        {similar && <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-caption text-amber-700 dark:text-amber-300"><strong>Similar title:</strong> “{similar.title}” may be easy to confuse with this one.</p>}
        <div>
          <p className="text-caption font-extrabold lk-strong">Requirement checklist</p>
          <div className="mt-2 space-y-1.5">{item.requirements.map((entry) => <div key={entry.id} className="flex items-center gap-2"><button type="button" aria-label={`${entry.done ? 'Reopen' : 'Complete'} requirement ${entry.text}`} onClick={() => save({ requirements: item.requirements.map((value) => value.id === entry.id ? { ...value, done: !value.done } : value) })} className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${entry.done ? 'border-mint-500 bg-mint-500 text-white' : 'lk-border'}`}>{entry.done && <Icon name="check" size={11}/>}</button><span className={`min-w-0 flex-1 text-caption ${entry.done ? 'line-through lk-muted' : 'lk-strong'}`}>{entry.text}</span><button type="button" aria-label={`Remove requirement ${entry.text}`} className="lk-muted hover:lk-strong" onClick={() => save({ requirements: item.requirements.filter((value) => value.id !== entry.id) })}><Icon name="close" size={12}/></button></div>)}</div>
          <div className="mt-2 flex gap-2"><TextInput value={requirement} maxLength={180} placeholder="Add a rubric requirement" aria-label="New assignment requirement" onChange={(event) => setRequirement(event.target.value)}/><Button size="sm" variant="secondary" aria-label="Add assignment requirement" disabled={!requirement.trim()} onClick={() => { save({ requirements: [...item.requirements, { id: crypto.randomUUID(), text: requirement.trim(), done: false }].slice(0, 30) }); setRequirement(''); }}>Add</Button></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-caption font-bold lk-strong">Dependencies<textarea className="lk-input mt-1 min-h-20 resize-y" maxLength={800} value={item.dependencies} placeholder="Research → outline → draft" onChange={(event) => save({ dependencies: event.target.value })}/></label>
          <label className="text-caption font-bold lk-strong">Materials shelf<textarea className="lk-input mt-1 min-h-20 resize-y" maxLength={800} value={item.materials} placeholder="Notes, links, filenames, book pages…" onChange={(event) => save({ materials: event.target.value })}/></label>
        </div>
        <label className="text-caption font-bold lk-strong">Reading or practice target<TextInput value={item.target} maxLength={180} placeholder="Pages 40–55 or problems 1–12" onChange={(event) => save({ target: event.target.value })}/></label>
        <div>
          <p className="text-caption font-extrabold lk-strong">Personal submission check</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{CONFIDENCE.map((option) => <button type="button" aria-label={`Set personal submission check to ${option.label}`} key={option.id} onClick={() => save({ submissionConfidence: option.id })} className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-bold ${item.submissionConfidence === option.id ? 'border-brand-500 bg-brand-500/15 text-brand-600 dark:text-brand-300' : 'lk-border lk-muted'}`}>{option.label}</button>)}</div>
          <p className="mt-1 text-[0.65rem] lk-muted">A private memory aid only. It never replaces LockIn or Canvas completion verification.</p>
        </div>
        <label className="flex items-center gap-2 text-caption font-bold lk-strong"><input type="checkbox" checked={item.waitingOnTeacher} onChange={(event) => save({ waitingOnTeacher: event.target.checked })}/>Waiting on the teacher—keep out of my active queue</label>
        <label className="text-caption font-bold lk-strong">Uncertainty inbox note<TextInput value={item.uncertainty} maxLength={500} placeholder="What needs clarification?" onChange={(event) => save({ uncertainty: event.target.value })}/></label>
        {assignment.status === 'Completed' && <label className="text-caption font-bold lk-strong">Assignment postmortem<TextInput value={item.postmortem} maxLength={500} placeholder="What would make the estimate or process better next time?" onChange={(event) => save({ postmortem: event.target.value })}/></label>}
        {changed.length === 2 && <p className="rounded-xl lk-sunken px-3 py-2 text-caption lk-muted"><strong className="lk-strong">Local change history:</strong> {changed[0].dueDate || 'no date'} → {changed[1].dueDate || 'no date'} · {changed[0].status} → {changed[1].status}</p>}
      </div>
    </details>
  );
}
