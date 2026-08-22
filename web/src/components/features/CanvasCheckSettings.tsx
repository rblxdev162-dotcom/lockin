/**
 * Canvas checks — the school-hours control.
 *
 * This is the settings face of `lib/canvas/checkWindow.ts`. It exists because
 * of one specific worry, and it is worth writing down plainly: the student
 * takes proctored tests at school on a district Chromebook while LockIn runs
 * on their computer at home. Nobody should have to explain why a machine of
 * theirs was talking to the school's Canvas during a locked-down assessment.
 *
 * So the copy here never claims more than the code enforces. LockIn cannot
 * know when a test is happening; it knows what window it was told about, and
 * it refuses everything outside it. That is the sentence this page uses —
 * "Automatic Canvas checks are disabled during your configured school hours" —
 * and it is the same sentence in onboarding, in the refusal toast and in the
 * activity log.
 */
import { Card, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Field';
import { useApp } from '../../store/context';
import { formatMinutes, nextAllowedAfter } from '../../lib/canvas/checkWindow';
import type { CanvasCheckWindow } from '../../lib/canvas/checkWindow';
import { relativeTime } from '../../lib/time';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Times a student might plausibly pick. Free text here would be a typo trap. */
const START_CHOICES = [14 * 60, 14 * 60 + 30, 15 * 60, 15 * 60 + 30, 16 * 60, 16 * 60 + 30, 17 * 60];
const END_CHOICES = [19 * 60, 20 * 60, 21 * 60, 21 * 60 + 30, 22 * 60, 23 * 60];

export function CanvasCheckSettings() {
  const { state, dispatch, now } = useApp();
  const window = state.settings.canvasCheckWindow;

  const patch = (next: Partial<CanvasCheckWindow>) => {
    dispatch({
      type: 'UPDATE_SETTINGS',
      patch: { canvasCheckWindow: { ...window, ...next } },
    });
  };

  const paused = window.pausedUntil !== null && window.pausedUntil > now;
  const nextOpen = nextAllowedAfter(window, now);

  return (
    <Card>
      <CardHeader
        title="Canvas checks"
        subtitle="When LockIn is allowed to read Canvas at all"
        action={
          <Badge tone={window.mode === 'scheduled' ? 'amber' : 'mint'}>
            {window.mode === 'scheduled' ? 'Automatic' : 'Manual only'}
          </Badge>
        }
      />

      <p className="mb-4 text-sm lk-muted">
        LockIn never uses a Canvas API or stores your password. A manual check reads pages you
        already have open. If you authorize scheduled checks below, the Companion may briefly open
        one needed class Grades page in the background, read it locally, and close only that tab.
      </p>

      <div className="space-y-4">
        <div>
          <Toggle
            checked={window.mode === 'scheduled'}
            onChange={(on) => patch({ mode: on ? 'scheduled' : 'manual' })}
            label="Let LockIn refresh your Canvas calendar on a timer"
          />
          <p className="mt-1 text-caption lk-muted">
            Off by default. With it off, your due dates update when you press Check Canvas and at
            no other time. With it on, LockIn refreshes every 15 minutes and can read one needed
            class Grades page in a temporary background tab —{' '}
            <strong>inside the hours below, and never outside them</strong>.
          </p>
        </div>

        <div>
          <Toggle
            checked={window.readAsIBrowse}
            onChange={(on) => patch({ readAsIBrowse: on })}
            label="Read Canvas pages as I browse them"
          />
          <p className="mt-1 text-caption lk-muted">
            Off by default. This controls pages you open yourself and makes no request either way.
            Temporary scheduled reads are controlled by the timer switch above.
          </p>
        </div>

        <div className="border-t lk-border pt-4">
          <p className="text-body font-semibold lk-strong">School days</p>
          <p className="mt-0.5 mb-2 text-caption lk-muted">
            On these days, nothing happens before your after-school time.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABELS.map((label, day) => {
              const on = window.schoolDays.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    patch({
                      schoolDays: on
                        ? window.schoolDays.filter((d) => d !== day)
                        : [...window.schoolDays, day].sort((a, b) => a - b),
                    })
                  }
                  className={
                    on
                      ? 'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white'
                      : 'rounded-lg border lk-border px-3 py-1.5 text-xs font-bold lk-muted'
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TimeChoice
            label="School starts"
            value={window.schoolDayFrom}
            choices={[7 * 60, 7 * 60 + 30, 8 * 60, 8 * 60 + 30, 9 * 60]}
            onChange={(v) => patch({ schoolDayFrom: v })}
          />
          <TimeChoice
            label="School ends"
            value={window.schoolDayStart}
            choices={START_CHOICES}
            onChange={(v) => patch({ schoolDayStart: v })}
          />
          <TimeChoice
            label="Weekend timer from"
            value={window.freeDayStart}
            choices={[7 * 60, 8 * 60, 9 * 60, 10 * 60, 11 * 60, 12 * 60]}
            onChange={(v) => patch({ freeDayStart: v })}
          />
          <TimeChoice
            label="Timer stops"
            value={window.dayEnd}
            choices={END_CHOICES}
            onChange={(v) => patch({ dayEnd: v })}
          />
        </div>

        <div className="rounded-xl border lk-border p-3.5">
          <p className="text-body lk-strong">
            Automatic Canvas checks are disabled during your configured school hours.
          </p>
          <p className="mt-1 text-caption lk-muted">
            Nothing is read between {formatMinutes(window.schoolDayFrom)} and{' '}
            {formatMinutes(window.schoolDayStart)} on the days above. Outside
            those hours — including late at night — pressing Check Canvas always
            works; the times on the right only bound the automatic timer.
            {nextOpen && nextOpen > now && (
              <> Next open {relativeTime(new Date(nextOpen).toISOString(), new Date(now))
                .replace(' ago', '')
                .replace('Just now', 'now')}.</>
            )}{' '}
            A refusal is written to your activity log either way, so you can always show exactly
            when LockIn did and did not read Canvas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {paused ? (
            <Button size="sm" variant="secondary" onClick={() => patch({ pausedUntil: null })}>
              Resume Canvas checks
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => patch({ pausedUntil: now + 60 * 60 * 1000 })}
              >
                Pause for an hour
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const tomorrow = new Date(now);
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  tomorrow.setHours(0, 0, 0, 0);
                  patch({ pausedUntil: tomorrow.getTime() });
                }}
              >
                Pause until tomorrow
              </Button>
            </>
          )}
          {paused && (
            <span className="text-caption lk-muted">
              Paused until {new Date(window.pausedUntil ?? now).toLocaleString()}.
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function TimeChoice({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: number;
  choices: number[];
  onChange: (value: number) => void;
}) {
  // A stored value that is not in the list is still shown, rather than silently
  // snapping to something the student never chose.
  const options = choices.includes(value) ? choices : [...choices, value].sort((a, b) => a - b);
  return (
    <label className="block">
      <span className="text-caption font-bold tracking-wide lk-muted uppercase">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-xl border lk-border lk-raised px-3 py-2 text-body lk-strong"
      >
        {options.map((minutes) => (
          <option key={minutes} value={minutes}>
            {formatMinutes(minutes)}
          </option>
        ))}
      </select>
    </label>
  );
}
