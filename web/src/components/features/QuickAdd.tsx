/**
 * Assignment capture. One field.
 *
 * Three things make a live parser trustworthy rather than unnerving, and all
 * three are here:
 *
 *  1. **The input shows its own work.** Understood spans are underlined *inside
 *     the text as you type*, the way Todoist does it. Nothing is hidden, so
 *     there is nothing to double-check.
 *  2. **Inferences are chips, not a form.** What LockIn worked out appears
 *     underneath; each chip is a button that changes that one thing. Correcting
 *     the date is one tap, not a seven-field dialog.
 *  3. **Nothing is required but the words.** No date, no estimate, no subject.
 *     The estimate in particular is never asked for — it is learned from what
 *     this student actually spends, and shown as a chip they can overrule.
 *
 * See `docs/research/2026-08-task-capture-ux.md` for why.
 */
import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../store/context';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';
import { createAssignment } from '../../store/factories';
import { parseQuickAdd } from '../../lib/quickAdd';
import type { ParsedSpan, QuickAddResult } from '../../lib/quickAdd';
import { addDaysISO, formatDue, todayISO } from '../../lib/time';
import { PRIORITIES } from '../../types';
import type { Priority } from '../../types';
import { cx } from '../../lib/cx';

const EXAMPLES = [
  'ch 7 math problems friday',
  'bio lab report next tuesday 5pm',
  'read chapters 4-6 english',
];

/** Overrides the student made by tapping a chip; they beat the parse. */
interface Overrides {
  dueDate?: string;
  estimatedMinutes?: number;
  priority?: Priority;
}

export function QuickAdd({ onOpenFull, autoFocus }: { onOpenFull?: () => void; autoFocus?: boolean }) {
  const { state, dispatch } = useApp();
  const [text, setText] = useState('');
  const [overrides, setOverrides] = useState<Overrides>({});
  const [editing, setEditing] = useState<null | 'date' | 'minutes' | 'priority'>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(
    () =>
      parseQuickAdd(text, new Date(), {
        assignments: state.assignments,
        sessions: state.completedSessions,
      }),
    [text, state.assignments, state.completedSessions],
  );

  const result: QuickAddResult = { ...parsed, ...overrides };
  const ready = result.title.length > 0;

  const reset = () => {
    setText('');
    setOverrides({});
    setEditing(null);
    inputRef.current?.focus();
  };

  const submit = () => {
    if (!ready) return;
    dispatch({
      type: 'ADD_ASSIGNMENT',
      assignment: createAssignment({
        title: result.title,
        subject: result.subject,
        platform: result.platform,
        dueDate: result.dueDate,
        dueTime: result.dueTime,
        estimatedMinutes: result.estimatedMinutes,
        priority: result.priority,
      }),
    });
    toast(`Added “${result.title}”.`, 'success');
    reset();
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="quickadd" className="mb-1.5 block text-sm font-semibold lk-strong">
          What do you need to do?
        </label>

        <div className="flex gap-2">
          <HighlightedInput
            id="quickadd"
            ref={inputRef}
            value={text}
            spans={parsed.spans}
            autoFocus={autoFocus}
            onChange={(next) => {
              setText(next);
              // Retyping clears a correction — otherwise a chip set earlier
              // silently overrides a date the student has just typed.
              setOverrides({});
            }}
          />
          <Button type="submit" aria-label="Add assignment from quick entry" disabled={!ready} icon={<Icon name="plus" size={16} aria-hidden />}>
            Add
          </Button>
        </div>
      </form>

      <div role="status" aria-live="polite" className="mt-2.5">
        {ready ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip
              icon="calendar"
              active={editing === 'date'}
              inferred={!result.dueDate}
              onClick={() => setEditing(editing === 'date' ? null : 'date')}
            >
              {result.dueDate ? formatDue(result.dueDate, result.dueTime) : 'No due date'}
            </Chip>

            <Chip
              icon="timer"
              active={editing === 'minutes'}
              inferred={result.estimateInferred && overrides.estimatedMinutes === undefined}
              onClick={() => setEditing(editing === 'minutes' ? null : 'minutes')}
            >
              {result.estimatedMinutes} min
            </Chip>

            <Chip
              icon="bolt"
              active={editing === 'priority'}
              inferred={result.priority === 'Normal'}
              onClick={() => setEditing(editing === 'priority' ? null : 'priority')}
            >
              {result.priority}
            </Chip>

            {result.subject && (
              <span className="rounded-lg lk-sunken px-2 py-1 text-xs font-semibold lk-muted">
                {result.subject}
              </span>
            )}
            {result.platform !== 'Other' && (
              <span className="rounded-lg lk-sunken px-2 py-1 text-xs font-semibold lk-muted">
                {result.platform}
              </span>
            )}
          </div>
        ) : text.trim().length > 0 ? (
          <p className="text-xs lk-muted">Add a few words describing the work.</p>
        ) : (
          <p className="text-xs lk-muted">
            Just type it.{' '}
            {EXAMPLES.map((example, i) => (
              <span key={example}>
                {i > 0 && ' · '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:lk-strong"
                  onClick={() => {
                    setText(example);
                    setOverrides({});
                    inputRef.current?.focus();
                  }}
                >
                  {example}
                </button>
              </span>
            ))}
          </p>
        )}
      </div>

      {/* One editor at a time, opened by its chip. Never all of them at once —
          that is the form this screen exists to replace. */}
      {ready && editing === 'date' && (
        <DatePicker
          value={result.dueDate}
          onPick={(dueDate) => {
            setOverrides((o) => ({ ...o, dueDate }));
            setEditing(null);
          }}
        />
      )}
      {ready && editing === 'minutes' && (
        <MinutesPicker
          value={result.estimatedMinutes}
          source={overrides.estimatedMinutes === undefined ? result.estimateSource : 'stated'}
          subject={result.subject}
          onPick={(estimatedMinutes) => {
            setOverrides((o) => ({ ...o, estimatedMinutes }));
            setEditing(null);
          }}
        />
      )}
      {ready && editing === 'priority' && (
        <PriorityPicker
          value={result.priority}
          onPick={(priority) => {
            setOverrides((o) => ({ ...o, priority }));
            setEditing(null);
          }}
        />
      )}

      {onOpenFull && (
        <button
          type="button"
          onClick={onOpenFull}
          className="mt-2 text-xs font-semibold lk-muted underline underline-offset-2 hover:lk-strong"
        >
          More options
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The input that shows its own work                                   */
/* ------------------------------------------------------------------ */

/**
 * A real `<input>` with a mirror behind it that underlines the parsed spans.
 *
 * The input is transparent-background and sits exactly on top of a div holding
 * the same text with `<mark>` around each span. Both share one font and one set
 * of paddings, so the marks line up with the glyphs. Scroll is synced for text
 * longer than the box.
 *
 * A `contenteditable` would be simpler to style and much worse to use — it
 * breaks autofill, spellcheck, mobile keyboards and undo. A real input keeps
 * all of that.
 */
const HighlightedInput = function HighlightedInput({
  id,
  value,
  spans,
  onChange,
  autoFocus,
  ref,
}: {
  id: string;
  value: string;
  spans: ParsedSpan[];
  onChange: (value: string) => void;
  autoFocus?: boolean;
  ref?: React.Ref<HTMLInputElement>;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative flex-1">
      <div
        ref={mirrorRef}
        aria-hidden
        className="lk-input pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-transparent"
      >
        {renderSpans(value, spans)}
      </div>
      <input
        id={id}
        ref={ref}
        autoFocus={autoFocus}
        className="lk-input relative w-full bg-transparent"
        value={value}
        maxLength={200}
        autoComplete="off"
        placeholder="ch 7 math problems friday"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
      />
    </div>
  );
};

/** Splits the raw text into plain runs and underlined parsed runs. */
function renderSpans(value: string, spans: ParsedSpan[]) {
  if (spans.length === 0) return value;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) out.push(value.slice(cursor, span.start));
    out.push(
      <mark
        key={`${span.start}-${span.kind}`}
        className="rounded bg-brand-500/20 text-transparent decoration-brand-500 decoration-2 underline-offset-4"
        style={{ textDecorationLine: 'underline' }}
      >
        {value.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  }
  if (cursor < value.length) out.push(value.slice(cursor));
  return out;
}

/* ------------------------------------------------------------------ */
/* Chips and their editors                                             */
/* ------------------------------------------------------------------ */

function Chip({
  children,
  icon,
  active,
  inferred,
  onClick,
}: {
  children: React.ReactNode;
  icon: 'calendar' | 'timer' | 'bolt';
  active?: boolean;
  /** Dimmed when LockIn guessed rather than being told. */
  inferred?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={onClick}
      className={cx(
        'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold transition-colors',
        active
          ? 'border-brand-500 bg-brand-50 lk-strong dark:bg-brand-900/40'
          : inferred
            ? 'lk-border lk-muted hover:lk-strong'
            : 'border-brand-500/40 bg-brand-500/10 lk-strong',
      )}
    >
      <Icon name={icon} size={13} aria-hidden />
      {children}
      <Icon name="edit" size={11} aria-hidden className="opacity-50" />
    </button>
  );
}

function Editor({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2.5 rounded-2xl border lk-border p-3">
      <p className="mb-2 text-xs font-bold lk-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Option({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
        selected ? 'border-brand-500 bg-brand-600 text-white' : 'lk-border lk-muted hover:lk-strong',
      )}
    >
      {children}
    </button>
  );
}

function DatePicker({ value, onPick }: { value: string; onPick: (date: string) => void }) {
  const today = todayISO();
  const choices: [string, string][] = [
    ['Today', today],
    ['Tomorrow', addDaysISO(today, 1)],
    ['In 2 days', addDaysISO(today, 2)],
    ['Next week', addDaysISO(today, 7)],
    ['No date', ''],
  ];
  return (
    <Editor label="Due">
      {choices.map(([label, date]) => (
        <Option key={label} selected={value === date} onClick={() => onPick(date)}>
          {label}
        </Option>
      ))}
      <label className="flex items-center gap-1.5 rounded-lg border lk-border px-2 py-1 text-xs lk-muted">
        <span className="sr-only">Pick an exact due date</span>
        <input
          type="date"
          value={value}
          className="bg-transparent text-xs lk-strong outline-none"
          onChange={(e) => onPick(e.target.value)}
        />
      </label>
    </Editor>
  );
}

function MinutesPicker({
  value,
  source,
  subject,
  onPick,
}: {
  value: number;
  source: QuickAddResult['estimateSource'];
  subject: string;
  onPick: (minutes: number) => void;
}) {
  // Each sentence is only shown when it is true. "Guessed from your Science
  // work" on a student with no finished Science work is a small lie, and small
  // lies about where numbers come from are how an app stops being believed.
  const explanation =
    source === 'learned'
      ? `Based on how long your ${subject} work actually takes you.`
      : source === 'keyword'
        ? 'A guess from the kind of work this looks like.'
        : source === 'default'
          ? 'A starting point — LockIn has nothing to go on yet.'
          : null;

  return (
    <Editor label="How long will it take?">
      {[15, 30, 45, 60, 90, 120].map((minutes) => (
        <Option key={minutes} selected={value === minutes} onClick={() => onPick(minutes)}>
          {minutes < 60 ? `${minutes} min` : `${minutes / 60}h`}
        </Option>
      ))}
      {explanation && (
        <p className="mt-1 w-full text-xs lk-muted">
          {explanation} Change it any time — the plan uses this.
        </p>
      )}
    </Editor>
  );
}

function PriorityPicker({ value, onPick }: { value: Priority; onPick: (p: Priority) => void }) {
  return (
    <Editor label="Priority">
      {PRIORITIES.map((priority) => (
        <Option key={priority} selected={value === priority} onClick={() => onPick(priority)}>
          {priority}
        </Option>
      ))}
    </Editor>
  );
}
