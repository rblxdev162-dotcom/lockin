/**
 * Multi-step onboarding. Each step commits to the store as it completes, so a
 * refresh mid-onboarding never loses what was already entered.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/context';
import { useTheme } from '../hooks/useTheme';
import { Button } from '../components/ui/Button';
import { Chip, Field, TextInput } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { REMINDER_MODES } from '../types';
import type { ReminderMode } from '../types';
import { SUGGESTED_BLOCKLIST, prettyDomain } from '../lib/domains';
import { requestNotificationPermission } from '../hooks/useReminders';
import { toast } from '../components/ui/Toast';
import {
  AvailabilityPresets,
  DEFAULT_WINDOW,
  availabilityFor,
} from '../components/features/planner/AvailabilityPresets';
import type { PresetId, PresetWindow } from '../components/features/planner/AvailabilityPresets';
import type { WorkloadPreference } from '../types';
import { BlockingConsent } from '../components/features/BlockingConsent';
import { QuickAdd } from '../components/features/QuickAdd';
import { formatDue } from '../lib/time';

const MODE_COPY: Record<ReminderMode, string> = {
  Normal: 'Gentle reminders. Nothing gets blocked unless you start Focus Mode yourself.',
  Focused: 'Persistent reminders, and Focus Mode turns on website blocking when you start it.',
  Strict:
    'Focus Mode with distraction blocking and stronger accountability — ending early needs progress, a parent PIN, or the emergency exit.',
};

export function Onboarding() {
  useTheme();
  const navigate = useNavigate();
  const { state, dispatch } = useApp();

  const [step, setStep] = useState(state.profile ? 1 : 0);
  const [name, setName] = useState(state.profile?.firstName ?? '');
  const [preset, setPreset] = useState<PresetId>('typical');
  const [window_, setWindow] = useState<PresetWindow>(DEFAULT_WINDOW);

  /**
   * Four steps, down from seven (Phase 9).
   *
   * The three that went — focus-session length, a separate reminders screen, a
   * separate blocking screen, and the parent PIN — were all questions with a
   * sane default that a student cannot meaningfully answer before they have
   * used the app once. They live in Settings now. Onboarding asks only what
   * changes what LockIn *does* on day one.
   */
  const steps = ['Name', 'Your work', 'Your time', 'How LockIn helps', 'Companion'];
  /**
   * Writes the availability a preset implies, and marks the planner as
   * configured so `/planner` opens with a real schedule instead of the
   * "set this up first" empty state. Phase 7 left this to a tab nobody found.
   */
  const applyAvailability = (nextPreset: PresetId, nextWindow: PresetWindow) => {
    setPreset(nextPreset);
    setWindow(nextWindow);
    dispatch({
      type: 'PLANNER_UPDATE_SETTINGS',
      patch: {
        configured: true,
        availability: availabilityFor(nextPreset, nextWindow),
      },
    });
    // Reminders lean on a start time, and the one the student just chose beats
    // the 17:00 default they never saw.
    dispatch({
      type: 'UPDATE_SETTINGS',
      patch: { defaultStudyTime: nextPreset === 'weekends' ? nextWindow.weekendStart : nextWindow.weekdayStart },
    });
  };

  const next = () => setStep((s) => Math.min(steps.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const finish = async () => {
    dispatch({ type: 'FINISH_ONBOARDING' });
    const permission = await requestNotificationPermission();
    dispatch({ type: 'UPDATE_SETTINGS', patch: { notificationsAsked: true } });
    if (permission === 'granted') toast('Notifications on — reminders will pop up.', 'success');
    navigate('/home', { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 py-8">
      <div className="mb-7">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
            <Icon name="lock" size={18} />
          </span>
          <span className="font-extrabold tracking-tight lk-strong">LockIn</span>
        </div>
        <div className="flex gap-1.5">
          {steps.map((label, i) => (
            <div
              key={label}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-brand-500' : 'lk-sunken'
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-xs font-semibold lk-muted">
          Step {step + 1} of {steps.length} · {steps[step]}
        </p>
      </div>

      <div className="animate-rise flex-1" key={step}>
        {/* ---------- Step 1: name ---------- */}
        {step === 0 && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight lk-strong">
              What should we call you?
            </h1>
            <p className="mt-1.5 text-sm lk-muted">
              Just a first name. It stays on this device.
            </p>
            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = name.trim();
                if (!trimmed) return;
                if (state.profile) dispatch({ type: 'SET_PROFILE_NAME', firstName: trimmed });
                else dispatch({ type: 'CREATE_PROFILE', firstName: trimmed });
                next();
              }}
            >
              <TextInput
                autoFocus
                value={name}
                maxLength={40}
                placeholder="Alex"
                onChange={(e) => setName(e.target.value)}
              />
              <Button className="mt-5" size="lg" block type="submit" disabled={!name.trim()}>
                Continue
              </Button>
            </form>
          </div>
        )}

        {/* ---------- Step 2: work ---------- */}
        {step === 1 && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight lk-strong">
              What do you need to finish?
            </h1>
            <p className="mt-1.5 text-sm lk-muted">
              Type it the way you'd say it. Or skip — LockIn works fine empty, and you can add
              work whenever.
            </p>

            <div className="lk-card mt-5 p-5">
              <QuickAdd autoFocus />
            </div>

            {state.assignments.length > 0 && (
              <div className="mt-4 space-y-2">
                {state.assignments.map((a) => (
                  <div key={a.id} className="lk-card flex items-center justify-between gap-3 p-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold lk-strong">{a.title}</p>
                      <p className="truncate text-xs lk-muted">
                        {[a.subject, a.dueDate ? formatDue(a.dueDate, a.dueTime) : 'no due date',
                          `${a.estimatedMinutes} min`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <button
                      className="shrink-0 rounded-lg p-1 lk-muted hover:text-flame-500"
                      aria-label={`Remove ${a.title}`}
                      onClick={() => dispatch({ type: 'DELETE_ASSIGNMENT', id: a.id })}
                    >
                      <Icon name="trash" size={17} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 flex gap-2">
              <Button variant="secondary" onClick={back}>
                Back
              </Button>
              <Button block onClick={next}>
                {state.assignments.length > 0 ? 'Continue' : 'Skip for now'}
              </Button>
            </div>
          </div>
        )}

        {/* ---------- Step 3: when you can study ---------- */}
        {step === 2 && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight lk-strong">
              When can you usually study?
            </h1>
            <p className="mt-1.5 text-sm lk-muted">
              LockIn plans around this. Rough is fine — you can adjust any day later in Planner.
            </p>
            <div className="mt-6">
              <AvailabilityPresets
                preset={preset}
                window={window_}
                workload={state.planner.settings.workloadPreference}
                onChange={applyAvailability}
                onWorkloadChange={(workload: WorkloadPreference) =>
                  dispatch({
                    type: 'PLANNER_UPDATE_SETTINGS',
                    patch: { configured: true, workloadPreference: workload },
                  })
                }
              />
              <Field label="Default focus session length" className="mt-5">
                <div className="flex flex-wrap gap-2">
                  {[15, 25, 45, 60].map((m) => (
                    <Chip
                      key={m}
                      active={state.settings.defaultFocusMinutes === m}
                      onClick={() =>
                        dispatch({ type: 'UPDATE_SETTINGS', patch: { defaultFocusMinutes: m } })
                      }
                    >
                      {m} min
                    </Chip>
                  ))}
                </div>
              </Field>
            </div>
            <div className="mt-7 flex gap-2">
              <Button variant="secondary" onClick={back}>
                Back
              </Button>
              <Button
                block
                onClick={() => {
                  // Commit the preset even if the student never touched it —
                  // accepting the default is a choice, and leaving the planner
                  // unconfigured would send them to an empty /planner.
                  applyAvailability(preset, window_);
                  next();
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ---------- Step 4: how LockIn helps ---------- */}
        {step === 3 && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight lk-strong">
              How should LockIn help?
            </h1>
            <p className="mt-1.5 text-sm lk-muted">
              All of this is changeable later, and none of it is permanent.
            </p>

            <div className="mt-6 space-y-2.5">
              {REMINDER_MODES.map((mode) => {
                const active = state.settings.reminderMode === mode;
                return (
                  <button
                    key={mode}
                    aria-pressed={active}
                    onClick={() =>
                      dispatch({ type: 'UPDATE_SETTINGS', patch: { reminderMode: mode } })
                    }
                    className={`w-full rounded-2xl border p-4 text-left transition-all ${
                      active
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                        : 'lk-border lk-raised hover:border-brand-400'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-bold lk-strong">{mode}</span>
                      {active && <Icon name="check" size={16} aria-hidden className="text-brand-600" />}
                    </span>
                    <span className="mt-1 block text-sm leading-snug lk-muted">
                      {MODE_COPY[mode]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-7">
              <p className="text-sm font-bold lk-strong">Which sites pull you away?</p>
              <p className="mt-0.5 text-xs lk-muted">
                Nothing is selected for you. Skip it if you'd rather not say.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SUGGESTED_BLOCKLIST.map((domain) => {
                  const active = state.settings.blockedDomains.includes(domain);
                  return (
                    <Chip
                      key={domain}
                      active={active}
                      onClick={() =>
                        dispatch({
                          type: 'UPDATE_SETTINGS',
                          patch: {
                            blockedDomains: active
                              ? state.settings.blockedDomains.filter((d) => d !== domain)
                              : [...state.settings.blockedDomains, domain],
                          },
                        })
                      }
                    >
                      {prettyDomain(domain)}
                    </Chip>
                  );
                })}
              </div>
            </div>

            {/* The consent ask sits last, and only once there is something to
                block — asking permission to block an empty list is a prompt
                with no meaning behind it. */}
            {state.settings.blockedDomains.length > 0 && (
              <div className="mt-7">
                <BlockingConsent compact />
              </div>
            )}

            <p className="mt-6 rounded-2xl border border-dashed lk-border p-3.5 text-xs leading-relaxed lk-muted">
              School sites always stay open — Canvas, Edgenuity, Imagine Learning, Google Docs,
              Drive, Classroom, Clever and Google Search can never be blocked. Setting this up for
              someone else? A parent PIN lives in Settings.
            </p>

            <div className="mt-7 flex gap-2">
              <Button variant="secondary" onClick={back}>
                Back
              </Button>
              <Button block size="lg" onClick={next}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ---------- Step 5: the Companion ----------
            Phase 16. This is the one thing about LockIn a student cannot work
            out by using it: the difference between the website on its own and
            the website with its browser half. Canvas setup is still absent on
            purpose — Phase 10's finding was that setup should be triggered by
            behaviour, not by a step counter — but the *existence* of the
            Companion has to be said once, because reminders and blocking both
            depend on it and neither failure is visible until it matters. */}
        {step === 4 && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight lk-strong">
              One last thing
            </h1>
            <p className="mt-1.5 text-sm lk-muted">
              LockIn works as a website. It works better with its Chrome
              companion — and it will tell you honestly which one you have.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border lk-border p-4">
                <p className="text-caption font-bold tracking-wide lk-muted uppercase">
                  Basic LockIn
                </p>
                <ul className="mt-2 space-y-1.5 text-sm lk-strong">
                  <li>Plan and track your work</li>
                  <li>Focus timer and Focus Guard</li>
                  <li>Reminders while this tab is open</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-brand-500/50 lk-raised p-4">
                <p className="text-caption font-bold tracking-wide uppercase text-brand-600 dark:text-brand-300">
                  With the Companion
                </p>
                <ul className="mt-2 space-y-1.5 text-sm lk-strong">
                  <li>Distracting sites actually blocked</li>
                  <li>Reminders when LockIn is closed</li>
                  <li>Canvas calendar imported automatically</li>
                </ul>
              </div>
            </div>

            <p className="mt-5 rounded-2xl border border-dashed lk-border p-3.5 text-xs leading-relaxed lk-muted">
              You can add it later from Integrations, and nothing here breaks
              without it. Whenever Focus Mode is running and the Companion is
              not answering, LockIn says so across every screen rather than
              letting you believe sites are blocked.
            </p>

            <div className="mt-7 flex gap-2">
              <Button variant="secondary" onClick={back}>
                Back
              </Button>
              <Button block size="lg" onClick={finish}>
                Start using LockIn
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
