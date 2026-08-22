import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../store/context';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Chip, Field, TextInput, Toggle } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { ThemeToggle } from '../components/layout/ThemeToggle';
import { DomainListEditor } from '../components/features/DomainListEditor';
import { DataPanel } from '../components/features/DataPanel';
import { BrowserProtectionSetup } from '../components/features/BrowserProtectionSetup';
import { BlockingConsent } from '../components/features/BlockingConsent';
import { CanvasSettings } from '../components/features/CanvasSettings';
import { CanvasCheckSettings } from '../components/features/CanvasCheckSettings';
import { CanvasImportModal } from '../components/features/CanvasImportModal';
import { ParentPinDialog } from '../components/features/ParentPinDialog';
import { ParentTransparencyPreview } from '../components/features/parent/ParentTransparencyPreview';
import { toast } from '../components/ui/Toast';
import { DEFAULT_ALLOWLIST, SUGGESTED_BLOCKLIST, shadowedDomains } from '../lib/domains';
import { normalizeDomain } from '../lib/domains';
import { createPin, validatePinFormat } from '../lib/pin';
import { requestNotificationPermission } from '../hooks/useReminders';
import { REMINDER_MODES } from '../types';
import type { ReminderMode } from '../types';
import { formatClock, formatTime } from '../lib/time';
import { APP_VERSION } from '../version';
import {
  CLASS_COLORS,
  SCHOOL_DAYS,
  describeSchoolHours,
  isDuringSchoolHours,
  isHomeworkTime,
} from '../lib/schoolSchedule';
import { blockingHomeworkWindow, blockingSchoolHours } from '../lib/selectors';

/** Minutes past midnight back to `HH:MM`, for the copy that names the hour. */
const minutesToClock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
import { BACKGROUNDS, readExperience, updateExperience, readToolkit, updateToolkit } from '../lib/localExperience';

const MODE_COPY: Record<ReminderMode, string> = {
  Normal: 'Gentle reminders. Nothing is blocked unless you start Focus Mode yourself.',
  Focused: 'Persistent reminders. Focus Mode turns on website blocking when you start it.',
  Strict:
    'Focus Mode with distraction blocking. Ending early needs progress, the parent PIN, or the emergency exit.',
};

export function SettingsPage() {
  const { state, dispatch, extension, now } = useApp();
  const navigate = useNavigate();
  const s = state.settings;

  const [pinModal, setPinModal] = useState<'set' | 'change' | null>(null);
  const [removePinOpen, setRemovePinOpen] = useState(false);
  const [confirmAllowRemoval, setConfirmAllowRemoval] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [strictGate, setStrictGate] = useState<null | { domain: string }>(null);
  const [blockGate, setBlockGate] = useState<string | null>(null);
  // Arrives from the block page: /settings?allowlist=example.com
  const [requestedDomain, setRequestedDomain] = useState<string | null>(null);
  const [addGate, setAddGate] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [experience, setExperience] = useState(readExperience);
  const [toolkit, setToolkit] = useState(readToolkit);

  useEffect(() => {
    const raw = params.get('allowlist');
    if (!raw) return;
    const result = normalizeDomain(raw);
    params.delete('allowlist');
    setParams(params, { replace: true });
    if (result.ok && result.domain) setRequestedDomain(result.domain);
    else toast('That site address wasn’t valid.', 'error');
  }, [params, setParams]);

  const addAllowed = (domain: string) => {
    if (!s.allowedDomains.includes(domain)) {
      dispatch({
        type: 'UPDATE_SETTINGS',
        patch: { allowedDomains: [...s.allowedDomains, domain] },
      });
      dispatch({
        type: 'LOG',
        eventType: 'allowlist_changed',
        message: `Added ${domain} to the school allowlist`,
        meta: { domain },
      });
    }
    setRequestedDomain(null);
    setAddGate(null);
    toast(`${domain} will never be blocked.`, 'success');
  };

  const strict = s.reminderMode === 'Strict';
  const shadowed = shadowedDomains(s.blockedDomains, s.allowedDomains);
  const fm = state.focusMode;
  const testRunning = fm.active && fm.isTest && fm.testExpiresAt !== null;
  const schoolHours = blockingSchoolHours(state);
  const schoolHoursLabel = describeSchoolHours(schoolHours);
  const schoolPauseActive = isDuringSchoolHours(schoolHours, now, s.schoolSchedule.noSchoolDates);
  const homeworkWindow = blockingHomeworkWindow(state);
  const homeworkActive = isHomeworkTime(homeworkWindow, now, s.schoolSchedule.noSchoolDates);
  const homeworkLabel = homeworkWindow ? formatTime(minutesToClock(homeworkWindow.from)) : null;
  const updateSchedule = (patch: Partial<typeof s.schoolSchedule>) => dispatch({
    type: 'UPDATE_SETTINGS',
    patch: { schoolSchedule: { ...s.schoolSchedule, ...patch, configured: true } },
  });

  /**
   * Parent protections only bite while a Strict session is actually running.
   *
   * Outside one there is nothing to weaken — planning tomorrow's blocklist is
   * ordinary studying, and gating that would be the kind of friction that
   * makes people stop using the app.
   */
  const strictSessionRunning = strict && fm.active && !fm.isTest && !!state.parentPin;
  const blocklistProtected =
    strictSessionRunning && state.parentControls.protectBlocklistInStrictMode;
  const allowlistProtected =
    strictSessionRunning && state.parentControls.protectAllowlistInStrictMode;

  const removeBlocked = (domain: string) => {
    dispatch({
      type: 'UPDATE_SETTINGS',
      patch: { blockedDomains: s.blockedDomains.filter((d) => d !== domain) },
    });
    setBlockGate(null);
  };

  const removeAllowed = (domain: string) => {
    dispatch({
      type: 'UPDATE_SETTINGS',
      patch: { allowedDomains: s.allowedDomains.filter((d) => d !== domain) },
    });
    dispatch({
      type: 'LOG',
      eventType: 'allowlist_changed',
      message: `Removed ${domain} from the school allowlist`,
      meta: { domain },
    });
    setConfirmAllowRemoval(null);
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight lk-strong">Settings</h1>
        <p className="mt-1 text-sm lk-muted">
          All of this lives on this device only. Nothing is uploaded anywhere.
        </p>
      </header>

      {/* ---------------- Profile ---------------- */}
      <Card>
        <CardHeader title="Profile" />
        <div className="space-y-4">
          <Field label="First name">
            <TextInput
              value={state.profile?.firstName ?? ''}
              maxLength={40}
              onChange={(e) =>
                dispatch({ type: 'SET_PROFILE_NAME', firstName: e.target.value })
              }
            />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-semibold lk-strong">Appearance</p>
            <ThemeToggle />
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Custom background">
              {BACKGROUNDS.map((background) => (
                <Chip
                  key={background}
                  active={experience.background === background}
                  onClick={() => setExperience(updateExperience({ background }))}
                >
                  {background}
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-xs lk-muted">All six backgrounds are local CSS—nothing is downloaded.</p>
            <div className="mt-3">
              <Toggle
                label="Schedule backgrounds"
                description="Locally move through Aurora, Ocean, Sunset, and Midnight with the time of day. Your manual theme stays saved."
                checked={toolkit.autoTheme}
                onChange={(autoTheme) => setToolkit(updateToolkit({ autoTheme }))}
              />
            </div>
            <div className="mt-4 border-t lk-border pt-3">
              <Toggle
                label="Focus sounds"
                description="Short local cues when Focus starts, work finishes, or a timer ends. Off by default."
                checked={experience.sounds}
                onChange={(sounds) => setExperience(updateExperience({ sounds }))}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card id="school-schedule">
        <CardHeader title="School schedule" subtitle="Class days, breaks, and the boundary between school and study time." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="School starts"><TextInput type="time" value={s.schoolSchedule.schoolStart} onChange={(e) => updateSchedule({ schoolStart: e.target.value })} /></Field>
          <Field label="School ends"><TextInput type="time" value={s.schoolSchedule.schoolEnd} onChange={(e) => updateSchedule({ schoolEnd: e.target.value })} /></Field>
        </div>
        <div className="mt-4 space-y-3">
          {s.schoolSchedule.classes.map((item) => (
            <div key={item.id} className="rounded-2xl lk-sunken p-3">
              <div className="flex flex-wrap items-center gap-2">
                <TextInput className="min-w-40 flex-1" value={item.name} aria-label="Class name" onChange={(e) => updateSchedule({ classes: s.schoolSchedule.classes.map((entry) => entry.id === item.id ? { ...entry, name: e.target.value } : entry) })} />
                <TextInput className="w-16" maxLength={3} value={item.icon} aria-label={`${item.name} icon`} onChange={(e) => updateSchedule({ classes: s.schoolSchedule.classes.map((entry) => entry.id === item.id ? { ...entry, icon: e.target.value.slice(0, 3) } : entry) })} />
                <select className="lk-input w-auto" aria-label={`${item.name} color`} value={item.color} onChange={(e) => updateSchedule({ classes: s.schoolSchedule.classes.map((entry) => entry.id === item.id ? { ...entry, color: e.target.value as (typeof CLASS_COLORS)[number] } : entry) })}>{CLASS_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}</select>
                <Button size="sm" variant="ghost" onClick={() => updateSchedule({ classes: s.schoolSchedule.classes.filter((entry) => entry.id !== item.id) })}>Remove</Button>
              </div>
              <div className="mt-2 flex gap-1.5">{SCHOOL_DAYS.map((day) => <Chip key={day.id} active={item.days.includes(day.id)} aria-label={day.label} onClick={() => updateSchedule({ classes: s.schoolSchedule.classes.map((entry) => entry.id === item.id ? { ...entry, days: entry.days.includes(day.id) ? entry.days.filter((value) => value !== day.id) : [...entry.days, day.id].sort() } : entry) })}>{day.short}</Chip>)}</div>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => updateSchedule({ classes: [...s.schoolSchedule.classes, { id: `class-${Date.now()}`, name: 'New class', days: [1, 2, 3, 4, 5], color: CLASS_COLORS[s.schoolSchedule.classes.length % CLASS_COLORS.length], icon: 'N' }] })}>Add class</Button>
        </div>
        <div className="mt-5 space-y-2">
          <p className="text-sm font-bold lk-strong">Breaks</p>
          {s.schoolSchedule.breaks.map((item) => <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]"><TextInput value={item.label} aria-label="Break name" onChange={(e) => updateSchedule({ breaks: s.schoolSchedule.breaks.map((entry) => entry.id === item.id ? { ...entry, label: e.target.value } : entry) })} /><TextInput type="time" value={item.start} aria-label={`${item.label} starts`} onChange={(e) => updateSchedule({ breaks: s.schoolSchedule.breaks.map((entry) => entry.id === item.id ? { ...entry, start: e.target.value } : entry) })} /><TextInput type="time" value={item.end} aria-label={`${item.label} ends`} onChange={(e) => updateSchedule({ breaks: s.schoolSchedule.breaks.map((entry) => entry.id === item.id ? { ...entry, end: e.target.value } : entry) })} /><Button size="sm" variant="ghost" onClick={() => updateSchedule({ breaks: s.schoolSchedule.breaks.filter((entry) => entry.id !== item.id) })}>Remove</Button></div>)}
          <Button size="sm" variant="secondary" onClick={() => updateSchedule({ breaks: [...s.schoolSchedule.breaks, { id: `break-${Date.now()}`, label: 'Break', start: '12:00', end: '12:30', days: [1, 2, 3, 4, 5] }] })}>Add break</Button>
        </div>
      </Card>

      {/* ---------------- Reminder mode ---------------- */}
      <Card>
        <CardHeader title="Reminder mode" subtitle="How hard LockIn pushes." />
        <div className="space-y-2.5">
          {REMINDER_MODES.map((mode) => {
            const active = s.reminderMode === mode;
            return (
              <button
                key={mode}
                onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { reminderMode: mode } })}
                className={`w-full rounded-2xl border p-4 text-left transition-all ${
                  active
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                    : 'lk-border lk-sunken hover:border-brand-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold lk-strong">{mode}</span>
                  {active && <Icon name="check" size={16} className="text-brand-600" />}
                </div>
                <p className="mt-1 text-sm leading-snug lk-muted">{MODE_COPY[mode]}</p>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ---------------- Study settings ---------------- */}
      <Card>
        <CardHeader title="Study settings" />
        <div className="space-y-4">
          <Field label="Default start time" hint={`Reminders lean on ${formatTime(s.defaultStudyTime)}.`}>
            <TextInput
              type="time"
              value={s.defaultStudyTime}
              onChange={(e) =>
                dispatch({ type: 'UPDATE_SETTINGS', patch: { defaultStudyTime: e.target.value } })
              }
            />
          </Field>
          <Field label="Default focus duration">
            <div className="flex flex-wrap gap-2">
              {[15, 25, 45, 60].map((m) => (
                <Chip
                  key={m}
                  active={s.defaultFocusMinutes === m}
                  onClick={() =>
                    dispatch({ type: 'UPDATE_SETTINGS', patch: { defaultFocusMinutes: m } })
                  }
                >
                  {m} min
                </Chip>
              ))}
            </div>
          </Field>
          <div className="border-t lk-border pt-3">
            <Toggle
              label="Browser notifications"
              description={
                typeof Notification === 'undefined'
                  ? 'This browser doesn’t support notifications.'
                  : Notification.permission === 'granted'
                    ? 'Allowed. Reminders pop up while a LockIn tab is open.'
                    : Notification.permission === 'denied'
                      ? 'Blocked in Chrome. Reminders still appear inside LockIn.'
                      : 'Not requested yet.'
              }
              checked={
                typeof Notification !== 'undefined' && Notification.permission === 'granted'
              }
              onChange={async () => {
                const permission = await requestNotificationPermission();
                dispatch({ type: 'UPDATE_SETTINGS', patch: { notificationsAsked: true } });
                toast(
                  permission === 'granted'
                    ? 'Notifications enabled.'
                    : permission === 'denied'
                      ? 'Chrome is blocking notifications for this site — change it in the address-bar site settings.'
                      : 'Notification permission not granted.',
                  permission === 'granted' ? 'success' : 'info',
                );
              }}
            />
          </div>
        </div>
      </Card>

      {/* ---------------- Browser protection ---------------- */}
      <Card id="browser-protection">
        <CardHeader
          title="Browser protection"
          subtitle="The Chrome extension is what actually blocks websites."
          action={
            <Badge
              tone={
                extension.status === 'connected'
                  ? 'mint'
                  : extension.status === 'checking'
                    ? 'neutral'
                    : 'flame'
              }
            >
              {extension.status === 'connected'
                ? 'Connected'
                : extension.status === 'checking'
                  ? 'Checking…'
                  : 'Not connected'}
            </Badge>
          }
        />

        {/* One card at a time. Before the question is answered, the ask; after
            that, the status. Showing both meant the install steps appeared
            twice on one screen, which is the kind of thing that makes a
            settings page feel like paperwork. */}
        {s.blockingAsked || extension.status === 'connected' ? (
          <BrowserProtectionSetup />
        ) : (
          <BlockingConsent />
        )}

        <div className="mt-4 space-y-3">
          <Toggle
            label="Enable blocking"
            description="Turn off to keep Focus Mode's progress tracking without blocking any sites."
            checked={s.blockingEnabled}
            onChange={(v) => dispatch({ type: 'UPDATE_SETTINGS', patch: { blockingEnabled: v } })}
          />

          <Toggle
            label="Pause blocking during school"
            description={
              schoolHoursLabel
                ? `No site is blocked between ${schoolHoursLabel}. Focus Mode, its timer and reminders still work — they just don't redirect anything.`
                : 'Add your school hours under School schedule below, and blocking will stay out of them.'
            }
            checked={s.pauseBlockingDuringSchool}
            onChange={(v) =>
              dispatch({ type: 'UPDATE_SETTINGS', patch: { pauseBlockingDuringSchool: v } })
            }
          />
          <Toggle
            label="Block automatically after school"
            description={
              homeworkLabel
                ? `Blocked sites stay blocked from ${homeworkLabel} until midnight, with no Focus session needed. Turn off to block only while a Focus session is running.`
                : 'Add your school hours under School schedule below to set when homework hours begin.'
            }
            checked={s.autoBlockAfterSchool}
            onChange={(v) =>
              dispatch({ type: 'UPDATE_SETTINGS', patch: { autoBlockAfterSchool: v } })
            }
          />
          {s.autoBlockAfterSchool && homeworkActive && !schoolPauseActive && (
            <p className="rounded-xl lk-sunken px-3 py-2 text-caption lk-muted">
              Homework hours are running now — your{' '}
              {s.blockedDomains.length === 0 ? 'blocklist is empty, so nothing' : `${s.blockedDomains.length} blocked site${s.blockedDomains.length === 1 ? '' : 's'}`}{' '}
              {s.blockedDomains.length === 0 ? 'is being blocked' : 'are being blocked'}.
            </p>
          )}
          {s.pauseBlockingDuringSchool && schoolPauseActive && (
            <p className="rounded-xl lk-sunken px-3 py-2 text-caption lk-muted">
              School is in session right now, so blocking is paused. It resumes on its own
              afterwards.
            </p>
          )}

          <div className="flex flex-wrap gap-2 border-t lk-border pt-3">
            {testRunning ? (
              <Button
                variant="danger"
                onClick={() => {
                  dispatch({ type: 'END_FOCUS_MODE', reason: 'normal', note: 'test cancelled' });
                  toast('Test mode stopped.', 'info');
                }}
              >
                Stop test ({formatClock((fm.testExpiresAt ?? 0) - now)})
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={fm.active || s.blockedDomains.length === 0}
                title={
                  fm.active
                    ? 'Focus Mode is already running'
                    : s.blockedDomains.length === 0
                      ? 'Add at least one blocked site first'
                      : undefined
                }
                onClick={() => {
                  dispatch({
                    type: 'START_FOCUS_MODE',
                    requiredTaskIds: [],
                    requiredCompletionCount: 0,
                    isTest: true,
                    testMinutes: 5,
                  });
                  toast('TEST MODE on for 5 minutes. Try opening a blocked site.', 'success');
                }}
              >
                Start 5-minute blocking test
              </Button>
            )}
          </div>

          {testRunning && (
            <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
              TEST MODE is active — your blocked sites are redirecting right now. It ends
              automatically in {formatClock((fm.testExpiresAt ?? 0) - now)}.
            </p>
          )}
        </div>
      </Card>

      {/* ---------------- Canvas ---------------- */}
      <CanvasSettings onOpenImport={() => setImportOpen(true)} />
      <CanvasCheckSettings />
      <CanvasImportModal open={importOpen} onClose={() => setImportOpen(false)} />


      {/* ---------------- Blocked websites ---------------- */}
      <Card>
        <CardHeader
          title="Blocked websites"
          subtitle="Blocked only while Focus Mode is active."
        />
        <DomainListEditor
          domains={s.blockedDomains}
          suggestions={SUGGESTED_BLOCKLIST}
          shadowed={shadowed}
          placeholder="youtube.com or https://www.reddit.com/r/all"
          emptyHint="No distracting sites yet. Add one, or tap a suggestion below."
          onAdd={(domain) => {
            if (s.blockedDomains.includes(domain)) return;
            dispatch({
              type: 'UPDATE_SETTINGS',
              patch: { blockedDomains: [...s.blockedDomains, domain] },
            });
          }}
          onRemove={(domain) => {
            if (blocklistProtected) {
              setBlockGate(domain);
              return;
            }
            removeBlocked(domain);
          }}
        />
        {blocklistProtected && (
          <p className="mt-3 rounded-xl border lk-border p-3 text-xs lk-muted">
            <strong className="lk-strong">Managed by Parent Controls.</strong> Removing a blocked
            site while a Strict session is running needs the parent PIN. Adding one never does.
          </p>
        )}
        {shadowed.length > 0 && (
          <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
            {shadowed.join(', ')} {shadowed.length === 1 ? 'is' : 'are'} also on the school
            allowlist, so {shadowed.length === 1 ? 'it' : 'they'} will never be blocked. The
            allowlist always wins.
          </p>
        )}
      </Card>

      {/* ---------------- School allowlist ---------------- */}
      <Card>
        <CardHeader
          title="School allowlist"
          subtitle="Never blocked, even during Strict Mode."
        />
        <DomainListEditor
          domains={s.allowedDomains}
          protectedDomains={DEFAULT_ALLOWLIST}
          placeholder="myschool.instructure.com"
          emptyHint="Nothing allowlisted. Add your school's domains here."
          onAdd={(domain) => {
            if (allowlistProtected) {
              setAddGate(domain);
              return;
            }
            addAllowed(domain);
          }}
          onRemove={(domain) => {
            if (strict && state.parentPin) {
              setStrictGate({ domain });
              return;
            }
            if (DEFAULT_ALLOWLIST.includes(domain)) {
              setConfirmAllowRemoval(domain);
              return;
            }
            removeAllowed(domain);
          }}
        />
        <p className="mt-3 text-xs lk-muted">
          Google Search, Docs, Drive and Classroom are protected in code — they stay reachable even
          if you delete them from this list.
        </p>
      </Card>

      {/* ---------------- Parent controls ---------------- */}
      <Card>
        <CardHeader
          title="Parent controls"
          subtitle="The PIN is hashed with SHA-256 and a random salt. The digits are never stored."
          action={<Badge tone={state.parentPin ? 'mint' : 'neutral'}>{state.parentPin ? 'PIN set' : 'No PIN'}</Badge>}
        />
        <div className="flex flex-wrap gap-2">
          {state.parentPin ? (
            <>
              <Button variant="secondary" onClick={() => setPinModal('change')}>
                Change PIN
              </Button>
              <Button variant="danger" onClick={() => setRemovePinOpen(true)}>
                Remove PIN
              </Button>
            </>
          ) : (
            <Button onClick={() => setPinModal('set')}>Set parent PIN</Button>
          )}
        </div>
        {state.parentPin && (
          <Button
            className="mt-3"
            variant="secondary"
            icon={<Icon name="shield" size={16} />}
            onClick={() => navigate('/parent')}
          >
            Open Parent Dashboard
          </Button>
        )}
        <p className="mt-3 text-xs lk-muted">
          Used for: the Parent Dashboard, overriding Focus Mode, temporary unlocks, and — in Strict
          Mode — protected blocklist and allowlist changes.
        </p>
        <ParentTransparencyPreview />
      </Card>

      {/* ---------------- Data, privacy and help ---------------- */}
      <DataPanel />

      <Card>
        <CardHeader title="Privacy and help" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigate('/privacy')}>
            What LockIn stores
          </Button>
          <Button variant="secondary" onClick={() => navigate('/help')}>
            Help and known limits
          </Button>
        </div>
        <p className="mt-3 text-sm lk-muted">
          LockIn version <span className="font-mono font-semibold lk-strong">{APP_VERSION}</span>
          {extension.status === 'connected' && (
            <> · extension <span className="font-mono font-semibold lk-strong">{extension.version}</span></>
          )}
        </p>
      </Card>

      {/* ---------------- Dialogs ---------------- */}
      <PinModal
        open={pinModal !== null}
        mode={pinModal ?? 'set'}
        onClose={() => setPinModal(null)}
        onSaved={() => setPinModal(null)}
      />

      <ParentPinDialog
        open={removePinOpen}
        title="Remove the parent PIN"
        description="Enter the current PIN to remove it. Overrides will no longer be available."
        confirmLabel="Remove PIN"
        onCancel={() => setRemovePinOpen(false)}
        onVerified={() => {
          dispatch({ type: 'SET_PIN', pin: null });
          setRemovePinOpen(false);
          toast('Parent PIN removed.', 'info');
        }}
      />

      <ParentPinDialog
        open={!!blockGate}
        title="Parent PIN required"
        description={`A Strict session is running. Removing ${blockGate} from the blocked list needs the parent PIN.`}
        confirmLabel="Remove site"
        onCancel={() => setBlockGate(null)}
        onVerified={() => {
          if (blockGate) removeBlocked(blockGate);
        }}
      />

      <ParentPinDialog
        open={!!strictGate}
        title="Parent PIN required"
        description={`Strict Mode is on. Removing ${strictGate?.domain} from the school allowlist needs the parent PIN.`}
        confirmLabel="Remove domain"
        onCancel={() => setStrictGate(null)}
        onVerified={() => {
          if (strictGate) removeAllowed(strictGate.domain);
          setStrictGate(null);
        }}
      />

      <ConfirmDialog
        open={!!confirmAllowRemoval}
        danger
        title="Remove a default school domain?"
        confirmLabel="Remove anyway"
        message={
          <>
            <strong className="lk-strong">{confirmAllowRemoval}</strong> is one of LockIn’s default
            school domains. Removing it means it can be blocked during Focus Mode — that can lock
            you out of real schoolwork.
          </>
        }
        onCancel={() => setConfirmAllowRemoval(null)}
        onConfirm={() => confirmAllowRemoval && removeAllowed(confirmAllowRemoval)}
      />

      {/* Request arriving from the extension's block page. */}
      <ConfirmDialog
        open={!!requestedDomain && !addGate}
        title="Allow this site for school?"
        confirmLabel={strict && state.parentPin ? 'Enter parent PIN' : 'Always allow'}
        message={
          <>
            The block page asked to add <strong className="lk-strong">{requestedDomain}</strong> to
            your school allowlist. It will never be blocked again, in any Focus Mode.
            {strict && state.parentPin && (
              <span className="mt-2 block font-semibold">
                Strict Mode is on, so this needs the parent PIN.
              </span>
            )}
          </>
        }
        onCancel={() => setRequestedDomain(null)}
        onConfirm={() => {
          if (!requestedDomain) return;
          if (strict && state.parentPin) setAddGate(requestedDomain);
          else addAllowed(requestedDomain);
        }}
      />

      <ParentPinDialog
        open={!!addGate}
        title="Parent PIN required"
        description={`Strict Mode: allowlisting ${addGate} permanently needs the parent PIN.`}
        confirmLabel="Allow site"
        onCancel={() => {
          setAddGate(null);
          setRequestedDomain(null);
        }}
        onVerified={() => addGate && addAllowed(addGate)}
      />

    </div>
  );
}

/** Set or change the parent PIN. Changing requires the old PIN first. */
function PinModal({
  open,
  mode,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'set' | 'change';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { dispatch } = useApp();
  const [stage, setStage] = useState<'verify' | 'enter'>(mode === 'change' ? 'verify' : 'enter');
  const [pin, setPin] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [error, setError] = useState<string>();

  const reset = () => {
    setStage(mode === 'change' ? 'verify' : 'enter');
    setPin('');
    setConfirmValue('');
    setError(undefined);
  };

  if (stage === 'verify') {
    return (
      <ParentPinDialog
        open={open}
        title="Enter the current PIN"
        confirmLabel="Continue"
        onCancel={() => {
          reset();
          onClose();
        }}
        onVerified={() => setStage('enter')}
      />
    );
  }

  return (
    <Modal
      open={open}
      title={mode === 'change' ? 'Set a new PIN' : 'Set a parent PIN'}
      subtitle="4–6 digits. LockIn stores only a salted hash."
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const check = validatePinFormat(pin);
          if (!check.ok) {
            setError(check.error);
            return;
          }
          if (pin !== confirmValue) {
            setError('The two PINs don’t match.');
            return;
          }
          dispatch({ type: 'SET_PIN', pin: await createPin(pin) });
          toast('Parent PIN saved.', 'success');
          reset();
          onSaved();
        }}
      >
        <Field label="New PIN" error={error}>
          <TextInput
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin}
            placeholder="••••"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field label="Confirm PIN">
          <TextInput
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={confirmValue}
            placeholder="••••"
            onChange={(e) => setConfirmValue(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!pin || !confirmValue}>
            Save PIN
          </Button>
        </div>
      </form>
    </Modal>
  );
}
