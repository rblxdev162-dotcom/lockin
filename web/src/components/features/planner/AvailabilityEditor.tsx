/**
 * "When are you usually free?"
 *
 * This is the single most load-bearing input in the planner: capacity, and
 * therefore every warning about work not fitting, is derived from it. Which is
 * why it is asked plainly, per weekday, with a maximum the student picks
 * themselves rather than a number LockIn assumes.
 */
import { useApp } from '../../../store/context';
import { Card, CardHeader } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Field, TextInput, Toggle } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import type { AvailabilityDay, FixedBlock, Weekday } from '../../../types/planner';
import { WEEKDAY_NAMES } from '../../../types/planner';
import { formatMinutes } from '../../../lib/planner/explanations';
import { capacityFor, windowsForDate, windowMinutes } from '../../../lib/planner/capacity';
import { addDaysISO, minutesOfDay, todayISO, weekdayOf } from '../../../lib/time';
import { uid } from '../../../lib/time';

export function AvailabilityEditor() {
  const { state, dispatch, now } = useApp();
  const settings = state.planner.settings;

  const update = (weekday: Weekday, patch: Partial<AvailabilityDay>) => {
    dispatch({
      type: 'PLANNER_UPDATE_SETTINGS',
      patch: {
        availability: settings.availability.map((row) =>
          row.weekday === weekday ? { ...row, ...patch } : row,
        ),
      },
    });
  };

  const addBlock = (block: FixedBlock) =>
    dispatch({
      type: 'PLANNER_UPDATE_SETTINGS',
      patch: { fixedBlocks: [...settings.fixedBlocks, block] },
    });

  const removeBlock = (id: string) =>
    dispatch({
      type: 'PLANNER_UPDATE_SETTINGS',
      patch: { fixedBlocks: settings.fixedBlocks.filter((b) => b.id !== id) },
    });

  /** The real capacity for the next occurrence of this weekday. */
  const previewFor = (weekday: Weekday): number => {
    const today = todayISO(new Date(now));
    for (let i = 1; i <= 7; i += 1) {
      const date = addDaysISO(today, i);
      if (weekdayOf(date) === weekday) {
        return capacityFor(
          windowMinutes(windowsForDate(date, settings, new Date(now))),
          weekday,
          settings,
        );
      }
    }
    return 0;
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Typical study availability"
          subtitle="LockIn only schedules inside these times, and never fills them completely."
        />
        <div className="space-y-3">
          {settings.availability.map((row) => (
            <div key={row.weekday} className="lk-sunken rounded-2xl border lk-border p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold lk-strong">{WEEKDAY_NAMES[row.weekday]}</p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs font-semibold lk-muted">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      aria-label={`${WEEKDAY_NAMES[row.weekday]} available`}
                      checked={row.available}
                      onChange={(e) => update(row.weekday, { available: e.target.checked })}
                    />
                    Available
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-semibold lk-muted">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      aria-label={`${WEEKDAY_NAMES[row.weekday]} rest day`}
                      checked={row.restDay}
                      onChange={(e) => update(row.weekday, { restDay: e.target.checked })}
                    />
                    Rest day
                  </label>
                </div>
              </div>

              {row.available && !row.restDay && (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="From">
                    <TextInput
                      type="time"
                      value={row.startTime}
                      onChange={(e) => update(row.weekday, { startTime: e.target.value })}
                    />
                  </Field>
                  <Field label="Until">
                    <TextInput
                      type="time"
                      value={row.endTime}
                      onChange={(e) => update(row.weekday, { endTime: e.target.value })}
                    />
                  </Field>
                  <Field label="Max study minutes">
                    <TextInput
                      type="number"
                      min={0}
                      max={720}
                      value={row.maxMinutes}
                      onChange={(e) =>
                        update(row.weekday, { maxMinutes: Number(e.target.value) || 0 })
                      }
                    />
                  </Field>
                </div>
              )}

              <p className="mt-2 text-xs lk-muted">
                {row.restDay
                  ? 'Kept free. If urgent work cannot fit anywhere else, LockIn tells you instead of filling it.'
                  : row.available
                    ? `LockIn will plan up to ${formatMinutes(previewFor(row.weekday))} on this day.`
                    : 'Nothing is scheduled on this day.'}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Fixed commitments"
          subtitle="Practice, clubs, work — LockIn schedules around these."
        />
        {settings.fixedBlocks.length === 0 ? (
          <p className="mb-3 text-sm lk-muted">Nothing added yet.</p>
        ) : (
          <div className="mb-3 space-y-2">
            {settings.fixedBlocks.map((block) => (
              <div
                key={block.id}
                className="lk-sunken flex items-center justify-between gap-3 rounded-xl border lk-border px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold lk-strong">{block.label}</p>
                  <p className="text-xs lk-muted">
                    {WEEKDAY_NAMES[block.weekday]} · {block.startTime}–{block.endTime}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${block.label}`}
                  onClick={() => removeBlock(block.id)}
                  className="lk-muted hover:text-flame-600"
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        <FixedBlockForm onAdd={addBlock} />
        <p className="mt-3 text-xs lk-muted">
          These are recurring weekly blocks. LockIn deliberately does not sync a calendar — no
          account, no cloud, nothing leaves this device.
        </p>
      </Card>
    </div>
  );
}

function FixedBlockForm({ onAdd }: { onAdd: (block: FixedBlock) => void }) {
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        const label = String(data.get('label') ?? '').trim() || 'Busy';
        const weekday = Number(data.get('weekday')) as Weekday;
        const startTime = String(data.get('start') ?? '');
        const endTime = String(data.get('end') ?? '');
        const start = minutesOfDay(startTime);
        const end = minutesOfDay(endTime);
        if (start === null || end === null || end <= start) return;
        onAdd({ id: uid('blk'), weekday, label: label.slice(0, 60), startTime, endTime });
        form.reset();
      }}
    >
      <Field label="What">
        <TextInput name="label" placeholder="What is it? Practice, work, dinner…" maxLength={60} />
      </Field>
      <Field label="Day">
        <select name="weekday" className="lk-input" defaultValue="2">
          {WEEKDAY_NAMES.map((name, index) => (
            <option key={name} value={index}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="From">
        <TextInput name="start" type="time" defaultValue="18:00" />
      </Field>
      <Field label="Until">
        <div className="flex gap-2">
          <TextInput name="end" type="time" defaultValue="19:30" />
          <Button type="submit" size="sm">
            Add
          </Button>
        </div>
      </Field>
    </form>
  );
}

/** Re-exported for the settings tab, which shares the toggle styling. */
export { Toggle };
