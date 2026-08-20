import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AppState, FocusSession } from '../types';
import { useApp } from '../store/context';
import { Card, CardHeader, EmptyState } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Chip, Field, TextInput } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import { ProgressBar } from '../components/ui/Progress';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { ParentPinDialog } from '../components/features/ParentPinDialog';
import { EmergencyExit } from '../components/features/EmergencyExit';
import { FocusGuardCard } from '../components/features/FocusGuardCard';
import { toast } from '../components/ui/Toast';
import {
  blockingActive,
  dueSoon,
  dueTimestamp,
  isComplete,
  requiredAssignments,
  sessionElapsedMs,
  sortByDue,
} from '../lib/selectors';
import { verifyPin } from '../lib/pin';
import { formatClock } from '../lib/time';
import { prettyPlural } from '../lib/text';
import { useCanvas } from '../hooks/useCanvas';
import { CanvasStatusBadge } from '../components/features/CanvasStatusBadge';
import { cx } from '../lib/cx';

const PRESETS = [15, 25, 45, 60];
const UNLOCK_OPTIONS = [10, 15, 30];

export function FocusPage() {
  const { state, dispatch, now, extension } = useApp();
  const [params, setParams] = useSearchParams();
  const { openInCanvas, checkStatus, busy: canvasBusy } = useCanvas();

  const unfinished = useMemo(
    () => sortByDue(state.assignments.filter((a) => !isComplete(a))),
    [state.assignments],
  );

  /* ---------------- timer ---------------- */
  const session = state.activeSession;
  const [selectedId, setSelectedId] = useState<string>('');
  const [minutes, setMinutes] = useState(state.settings.defaultFocusMinutes);
  const [customMinutes, setCustomMinutes] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    const fromLink = params.get('assignment');
    if (fromLink) {
      setSelectedId(fromLink);
      params.delete('assignment');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  // /focus?unlock=<domain> — the block page's "request temporary access".
  const [unlockRequest, setUnlockRequest] = useState<string | null>(null);
  useEffect(() => {
    const domain = params.get('unlock');
    if (!domain) return;
    params.delete('unlock');
    setParams(params, { replace: true });
    setUnlockRequest(domain.slice(0, 80));
  }, [params, setParams]);

  const elapsedMs = sessionElapsedMs(session, now);
  const plannedMs = (session?.plannedMinutes ?? minutes) * 60_000;
  const overrun = elapsedMs > plannedMs;
  const sessionAssignment = session?.assignmentId
    ? state.assignments.find((a) => a.id === session.assignmentId)
    : null;
  // A session started from a planned exam chunk runs on this same timer; only
  // the label differs, and the minutes are credited to the exam on END_SESSION.
  const sessionExam = session?.examId
    ? state.exams.find((e) => e.id === session.examId)
    : null;
  const sessionLabel = sessionAssignment?.title ?? sessionExam?.name ?? 'General study';

  // Notify once when the planned time is reached; the timer keeps counting.
  const [chimed, setChimed] = useState(false);
  useEffect(() => {
    if (!session) {
      setChimed(false);
      return;
    }
    if (!chimed && elapsedMs >= plannedMs && session.state === 'running') {
      setChimed(true);
      toast(`${session.plannedMinutes} minutes done. Keep going or end the session.`, 'success');
    }
  }, [session, elapsedMs, plannedMs, chimed]);

  /**
   * What was just finished, held for the completion card.
   *
   * React state rather than derived from `completedSessions`: the summary
   * belongs to *this* visit to the page, and a reload should land on the
   * ordinary Focus screen rather than re-congratulating somebody for a session
   * they finished an hour ago.
   */
  const [justFinished, setJustFinished] = useState<{
    minutes: number;
    label: string;
    completedAssignment: boolean;
  } | null>(null);

  const endSession = (alsoComplete: boolean) => {
    const assignmentId = session?.assignmentId ?? null;
    const finishedMinutes = Math.max(1, Math.round(elapsedMs / 60_000));
    const finishedLabel = sessionLabel;
    dispatch({ type: 'END_SESSION' });
    if (alsoComplete && assignmentId) {
      dispatch({ type: 'COMPLETE_ASSIGNMENT', id: assignmentId, method: 'timer' });
    }
    setConfirmEnd(false);
    setJustFinished({
      minutes: finishedMinutes,
      label: finishedLabel,
      completedAssignment: alsoComplete && !!assignmentId,
    });
    toast('Study time logged.', 'success');
  };

  /* ---------------- focus mode ---------------- */
  const fm = state.focusMode;
  const required = requiredAssignments(state);
  const remaining = Math.max(0, fm.requiredCompletionCount - fm.completedCount);
  const strict = state.settings.reminderMode === 'Strict';
  const unlocked = fm.temporaryUnlockUntil !== null && fm.temporaryUnlockUntil > now;
  const canEndFreely = !strict || remaining === 0;

  const [setupOpen, setSetupOpen] = useState(false);
  const [pinFor, setPinFor] = useState<'override' | 'unlock' | null>(null);

  // Turn an incoming block-page request into the normal unlock flow.
  useEffect(() => {
    if (unlockRequest) setPinFor('unlock');
  }, [unlockRequest]);
  const [unlockMinutes, setUnlockMinutes] = useState(15);
  const [exitOpen, setExitOpen] = useState(false);
  const [confirmEndFocus, setConfirmEndFocus] = useState(false);

  /**
   * A running session takes the whole screen.
   *
   * The setup form, the history list and the Focus Mode controls are all one
   * tap away when the session ends — but while it runs they are clutter
   * competing with the only thing that matters. This is the difference between
   * a timer that feels like a tool and one that feels like a dashboard widget.
   */
  if (session) {
    return (
      <FocusRunning
        session={session}
        label={sessionLabel}
        subject={sessionAssignment?.subject}
        elapsedMs={elapsedMs}
        plannedMs={plannedMs}
        overrun={overrun}
        extensionConnected={extension.status === 'connected'}
        blockingCount={fm.active ? state.settings.blockedDomains.length : 0}
        onPause={() => dispatch({ type: 'PAUSE_SESSION' })}
        onResume={() => dispatch({ type: 'RESUME_SESSION' })}
        onEnd={() => setConfirmEnd(true)}
        confirm={
          <ConfirmDialog
            open={confirmEnd}
            title="End this session?"
            message={`${Math.round(elapsedMs / 60_000)} minutes will be logged${
              sessionAssignment || sessionExam ? ` against “${sessionLabel}”` : ''
            }.`}
            confirmLabel="End and log"
            onCancel={() => setConfirmEnd(false)}
            onConfirm={() => endSession(false)}
          />
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-title font-extrabold lk-strong">Focus</h1>
        <p className="mt-1 text-body lk-muted">
          A timer logs study time. Focus Mode blocks distractions until the work is done.
        </p>
      </header>

      {justFinished && (
        <FocusComplete
          minutes={justFinished.minutes}
          label={justFinished.label}
          completedAssignment={justFinished.completedAssignment}
          nextLine={completionLine(state, now)}
          onDismiss={() => setJustFinished(null)}
        />
      )}

      {/* ================= Timer ================= */}
      <Card>
        <CardHeader title="Focus session" subtitle="Pick something to work on" />

          <div className="space-y-4">
            <Field label="What are you working on?">
              <select
                className="lk-input"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                <option value="">General study (no assignment)</option>
                {unfinished.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.subject ? `${a.subject} — ` : ''}
                    {a.title}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="How long?">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((m) => (
                  <Chip
                    key={m}
                    active={minutes === m && customMinutes === ''}
                    onClick={() => {
                      setMinutes(m);
                      setCustomMinutes('');
                    }}
                  >
                    {m} min
                  </Chip>
                ))}
                <Chip
                  active={customMinutes !== ''}
                  onClick={() => setCustomMinutes(String(minutes))}
                >
                  Custom
                </Chip>
              </div>
            </Field>

            {customMinutes !== '' && (
              <Field label="Custom length (minutes)">
                <TextInput
                  type="number"
                  min={1}
                  max={240}
                  autoFocus
                  value={customMinutes}
                  onChange={(e) => {
                    setCustomMinutes(e.target.value);
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 1 && n <= 240) setMinutes(n);
                  }}
                />
              </Field>
            )}

            <Button
              size="lg"
              block
              icon={<Icon name="play" size={17} />}
              onClick={() => {
                dispatch({
                  type: 'START_SESSION',
                  assignmentId: selectedId || null,
                  minutes: Math.min(240, Math.max(1, minutes)),
                });
                toast(`${minutes}-minute session started.`, 'success');
              }}
            >
              Start {minutes}-minute session
            </Button>
          </div>
      </Card>

      {/* ================= Focus Mode ================= */}
      <Card
        className={cx(fm.active && !unlocked && 'border-brand-500 ring-1 ring-brand-500/30')}
      >
        <CardHeader
          title="Focus Mode"
          subtitle={
            fm.active
              ? 'Distraction blocking is armed'
              : 'Blocks distracting websites until required work is done'
          }
          action={
            <Badge tone={fm.active ? (unlocked ? 'mint' : 'brand') : 'neutral'}>
              {fm.active ? (unlocked ? 'UNLOCKED' : 'ACTIVE') : 'OFF'}
            </Badge>
          }
        />

        {extension.status !== 'connected' && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            <span>
              The Chrome extension isn’t connected, so Focus Mode will track progress but nothing
              will actually be blocked. Install it from Settings → Browser Protection.
            </span>
          </div>
        )}

        {!fm.active ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Sites you’ll block', value: state.settings.blockedDomains.length },
                { label: 'Always allowed', value: state.settings.allowedDomains.length },
                { label: 'Unfinished work', value: unfinished.length },
              ].map((s) => (
                <div key={s.label} className="lk-sunken rounded-2xl border lk-border p-3 text-center">
                  <p className="text-2xl font-extrabold lk-strong">{s.value}</p>
                  <p className="text-[0.7rem] font-semibold lk-muted">{s.label}</p>
                </div>
              ))}
            </div>
            <Button
              size="lg"
              block
              icon={<Icon name="lock" size={17} />}
              disabled={unfinished.length === 0}
              onClick={() => setSetupOpen(true)}
            >
              {unfinished.length === 0 ? 'Nothing left to require' : 'Start Focus Mode'}
            </Button>
            {state.settings.blockedDomains.length === 0 && (
              <p className="text-center text-xs lk-muted">
                No distracting sites picked yet — add some in Settings → Blocked Websites.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {fm.requiredCompletionCount > 0 && (
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-sm font-bold lk-strong">
                    Required work: {fm.completedCount} / {fm.requiredCompletionCount} completed
                  </p>
                  <p className="text-xs font-semibold lk-muted">
                    {remaining === 0 ? 'Unlocked' : `${prettyPlural(remaining, 'task')} to go`}
                  </p>
                </div>
                <ProgressBar
                  value={fm.completedCount}
                  max={fm.requiredCompletionCount}
                  tone={remaining === 0 ? 'mint' : 'brand'}
                />
              </div>
            )}

            <div className="space-y-2">
              {required.map((a) => {
                // Canvas-verified work must not be completable by ticking a box
                // here — that would defeat the point of verification.
                const canvasControlled = !!a.canvas && a.completionMethod === 'canvas';
                const verificationControlled = canvasControlled;
                return (
                  <div
                    key={a.id}
                    className="lk-sunken flex items-start gap-3 rounded-2xl border lk-border p-3.5"
                  >
                    {verificationControlled ? (
                      <span
                        title={
                          canvasControlled
                            ? 'Completed through Canvas verification'
                            : 'Completed through Edgenuity screen verification'
                        }
                        className={cx(
                          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border-2',
                          isComplete(a)
                            ? 'border-mint-500 bg-mint-500 text-white'
                            : 'lk-border lk-muted',
                        )}
                      >
                        {isComplete(a) ? (
                          <Icon name="check" size={11} strokeWidth={3} />
                        ) : (
                          <Icon name={canvasControlled ? 'canvas' : 'edgenuity'} size={10} />
                        )}
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`Mark ${a.title} complete`}
                        className="mt-0.5 h-5 w-5 accent-brand-600"
                        checked={isComplete(a)}
                        onChange={() =>
                          dispatch(
                            isComplete(a)
                              ? { type: 'UNCOMPLETE_ASSIGNMENT', id: a.id }
                              : { type: 'COMPLETE_ASSIGNMENT', id: a.id, method: 'manual' },
                          )
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cx(
                          'truncate text-sm font-bold lk-strong',
                          isComplete(a) && 'line-through opacity-60',
                        )}
                      >
                        {a.title}
                      </p>
                      <p className="truncate text-xs lk-muted">
                        {a.subject} · {a.platform}
                      </p>
                      {a.canvas && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <CanvasStatusBadge link={a.canvas} />
                          <button
                            onClick={() => openInCanvas(a.canvas!.url)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline dark:text-brand-300"
                          >
                            <Icon name="external" size={12} />
                            Open in Canvas
                          </button>
                          {!isComplete(a) && (
                            <button
                              onClick={() => checkStatus(a)}
                              disabled={canvasBusy === 'check' || canvasBusy === 'sync'}
                              className="inline-flex items-center gap-1 text-xs font-bold lk-muted hover:lk-strong disabled:opacity-50"
                            >
                              <Icon name="refresh" size={12} />
                              Check Canvas Status
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>


            {required.some((a) => a.canvas) && (
              <p className="text-xs lk-muted">
                Canvas-linked work unlocks automatically once Canvas shows it submitted, graded, or
                submitted late — no need to come back and tick anything.
              </p>
            )}

            <div className="lk-sunken rounded-2xl border lk-border p-3.5 text-xs lk-muted">
              {unlocked ? (
                <>
                  <strong className="lk-strong">Temporary unlock active.</strong> Blocking returns
                  in {formatClock((fm.temporaryUnlockUntil ?? 0) - now)}. Focus Mode stays on.
                </>
              ) : blockingActive(state, now) ? (
                <>
                  Blocking <strong className="lk-strong">{state.settings.blockedDomains.length}</strong>{' '}
                  site{state.settings.blockedDomains.length === 1 ? '' : 's'}. School and Google
                  domains stay open.
                </>
              ) : (
                <>Blocking is currently paused (turned off in Settings, or extension offline).</>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {canEndFreely ? (
                <Button variant="secondary" onClick={() => setConfirmEndFocus(true)}>
                  End Focus Mode
                </Button>
              ) : (
                <Button variant="secondary" disabled title="Strict Mode: finish the required work first">
                  End Focus Mode
                </Button>
              )}
              {unlocked ? (
                <Button
                  variant="secondary"
                  onClick={() => dispatch({ type: 'CANCEL_TEMPORARY_UNLOCK' })}
                >
                  End unlock now
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setPinFor('unlock')}>
                  Temporary unlock
                </Button>
              )}
              <Button variant="secondary" onClick={() => setPinFor('override')}>
                Parent override
              </Button>
              {strict && (
                <Button variant="danger" onClick={() => setExitOpen(true)}>
                  Emergency exit
                </Button>
              )}
            </div>

            {!canEndFreely && (
              <p className="text-xs lk-muted">
                Strict Mode is on: finish {prettyPlural(remaining, 'required task')}, use the parent
                PIN, or use the emergency exit.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ================= Focus Guard ================= */}
      <FocusGuardCard />

      {/* ================= Recent sessions ================= */}
      <Card>
        <CardHeader title="Recent sessions" subtitle="Study time logged on this device" />
        {state.completedSessions.length === 0 ? (
          <EmptyState
            icon={<Icon name="timer" size={26} />}
            title="No sessions yet"
            hint="Finish a focus session and it shows up here."
          />
        ) : (
          <div className="space-y-2">
            {state.completedSessions.slice(0, 6).map((s) => (
              <div
                key={s.id}
                className="lk-sunken flex items-center justify-between gap-3 rounded-xl border lk-border px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold lk-strong">
                    {s.assignmentTitle ?? 'General study'}
                  </p>
                  <p className="text-xs lk-muted">
                    {new Date(s.endedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <Badge tone={s.actualMinutes >= s.plannedMinutes ? 'mint' : 'neutral'}>
                  {s.actualMinutes} / {s.plannedMinutes} min
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ================= Dialogs ================= */}
      <FocusSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onStart={(ids, count) => {
          dispatch({
            type: 'START_FOCUS_MODE',
            requiredTaskIds: ids,
            requiredCompletionCount: count,
          });
          setSetupOpen(false);
          toast('Focus Mode is on. Distractions are blocked.', 'success');
        }}
      />

      <ConfirmDialog
        open={confirmEnd}
        title="End this session?"
        message={`${Math.round(elapsedMs / 60_000)} minutes will be logged${
          sessionAssignment || sessionExam ? ` against “${sessionLabel}”` : ''
        }.`}
        confirmLabel="End and log"
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => endSession(false)}
      />

      <ConfirmDialog
        open={confirmEndFocus}
        title="End Focus Mode?"
        message="Blocked websites become available again right away."
        confirmLabel="End Focus Mode"
        onCancel={() => setConfirmEndFocus(false)}
        onConfirm={() => {
          dispatch({ type: 'END_FOCUS_MODE', reason: 'normal' });
          setConfirmEndFocus(false);
          toast('Focus Mode ended. Sites unblocked.', 'info');
        }}
      />

      <ParentPinDialog
        open={pinFor === 'override'}
        title="Parent override"
        description="Verifying here turns Focus Mode off and unblocks every site. The PIN never leaves this page."
        confirmLabel="Override"
        onCancel={() => setPinFor(null)}
        onVerified={() => {
          dispatch({ type: 'END_FOCUS_MODE', reason: 'override' });
          setPinFor(null);
          toast('Parent override applied. Sites unblocked.', 'info');
        }}
      />

      <Modal
        open={pinFor === 'unlock'}
        title="Temporary unlock"
        subtitle="Focus Mode stays on; blocking pauses and comes back automatically."
        onClose={() => {
          setPinFor(null);
          setUnlockRequest(null);
        }}
      >
        <div className="space-y-4">
          {unlockRequest && (
            <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm font-semibold text-amber-700 dark:text-amber-300">
              Requested from the block page for <strong>{unlockRequest}</strong>. An unlock pauses
              blocking for every site, not just this one.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {UNLOCK_OPTIONS.map((m) => (
              <Chip key={m} active={unlockMinutes === m} onClick={() => setUnlockMinutes(m)}>
                {m} minutes
              </Chip>
            ))}
          </div>
          <ParentPinInline
            onVerified={() => {
              dispatch({ type: 'TEMPORARY_UNLOCK', minutes: unlockMinutes });
              setPinFor(null);
              setUnlockRequest(null);
              toast(`Unlocked for ${unlockMinutes} minutes.`, 'success');
            }}
            onCancel={() => {
              setPinFor(null);
              setUnlockRequest(null);
            }}
          />
        </div>
      </Modal>

      <EmergencyExit
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        onConfirm={(reason) => {
          dispatch({ type: 'END_FOCUS_MODE', reason: 'emergency', note: reason });
          setExitOpen(false);
          toast('Emergency exit used. Everything is unblocked.', 'info');
        }}
      />
    </div>
  );
}

/** PIN entry rendered inside another modal (temporary unlock). */
function ParentPinInline({
  onVerified,
  onCancel,
}: {
  onVerified: () => void;
  onCancel: () => void;
}) {
  const { state } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();

  if (!state.parentPin) {
    return (
      <div className="space-y-3">
        <p className="text-sm lk-muted">
          No parent PIN is set. Temporary unlocks need one — add it in Settings → Parent Controls.
        </p>
        <Button variant="secondary" block onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await verifyPin(pin, state.parentPin)) {
          setPin('');
          onVerified();
        } else {
          setPin('');
          setError('Incorrect PIN.');
        }
      }}
    >
      <Field label="Parent PIN" error={error}>
        <TextInput
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          placeholder="••••"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pin.length < 4}>
          Unlock
        </Button>
      </div>
    </form>
  );
}

/** Choose which assignments must be finished before distractions unlock. */
function FocusSetupModal({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (ids: string[], count: number) => void;
}) {
  const { state } = useApp();
  const candidates = useMemo(() => dueSoon(state, 14), [state]);
  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState(1);

  // Seed the picker each time it opens: preselect up to two tasks and require
  // all of them, which is the choice students make most often.
  useEffect(() => {
    if (!open) return;
    const seed = candidates.slice(0, 2).map((a) => a.id);
    setSelected(seed);
    setCount(Math.max(1, seed.length));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the requirement reachable if tasks are unticked.
  useEffect(() => {
    setCount((c) => Math.max(1, Math.min(selected.length || 1, c)));
  }, [selected.length]);

  return (
    <Modal
      open={open}
      title="Start Focus Mode"
      subtitle="Pick the work that has to be done before distractions unlock."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={selected.length === 0}
            onClick={() => onStart(selected, Math.max(1, Math.min(count, selected.length)))}
          >
            Lock in
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {candidates.length === 0 ? (
          <p className="text-sm lk-muted">
            Nothing unfinished to require. Add an assignment first.
          </p>
        ) : (
          <>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {candidates.map((a) => {
                const on = selected.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className={cx(
                      'flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition-colors',
                      on ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'lk-border lk-sunken',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-brand-600"
                      checked={on}
                      onChange={() =>
                        setSelected((prev) =>
                          on ? prev.filter((id) => id !== a.id) : [...prev, a.id],
                        )
                      }
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold lk-strong">{a.title}</p>
                      <p className="truncate text-xs lk-muted">
                        {a.subject} · {a.platform} · ~{a.estimatedMinutes} min
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            <Field
              label="How many of these must be finished to unlock?"
              hint="Finishing this many required tasks turns Focus Mode off automatically."
            >
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: Math.max(1, selected.length) }, (_, i) => i + 1).map((n) => (
                  <Chip key={n} active={count === n} onClick={() => setCount(n)}>
                    {n}
                  </Chip>
                ))}
              </div>
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}


/* ------------------------------------------------------------------ */
/* The running session                                                 */
/* ------------------------------------------------------------------ */

/**
 * What a focus session looks like while it is running.
 *
 * Four things and nothing else: what you are working on, how long is left,
 * whether protection is actually on, and how to stop. No progress ring inside
 * a card inside a page — the timer *is* the page.
 */
function FocusRunning({
  session,
  label,
  subject,
  elapsedMs,
  plannedMs,
  overrun,
  extensionConnected,
  blockingCount,
  onPause,
  onResume,
  onEnd,
  confirm,
}: {
  session: FocusSession;
  label: string;
  subject?: string;
  elapsedMs: number;
  plannedMs: number;
  overrun: boolean;
  extensionConnected: boolean;
  blockingCount: number;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  confirm: ReactNode;
}) {
  const paused = session.state === 'paused';
  const remaining = overrun ? elapsedMs - plannedMs : plannedMs - elapsedMs;
  const pct = plannedMs > 0 ? Math.min(100, (elapsedMs / plannedMs) * 100) : 0;

  return (
    <div className="animate-fade flex min-h-[70vh] flex-col items-center justify-center py-8 text-center">
      <p className="text-caption font-bold tracking-[0.18em] lk-muted uppercase">
        {paused ? 'Paused' : overrun ? 'Overtime' : 'Focus'}
      </p>

      {subject && <p className="mt-6 text-body font-semibold lk-muted">{subject}</p>}
      <h1 className="mt-0.5 max-w-xl px-4 text-title font-extrabold text-balance lk-strong">
        {label}
      </h1>

      {/*
        The clock is the largest thing on screen by a wide margin. Tabular
        figures so digits do not shift under each other every second — the
        difference between a timer you can glance at and one that pulls the eye
        back.
      */}
      <p
        className={cx(
          'mt-6 font-mono text-[clamp(3.5rem,16vw,6rem)] leading-none font-extrabold tabular-nums',
          overrun ? 'text-mint-600 dark:text-mint-400' : 'lk-strong',
          paused && 'opacity-50',
        )}
        aria-hidden
      >
        {formatClock(remaining)}
      </p>
      {/* The same value for a screen reader, once a minute rather than once a
          second — a per-second live region is unusable. */}
      <span className="sr-only" aria-live="polite">
        {Math.ceil(remaining / 60_000)} minutes {overrun ? 'over' : 'remaining'}
      </span>

      {/* A hairline rather than a ring: quieter, and readable from across a
          desk. */}
      <div
        className="mt-7 h-[3px] w-full max-w-md overflow-hidden rounded-full lk-sunken"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Session progress"
      >
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-1000 ease-linear',
            overrun ? 'bg-mint-500' : 'bg-brand-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {paused ? (
          <Button size="lg" icon={<Icon name="play" size={17} />} onClick={onResume}>
            Resume
          </Button>
        ) : (
          <Button
            size="lg"
            variant="secondary"
            icon={<Icon name="pause" size={17} />}
            onClick={onPause}
          >
            Pause
          </Button>
        )}
        <Button size="lg" variant="ghost" icon={<Icon name="stop" size={17} />} onClick={onEnd}>
          End session
        </Button>
      </div>

      {/*
        Protection state, stated plainly. Invariant 20: LockIn never lets a
        student believe sites are blocked when they are not — and the moment
        that matters most is while they are sitting in front of a timer.
      */}
      <p className="mt-7 flex items-center gap-2 text-caption lk-muted">
        <span
          aria-hidden
          className={cx(
            'h-1.5 w-1.5 rounded-full',
            extensionConnected ? 'bg-mint-500' : 'bg-flame-500',
          )}
        />
        {extensionConnected
          ? blockingCount > 0
            ? `${blockingCount} sites blocked while this runs`
            : 'Companion connected'
          : 'Companion not connected — sites are not being blocked'}
      </p>

      <p className="mt-2 text-caption lk-muted">
        Started{' '}
        {new Date(session.startedAt).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        })}{' '}
        · the timer survives a refresh
      </p>

      {confirm}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Completion                                                          */
/* ------------------------------------------------------------------ */

/**
 * The end of a session, said once and quietly.
 *
 * A short scale-in, a real number, one honest sentence about what is left. No
 * confetti: Phase 9's research is that invented rewards invite arguing about
 * the reward, and the minutes are the real thing that happened.
 */
function FocusComplete({
  minutes,
  label,
  completedAssignment,
  nextLine,
  onDismiss,
}: {
  minutes: number;
  label: string;
  completedAssignment: boolean;
  nextLine: string;
  onDismiss: () => void;
}) {
  return (
    <Card className="lk-card-primary animate-pop relative overflow-hidden">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 rounded-lg p-1.5 lk-muted transition-colors hover:lk-strong"
      >
        <Icon name="close" size={15} />
      </button>

      <p className="text-caption font-bold tracking-[0.18em] lk-muted uppercase">Focus complete</p>
      <p className="mt-2 text-display font-extrabold tabular-nums lk-strong">{minutes} min</p>
      <p className="mt-1 text-body font-semibold lk-strong">{label}</p>
      {completedAssignment && <p className="mt-1 text-body lk-muted">Marked complete.</p>}
      <p className="mt-3 text-body lk-muted">{nextLine}</p>
    </Card>
  );
}

/**
 * One true sentence about what is left tonight.
 *
 * Every branch has to be true of the state it is shown for. Praise for
 * finishing everything, shown while three things are still due, is the fastest
 * way to teach somebody to ignore the app.
 */
function completionLine(state: AppState, now: number): string {
  const tomorrow = now + 36 * 60 * 60 * 1000;
  const open = state.assignments.filter((a) => {
    if (a.status === 'Completed') return false;
    const due = dueTimestamp(a);
    // Undated work counts. `dueTimestamp` returns MAX_SAFE_INTEGER when there
    // is no due date, and excluding it here produced "you're done with
    // everything due tomorrow" while an undated assignment sat unfinished on
    // the same screen — caught in the browser, not by a test.
    if (!Number.isFinite(due) || due === Number.MAX_SAFE_INTEGER) return true;
    return due <= tomorrow;
  });
  if (open.length === 0) return 'You’re done with everything due tomorrow.';
  if (open.length === 1) return `One more to go: “${open[0].title}”.`;
  return `${open.length} more still open.`;
}
