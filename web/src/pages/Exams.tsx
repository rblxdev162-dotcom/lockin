import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../store/context';
import { Card, EmptyState } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Select, TextInput } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { createExam } from '../store/factories';
import { selectExamProgress } from '../lib/planner';
import { formatMinutes } from '../lib/planner/explanations';
import type { Exam, MaterialAmount } from '../types';
import { MATERIAL_AMOUNTS } from '../types';
import { daysUntil, formatDaysRemaining, parseDueDate, todayISO } from '../lib/time';
import { toast } from '../components/ui/Toast';

/** Rough study-load guidance derived from material amount and time left. */
function studyHint(material: MaterialAmount, days: number | null): string {
  if (days === null) return '';
  const total = { Light: 2, Medium: 5, Heavy: 10 }[material];
  if (days <= 0) return 'Exam day — final review.';
  const perDay = Math.max(0.5, total / Math.max(1, days));
  return `About ${perDay < 1 ? '30 min' : `${Math.round(perDay)}h`} a day to cover it.`;
}

export function ExamsPage() {
  const { state, dispatch } = useApp();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Exam | null>(null);
  const [deleting, setDeleting] = useState<Exam | null>(null);

  useEffect(() => {
    if (params.get('new')) {
      setOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const sorted = [...state.exams].sort((a, b) => a.examDate.localeCompare(b.examDate));
  const upcoming = sorted.filter((e) => (daysUntil(e.examDate) ?? -1) >= 0);
  const past = sorted.filter((e) => (daysUntil(e.examDate) ?? -1) < 0).reverse();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight lk-strong">Exams</h1>
          <p className="mt-1 text-sm lk-muted">
            {upcoming.length} upcoming{past.length > 0 && ` · ${past.length} past`}
          </p>
        </div>
        <Button icon={<Icon name="plus" size={16} />} onClick={() => setOpen(true)}>
          New exam
        </Button>
      </header>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Icon name="exam" size={28} />}
          title="No exams yet"
          hint="Add an exam and LockIn counts down the days automatically."
          action={<Button onClick={() => setOpen(true)}>Add an exam</Button>}
        />
      ) : (
        <div className="space-y-5">
          {upcoming.length > 0 && (
            <section className="grid gap-3 sm:grid-cols-2">
              {upcoming.map((exam) => {
                const days = daysUntil(exam.examDate);
                const urgent = days !== null && days <= 3;
                return (
                  /* `min-w-0` is load-bearing, not tidying: a grid item defaults
                     to `min-width: auto`, so it refuses to shrink below its
                     content. Without it, the `truncate` on the exam name below
                     never engages and a long exam title pushes the whole page
                     into horizontal scrolling on a phone. */
                  <Card
                    key={exam.id}
                    className={`min-w-0 ${urgent ? 'border-flame-500/50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold tracking-wide text-brand-600 uppercase dark:text-brand-300">
                          {exam.subject}
                        </p>
                        <h2 className="mt-0.5 truncate text-lg font-extrabold tracking-tight lk-strong">
                          {exam.name}
                        </h2>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => setEditing(exam)}
                          aria-label={`Edit ${exam.name}`}
                          className="rounded-lg p-1.5 lk-muted hover:lk-sunken hover:lk-strong"
                        >
                          <Icon name="edit" size={16} />
                        </button>
                        <button
                          onClick={() => setDeleting(exam)}
                          aria-label={`Delete ${exam.name}`}
                          className="rounded-lg p-1.5 lk-muted hover:bg-flame-400/15 hover:text-flame-600"
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </div>

                    <p
                      className={`mt-3 text-2xl font-extrabold tracking-tight ${
                        urgent ? 'text-flame-600 dark:text-flame-400' : 'lk-strong'
                      }`}
                    >
                      {formatDaysRemaining(days)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          exam.materialAmount === 'Heavy'
                            ? 'flame'
                            : exam.materialAmount === 'Medium'
                              ? 'amber'
                              : 'mint'
                        }
                      >
                        {exam.materialAmount} material
                      </Badge>
                      <span className="text-xs lk-muted">
                        {parseDueDate(exam.examDate, '09:00')?.toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    <p className="mt-2 text-xs lk-muted">{studyHint(exam.materialAmount, days)}</p>
                    {/* Phase 7: what the planner has actually scheduled for it. */}
                    <ExamPlanLine examId={exam.id} />
                  </Card>
                );
              })}
            </section>
          )}

          {past.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-xs font-bold tracking-wide lk-muted uppercase">Past</h2>
              {past.map((exam) => (
                <div
                  key={exam.id}
                  className="lk-card flex items-center justify-between gap-3 p-3.5 opacity-60"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold lk-strong">{exam.name}</p>
                    <p className="text-xs lk-muted">
                      {exam.subject} · {formatDaysRemaining(daysUntil(exam.examDate))}
                    </p>
                  </div>
                  <button
                    onClick={() => setDeleting(exam)}
                    aria-label={`Delete ${exam.name}`}
                    className="rounded-lg p-1.5 lk-muted hover:bg-flame-400/15 hover:text-flame-600"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      <ExamModal
        open={open || !!editing}
        exam={editing}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        onSave={(draft) => {
          if (editing) {
            dispatch({ type: 'UPDATE_EXAM', id: editing.id, patch: draft });
            toast('Exam updated.', 'success');
          } else {
            dispatch({ type: 'ADD_EXAM', exam: createExam(draft) });
            toast('Exam added.', 'success');
          }
          setOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        danger
        title="Delete this exam?"
        confirmLabel="Delete"
        message={
          <>
            <strong className="lk-strong">{deleting?.name}</strong> will be removed. This can’t be
            undone.
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) dispatch({ type: 'DELETE_EXAM', id: deleting.id });
          setDeleting(null);
        }}
      />
    </div>
  );
}

function ExamModal({
  open,
  exam,
  onClose,
  onSave,
}: {
  open: boolean;
  exam: Exam | null;
  onClose: () => void;
  onSave: (draft: { name: string; subject: string; examDate: string; materialAmount: MaterialAmount }) => void;
}) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [examDate, setExamDate] = useState(todayISO());
  const [material, setMaterial] = useState<MaterialAmount>('Medium');
  const [errors, setErrors] = useState<{ name?: string; date?: string }>({});

  // Re-seed the form whenever the modal opens (or switches records).
  useEffect(() => {
    if (!open) return;
    setName(exam?.name ?? '');
    setSubject(exam?.subject ?? '');
    setExamDate(exam?.examDate ?? todayISO());
    setMaterial(exam?.materialAmount ?? 'Medium');
    setErrors({});
  }, [open, exam]);

  return (
    <Modal open={open} title={exam ? 'Edit exam' : 'New exam'} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const next: { name?: string; date?: string } = {};
          if (!name.trim()) next.name = 'Give the exam a name.';
          if (!parseDueDate(examDate, '09:00')) next.date = 'Pick a real date.';
          setErrors(next);
          if (Object.keys(next).length) return;
          onSave({ name, subject, examDate, materialAmount: material });
        }}
      >
        <Field label="Exam name" error={errors.name}>
          <TextInput
            autoFocus
            value={name}
            placeholder="Which exam is it?"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Subject">
          <TextInput
            value={subject}
            placeholder="Class name, or your teacher's name"
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field label="Exam date" error={errors.date}>
          <TextInput type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
        </Field>
        <Field label="Material amount" hint="Drives the suggested daily study load.">
          <Select
            value={material}
            options={MATERIAL_AMOUNTS}
            onChange={(e) => setMaterial(e.target.value as MaterialAmount)}
          />
        </Field>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{exam ? 'Save changes' : 'Add exam'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * What the planner has scheduled for this exam.
 *
 * Read-only here: the estimate itself is edited in the planner's Exams tab, so
 * there is one place that owns it rather than two that can disagree.
 */
function ExamPlanLine({ examId }: { examId: string }) {
  const { state, now } = useApp();
  const entry = selectExamProgress(state, new Date(now)).find((e) => e.examId === examId);
  if (!entry || !state.planner.plan) return null;
  return (
    <p className="mt-1 text-xs lk-muted">
      Planner: {formatMinutes(entry.plannedMinutes)} scheduled ·{' '}
      {formatMinutes(entry.completedMinutes)} studied of {formatMinutes(entry.estimateMinutes)}{' '}
      recommended.
    </p>
  );
}
