/**
 * Multi-step onboarding. Each step commits to the store as it completes, so a
 * refresh mid-onboarding never loses what was already entered.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/context';
import { formatMinutes } from '../lib/canvas/checkWindow';
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
import { SCHOOL_DAYS } from '../lib/schoolSchedule';
import { EXTENSION_DOWNLOAD_URL, companionInstallGuide } from '../lib/downloads';
import { useCanvas } from '../hooks/useCanvas';
import { CanvasSetupModal } from '../components/features/CanvasSettings';
import type { SchoolBreak } from '../lib/schoolSchedule';

const MODE_COPY: Record<ReminderMode, string> = {
  Normal: 'Gentle reminders. Nothing gets blocked unless you start Focus Mode yourself.',
  Focused: 'Persistent reminders, and Focus Mode turns on website blocking when you start it.',
  Strict:
    'Focus Mode with distraction blocking and stronger accountability — ending early needs progress, a parent PIN, or the emergency exit.',
};

export function Onboarding() {
  useTheme();
  const navigate = useNavigate();
  const { state, dispatch, extension } = useApp();

  const [step, setStep] = useState(state.profile ? 1 : 0);
  const [canvasSetup, setCanvasSetup] = useState(false);
  const { connection, busy: canvasBusy, connect: connectCanvas } = useCanvas();
  const extensionConnected = extension.status === 'connected';
  /**
   * The steps depend on where this page is served from: a Companion built for
   * one address cannot see another, so the instructions have to name the one
   * the student is actually on.
   */
  const companionGuide = companionInstallGuide();
  const companionSteps = companionGuide.steps;
  const [name, setName] = useState(state.profile?.firstName ?? '');
  const [preset, setPreset] = useState<PresetId>('typical');
  const [window_, setWindow] = useState<PresetWindow>(DEFAULT_WINDOW);
  const [schoolStart, setSchoolStart] = useState(state.settings.schoolSchedule.schoolStart);
  const [schoolEnd, setSchoolEnd] = useState(state.settings.schoolSchedule.schoolEnd);
  const [schoolDays, setSchoolDays] = useState<number[]>(
    state.settings.schoolSchedule.schoolDays.length
      ? state.settings.schoolSchedule.schoolDays
      : [1, 2, 3, 4, 5],
  );
  const [breaks, setBreaks] = useState<SchoolBreak[]>(
    state.settings.schoolSchedule.breaks.length > 0
      ? state.settings.schoolSchedule.breaks
      : [{ id: 'break-lunch', label: 'Lunch', start: '12:00', end: '12:30', days: [1, 2, 3, 4, 5] }],
  );

  /**
   * Four steps, down from seven (Phase 9).
   *
   * The three that went — focus-session length, a separate reminders screen, a
   * separate blocking screen, and the parent PIN — were all questions with a
   * sane default that a student cannot meaningfully answer before they have
   * used the app once. They live in Settings now. Onboarding asks only what
   * changes what LockIn *does* on day one.
   */
  /**
   * The Companion sits third, before anything that needs it.
   *
   * It used to be second-to-last, which put "Connect Canvas" on a screen where
   * connecting could not work: the student typed their school's address, hit
   * Connect, and got "the LockIn extension is not connected" — a dead end
   * three steps before the screen that would have told them how to install it.
   */
  const steps = ['Name', 'School schedule', 'Companion', 'Your work', 'Your time', 'How LockIn helps', 'Canvas checks'];
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
                placeholder="Your first name"
                onChange={(e) => setName(e.target.value)}
              />
              <Button className="mt-5" size="lg" block type="submit" disabled={!name.trim()}>
                Continue
              </Button>
            </form>
          </div>
        )}

        {/* ---------- Step 2: the school day ----------
            Phase 36 removed the per-class rows that used to live here. They
            asked a student to type every class and tick its meeting days, and
            the answer bought almost nothing: LockIn groups work by the class
            name Canvas already provides, and the only thing the days were used
            for was "which days is there school", which is one question, not
            one per class. Connecting Canvas is the real answer to "what are my
            classes", and it needs no typing at all. */}
        {step === 1 && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight lk-strong">
              When is your school day?
            </h1>
            <p className="mt-1.5 text-sm lk-muted">
              This is all LockIn needs to stay out of your way during school and start working
              with you after it. Your classes come from Canvas — you never type them here.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Field label="School starts"><TextInput type="time" value={schoolStart} onChange={(e) => setSchoolStart(e.target.value)} /></Field>
              <Field label="School ends"><TextInput type="time" value={schoolEnd} onChange={(e) => setSchoolEnd(e.target.value)} /></Field>
            </div>

            <div className="mt-6">
              <p className="text-sm font-extrabold lk-strong">Which days do you have school?</p>
              <p className="mt-0.5 text-xs lk-muted">
                The days LockIn stays quiet until the last bell. Everything else is a free day.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="School days">
                {SCHOOL_DAYS.map((day) => (
                  <Chip
                    key={day.id}
                    active={schoolDays.includes(day.id)}
                    aria-label={day.label}
                    onClick={() =>
                      setSchoolDays((list) =>
                        list.includes(day.id)
                          ? list.filter((value) => value !== day.id)
                          : [...list, day.id].sort(),
                      )
                    }
                  >
                    {day.short}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <p className="text-sm font-extrabold lk-strong">Breaks</p>
              <p className="-mt-2 text-xs lk-muted">
                Time LockIn will not suggest working in — lunch, practice, dinner, the walk home.
              </p>
              {breaks.map((item, index) => (
                <div key={item.id} className="grid gap-2 rounded-2xl border lk-border p-3.5 sm:grid-cols-[1fr_8rem_8rem_auto]">
                  <TextInput value={item.label} placeholder="What is this break?" aria-label={`Break ${index + 1} name`} onChange={(e) => setBreaks((list) => list.map((entry) => entry.id === item.id ? { ...entry, label: e.target.value } : entry))} />
                  <TextInput type="time" value={item.start} aria-label={`${item.label} starts`} onChange={(e) => setBreaks((list) => list.map((entry) => entry.id === item.id ? { ...entry, start: e.target.value } : entry))} />
                  <TextInput type="time" value={item.end} aria-label={`${item.label} ends`} onChange={(e) => setBreaks((list) => list.map((entry) => entry.id === item.id ? { ...entry, end: e.target.value } : entry))} />
                  <Button size="sm" variant="ghost" onClick={() => setBreaks((list) => list.filter((entry) => entry.id !== item.id))}>Remove</Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" icon={<Icon name="plus" size={14} />} onClick={() => setBreaks((list) => [...list, { id: `break-${Date.now()}`, label: 'After school', start: '15:30', end: '16:30', days: [1, 2, 3, 4, 5] }])}>Add break</Button>
            </div>

            <div className="mt-7 flex gap-2">
              <Button variant="secondary" onClick={back}>Back</Button>
              <Button block disabled={schoolDays.length === 0} onClick={() => {
                const cleanBreaks = breaks.filter((item) => item.label.trim() && item.start < item.end).map((item) => ({ ...item, label: item.label.trim(), days: schoolDays }));
                dispatch({ type: 'UPDATE_SETTINGS', patch: {
                  schoolSchedule: {
                    ...state.settings.schoolSchedule,
                    configured: true,
                    schoolStart,
                    schoolEnd,
                    // Classes are Canvas's answer, not a form's. Anything the
                    // student defined before is kept rather than wiped.
                    classes: state.settings.schoolSchedule.classes,
                    breaks: cleanBreaks,
                    schoolDays,
                  },
                  canvasCheckWindow: {
                    ...state.settings.canvasCheckWindow,
                    schoolDays,
                    schoolDayFrom: Number(schoolStart.slice(0, 2)) * 60 + Number(schoolStart.slice(3)),
                    schoolDayStart: Number(schoolEnd.slice(0, 2)) * 60 + Number(schoolEnd.slice(3)),
                  },
                } });
                next();
              }}>Continue</Button>
            </div>
          </div>
        )}

        {/* ---------- Step 4: work ---------- */}
        {step === 3 && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight lk-strong">
              What do you need to finish?
            </h1>
            <p className="mt-1.5 text-sm lk-muted">
              Type it the way you'd say it. Or skip — LockIn works fine empty, and you can add
              work whenever.
            </p>

            {/*
              Canvas belongs on this step, not three screens later.
              "What do you need to finish?" has exactly two honest answers —
              type it, or let your school's Canvas fill it in — and only one of
              them was on the screen. Connecting also answers "what are my
              classes", which is why the class form above it could go.
            */}
            <div className="lk-card mt-5 border-brand-500/40 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body font-extrabold lk-strong">Connect Canvas</p>
                  <p className="mt-0.5 text-sm lk-muted">
                    Your assignments, due dates, classes and teachers arrive by themselves —
                    nothing to type. Canvas reading happens inside the Chrome companion, so this
                    needs the step before this one.
                  </p>
                </div>
                {connection?.domain ? (
                  <span className="rounded-full bg-mint-400/20 px-3 py-1 text-caption font-bold text-mint-600 dark:text-mint-400">
                    Connected
                  </span>
                ) : extensionConnected ? (
                  <Button
                    variant="secondary"
                    onClick={() => setCanvasSetup(true)}
                    disabled={canvasBusy === 'connect'}
                  >
                    {canvasBusy === 'connect' ? 'Opening…' : 'Connect'}
                  </Button>
                ) : (
                  /*
                    Canvas detection lives inside the Companion, so without it
                    connecting cannot work. Offering the button anyway let a
                    student type their school's address and hit a toast; this
                    sends them to the step that fixes it instead.
                  */
                  <Button variant="secondary" onClick={() => setStep(2)}>
                    Add the companion first
                  </Button>
                )}
              </div>
            </div>

            <p className="mt-4 text-caption font-bold tracking-wide lk-muted uppercase">
              Or type it yourself
            </p>
            <div className="lk-card mt-2 p-5">
              <QuickAdd autoFocus={false} />
            </div>

            <CanvasSetupModal
              open={canvasSetup}
              onClose={() => setCanvasSetup(false)}
              connecting={canvasBusy === 'connect'}
              extensionConnected={extensionConnected}
              onConnect={async (domain) => {
                const ok = await connectCanvas(domain);
                if (ok) setCanvasSetup(false);
              }}
            />

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

        {/* ---------- Step 5: when you can study ---------- */}
        {step === 4 && (
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

        {/* ---------- Step 6: how LockIn helps ---------- */}
        {step === 5 && (
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
            Phase 16 said the Companion exists. Phase 36 says how to get it:
            the step named the thing a student cannot work out by using LockIn
            and then left them with no way to act on it, which is the same
            failure as not mentioning it. Chrome will not install this from a
            web page — an unlisted extension is a download, an unzip and a
            developer-mode load — so the steps are written out, numbered, in
            the order Chrome asks for them. */}
        {step === 2 && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight lk-strong">
              Add the Chrome companion
            </h1>
            <p className="mt-1.5 text-sm lk-muted">
              LockIn works as a website. Blocking, reminders while this tab is closed, and
              automatic Canvas reading all need its browser half. Four steps, about a minute.
            </p>

            {extensionConnected ? (
              <div className="mt-6 rounded-2xl border border-mint-500/50 bg-mint-400/10 p-5">
                <p className="text-body font-extrabold text-mint-600 dark:text-mint-400">
                  The Companion is already connected.
                </p>
                <p className="mt-1 text-sm lk-muted">
                  Nothing to install — LockIn can see it answering right now.
                </p>
              </div>
            ) : (
              <ol className="mt-6 space-y-3">
                {companionSteps.map((item, index) => (
                  <li key={item.title} className="flex gap-3 rounded-2xl border lk-border p-4">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-500 text-sm font-extrabold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-body font-bold lk-strong">
                        {index === 0 && companionGuide.download ? (
                          <a
                            className="text-brand-600 underline underline-offset-2 dark:text-brand-300"
                            href={EXTENSION_DOWNLOAD_URL}
                          >
                            {item.title}
                          </a>
                        ) : (
                          item.title
                        )}
                      </p>
                      <p className="mt-0.5 text-sm leading-relaxed lk-muted">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <p className="mt-5 rounded-2xl border border-dashed lk-border p-3.5 text-xs leading-relaxed lk-muted">
              You can skip this and add it later from Integrations. Nothing breaks without it —
              but websites are not really blocked without it, and whenever Focus Mode is running
              and the Companion is not answering, LockIn says so on every screen rather than
              letting you believe you are protected.
            </p>

            <div className="mt-7 flex gap-2">
              <Button variant="secondary" onClick={back}>
                Back
              </Button>
              <Button block size="lg" onClick={next}>
                {extensionConnected ? 'Continue' : 'Skip for now'}
              </Button>
            </div>
          </div>
        )}

        {/* ---------- Step 6: when LockIn may read Canvas ----------
            Phase 18, and the one step here that is not about convenience.

            The student takes proctored tests at school on a district device
            while LockIn runs at home. This screen exists so the after-school
            window is a decision they made on day one rather than a setting
            they never found — and so the promise LockIn makes is stated in
            exactly the words the code enforces, no stronger. */}
        {step === 6 && (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight lk-strong">
              When LockIn may check Canvas
            </h1>
            <p className="mt-1.5 text-sm lk-muted">
              LockIn never uses a Canvas API or stores your password. Manual
              checks read a page you opened. If you later enable scheduled
              checks, the Companion may briefly load one needed class Grades
              page after school and close only the tab it created.
            </p>

            <div className="mt-5 rounded-2xl border lk-border p-4">
              <p className="text-body font-semibold lk-strong">
                Automatic Canvas checks are disabled during your school hours.
              </p>
              <p className="mt-1.5 text-sm lk-muted">
                Pick when your school day ends. Between the morning bell and
                that time, on the days you choose, LockIn will not read Canvas
                or refresh your calendar — and every refusal is written to your
                activity log. Outside school hours, including late at night,
                pressing Check Canvas always works.
              </p>

              <div className="mt-4">
                <span className="text-caption font-bold tracking-wide lk-muted uppercase">
                  School days end at
                </span>
                <select
                  value={state.settings.canvasCheckWindow.schoolDayStart}
                  onChange={(event) =>
                    dispatch({
                      type: 'UPDATE_SETTINGS',
                      patch: {
                        canvasCheckWindow: {
                          ...state.settings.canvasCheckWindow,
                          schoolDayStart: Number(event.target.value),
                        },
                      },
                    })
                  }
                  className="mt-1 w-full rounded-xl border lk-border lk-raised px-3 py-2.5 text-body lk-strong"
                >
                  {[14 * 60, 14 * 60 + 30, 15 * 60, 15 * 60 + 30, 16 * 60, 16 * 60 + 30, 17 * 60].map(
                    (minutes) => (
                      <option key={minutes} value={minutes}>
                        {formatMinutes(minutes)}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>

            <p className="mt-5 rounded-2xl border border-dashed lk-border p-3.5 text-xs leading-relaxed lk-muted">
              You can change this, pause checks entirely, or check anyway on a
              day you are not at school — from Settings → Canvas checks. LockIn
              cannot know when a test is happening; it only knows the hours you
              set here, and it refuses everything outside them.
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
