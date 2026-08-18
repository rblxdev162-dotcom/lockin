/**
 * "When can you usually study?" — the first-run version (Phase 8).
 *
 * Phase 7 shipped a full seven-row availability editor, which is the right
 * tool for tuning a schedule and the wrong one for minute two of using an app.
 * Asking a new student to fill in fourteen time fields before they have seen
 * a single plan is how onboarding gets abandoned.
 *
 * So this offers three presets and two time fields, writes the same
 * `AvailabilityDay[]` the editor writes, and points at the editor for anything
 * more specific. Nothing here can express something the full editor cannot.
 */
import { useState } from 'react';
import { Chip, Field, TextInput } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import type { AvailabilityDay, Weekday, WorkloadPreference } from '../../../types';
import { WORKLOAD_PREFERENCES } from '../../../types';
import { formatTime } from '../../../lib/time';

export type PresetId = 'weekdays' | 'weekends' | 'typical' | 'custom';

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
const WEEKEND: Weekday[] = [0, 6];

export interface PresetWindow {
  weekdayStart: string;
  weekdayEnd: string;
  weekendStart: string;
  weekendEnd: string;
}

export const DEFAULT_WINDOW: PresetWindow = {
  weekdayStart: '16:00',
  weekdayEnd: '20:00',
  weekendStart: '10:00',
  weekendEnd: '18:00',
};

/**
 * Builds the seven-day availability a preset implies.
 *
 * A day that is "not available" keeps its times rather than being blanked:
 * turning a day back on in the editor should restore what you had, not drop
 * you into 00:00–00:00. `maxMinutes` is derived from the window length so a
 * short window cannot silently be over-planned by the day ceiling.
 */
export function availabilityFor(preset: PresetId, window: PresetWindow): AvailabilityDay[] {
  const includeWeekdays = preset !== 'weekends';
  const includeWeekend = preset !== 'weekdays';

  return ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((weekday) => {
    const weekend = WEEKEND.includes(weekday);
    const startTime = weekend ? window.weekendStart : window.weekdayStart;
    const endTime = weekend ? window.weekendEnd : window.weekdayEnd;
    return {
      weekday,
      available: weekend ? includeWeekend : includeWeekdays,
      startTime,
      endTime,
      maxMinutes: Math.max(30, Math.min(720, minutesBetween(startTime, endTime))),
      restDay: false,
    };
  });
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

const PRESETS: { id: PresetId; label: string; detail: string }[] = [
  { id: 'typical', label: 'A typical schedule', detail: 'Weekday afternoons and weekend daytimes.' },
  { id: 'weekdays', label: 'Weekdays after school', detail: 'Monday to Friday only.' },
  { id: 'weekends', label: 'Weekends', detail: 'Saturday and Sunday only.' },
];

const WORKLOAD_COPY: Record<WorkloadPreference, string> = {
  Light: 'Plans less each day and leaves lots of open time.',
  Balanced: 'The normal default.',
  Intensive: 'Uses more of the time you said you were free.',
};

export function AvailabilityPresets({
  preset,
  window: win,
  workload,
  onChange,
  onWorkloadChange,
}: {
  preset: PresetId;
  window: PresetWindow;
  workload: WorkloadPreference;
  onChange: (preset: PresetId, window: PresetWindow) => void;
  onWorkloadChange: (workload: WorkloadPreference) => void;
}) {
  const [custom, setCustom] = useState(preset === 'custom');

  const set = (patch: Partial<PresetWindow>) => onChange(preset, { ...win, ...patch });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {PRESETS.map((p) => {
          const active = preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCustom(false);
                onChange(p.id, win);
              }}
              className={`w-full rounded-2xl border p-4 text-left transition-all ${
                active
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                  : 'lk-border lk-raised hover:border-brand-400'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="font-bold lk-strong">{p.label}</span>
                {active && <Icon name="check" size={16} aria-hidden className="text-brand-600" />}
              </span>
              <span className="mt-1 block text-sm leading-snug lk-muted">{p.detail}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border lk-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold lk-strong">
            {preset === 'weekends' ? 'Weekends' : 'Weekdays'}{' '}
            <span className="font-normal lk-muted">
              {preset === 'weekends'
                ? `${formatTime(win.weekendStart)} – ${formatTime(win.weekendEnd)}`
                : `${formatTime(win.weekdayStart)} – ${formatTime(win.weekdayEnd)}`}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setCustom((c) => !c)}
            className="text-xs font-bold text-brand-600 underline underline-offset-2 dark:text-brand-300"
          >
            {custom ? 'Done' : 'Change times'}
          </button>
        </div>
        {preset === 'typical' && !custom && (
          <p className="mt-1 text-sm lk-muted">
            Weekends {formatTime(win.weekendStart)} – {formatTime(win.weekendEnd)}
          </p>
        )}

        {custom && (
          <div className="mt-4 space-y-4">
            {preset !== 'weekends' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Weekdays from">
                  <TextInput
                    type="time"
                    value={win.weekdayStart}
                    onChange={(e) => set({ weekdayStart: e.target.value })}
                  />
                </Field>
                <Field label="until">
                  <TextInput
                    type="time"
                    value={win.weekdayEnd}
                    onChange={(e) => set({ weekdayEnd: e.target.value })}
                  />
                </Field>
              </div>
            )}
            {preset !== 'weekdays' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Weekends from">
                  <TextInput
                    type="time"
                    value={win.weekendStart}
                    onChange={(e) => set({ weekendStart: e.target.value })}
                  />
                </Field>
                <Field label="until">
                  <TextInput
                    type="time"
                    value={win.weekendEnd}
                    onChange={(e) => set({ weekendEnd: e.target.value })}
                  />
                </Field>
              </div>
            )}
            <p className="text-xs lk-muted">
              You can set each day separately later, in Planner → Availability.
            </p>
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-bold lk-strong">How packed should LockIn make your schedule?</p>
        <p className="mt-0.5 text-xs lk-muted">
          This changes how much of your free time gets filled. It never changes which homework
          matters most — deadlines decide that.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {WORKLOAD_PREFERENCES.map((option) => (
            <Chip
              key={option}
              active={workload === option}
              onClick={() => onWorkloadChange(option)}
            >
              {option}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-sm lk-muted">{WORKLOAD_COPY[workload]}</p>
      </div>
    </div>
  );
}

export { WEEKDAYS, WEEKEND };
