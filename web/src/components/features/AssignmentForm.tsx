import { useState } from 'react';
import type { Assignment, Platform, Priority, Status } from '../../types';
import { PLATFORMS, PRIORITIES, STATUSES } from '../../types';
import { Field, Select, TextInput } from '../ui/Field';
import { Button } from '../ui/Button';
import { todayISO, parseDueDate } from '../../lib/time';
import type { AssignmentDraft } from '../../store/factories';

export interface AssignmentFormProps {
  initial?: Assignment;
  submitLabel?: string;
  onSubmit: (draft: AssignmentDraft) => void;
  onCancel?: () => void;
}

interface Errors {
  title?: string;
  dueDate?: string;
  estimatedMinutes?: string;
}

export function AssignmentForm({
  initial,
  submitLabel = 'Save assignment',
  onSubmit,
  onCancel,
}: AssignmentFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [platform, setPlatform] = useState<Platform>(initial?.platform ?? 'Canvas');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? todayISO());
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? '23:59');
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    String(initial?.estimatedMinutes ?? 30),
  );
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'Normal');
  const [status, setStatus] = useState<Status>(initial?.status ?? 'Not Started');
  const [showReminders, setShowReminders] = useState(false);
  const [first, setFirst] = useState(String(initial?.reminders.firstReminderMinutes ?? 120));
  const [escalate, setEscalate] = useState(String(initial?.reminders.escalationMinutes ?? 60));
  const [warn, setWarn] = useState(String(initial?.reminders.focusWarningMinutes ?? 30));
  const [steps, setSteps] = useState(initial?.steps.map((step) => step.text).join('\n') ?? '');
  const [errors, setErrors] = useState<Errors>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!title.trim()) next.title = 'Give the assignment a name.';
    if (!parseDueDate(dueDate, dueTime)) next.dueDate = 'Pick a real date.';
    const minutes = Number(estimatedMinutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) {
      next.estimatedMinutes = 'Between 5 and 1440 minutes.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onSubmit({
      title,
      subject,
      platform,
      dueDate,
      dueTime,
      estimatedMinutes: minutes,
      priority,
      status,
      firstReminderMinutes: Number(first) || 120,
      escalationMinutes: Number(escalate) || 60,
      focusWarningMinutes: Number(warn) || 30,
      steps: steps.split('\n').map((text) => text.trim()).filter(Boolean),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Assignment" error={errors.title}>
        <TextInput
          value={title}
          autoFocus
          placeholder="What is the assignment?"
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Subject">
          <TextInput
            value={subject}
            placeholder="Class name, or your teacher's name"
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field label="Platform">
          <Select
            value={platform}
            options={PLATFORMS}
            onChange={(e) => setPlatform(e.target.value as Platform)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Due date" error={errors.dueDate}>
          <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Due time">
          <TextInput type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Est. minutes" error={errors.estimatedMinutes}>
          <TextInput
            type="number"
            min={5}
            max={1440}
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
          />
        </Field>
        <Field label="Priority">
          <Select
            value={priority}
            options={PRIORITIES}
            onChange={(e) => setPriority(e.target.value as Priority)}
          />
        </Field>
        <Field label="Status">
          <Select
            value={status}
            options={STATUSES}
            onChange={(e) => setStatus(e.target.value as Status)}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setShowReminders((v) => !v)}
        className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
      >
        {showReminders ? 'Hide reminder timing' : 'Reminder timing'}
      </button>

      <Field label="Steps (one per line)">
        <textarea
          className="lk-input min-h-24 resize-y"
          value={steps}
          placeholder={'Research sources\nWrite first draft\nProofread and submit'}
          onChange={(event) => setSteps(event.target.value)}
        />
      </Field>

      {showReminders && (
        <div className="lk-sunken grid gap-4 rounded-2xl border lk-border p-4 sm:grid-cols-3">
          <Field label="First (min before)">
            <TextInput
              type="number"
              min={0}
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
          </Field>
          <Field label="Escalation">
            <TextInput
              type="number"
              min={0}
              value={escalate}
              onChange={(e) => setEscalate(e.target.value)}
            />
          </Field>
          <Field label="Focus warning">
            <TextInput
              type="number"
              min={0}
              value={warn}
              onChange={(e) => setWarn(e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" aria-label={submitLabel}>{submitLabel}</Button>
      </div>
    </form>
  );
}
