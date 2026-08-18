/**
 * The switches a parent owns, plus live Focus Mode status.
 *
 * Everything here drives the *existing* engines: the Edgenuity proof mode is
 * `settings.edgenuityProofMode` from Phase 5, the unlock is the Phase 2
 * `TEMPORARY_UNLOCK`, and ending a session is the same override the student's
 * PIN dialog uses. No second timer, no second unblock path, no parallel
 * settings store — a parent flipping a switch changes the one value the
 * verification and blocking code already reads.
 */
import { useState } from 'react';
import type { AppState, Assignment } from '../../../types';
import { Card, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Chip, Toggle } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { ConfirmDialog } from '../../ui/Modal';
import { toast } from '../../ui/Toast';
import { useApp } from '../../../store/context';
import { requiredTrustFor } from '../../../lib/edgenuity/verification';
import { effectiveAllowlist } from '../../../lib/selectors';
import { DEFAULT_ALLOWLIST, prettyDomain } from '../../../lib/domains';
import { formatClock } from '../../../lib/time';
import { cx } from '../../../lib/cx';

const UNLOCK_OPTIONS = [10, 15, 30];

export function ParentControlsPanel({ state, now }: { state: AppState; now: number }) {
  const { dispatch } = useApp();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const fm = state.focusMode;
  const remaining = Math.max(0, fm.requiredCompletionCount - fm.completedCount);
  const unlocked = fm.temporaryUnlockUntil !== null && fm.temporaryUnlockUntil > now;
  const [unlockMinutes, setUnlockMinutes] = useState(15);

  const edgenuityAssignments = state.assignments.filter((a) => a.edgenuity);

  return (
    <div className="space-y-5">
      {/* ---------------- Live status ---------------- */}
      <Card className={cx(fm.active && 'border-brand-500 ring-1 ring-brand-500/30')}>
        <CardHeader
          title="Focus Mode"
          subtitle={
            fm.active
              ? 'Distraction blocking is armed right now.'
              : 'Not running. Nothing is being blocked.'
          }
          action={
            <Badge tone={fm.active ? (unlocked ? 'amber' : 'brand') : 'neutral'}>
              {fm.active ? (unlocked ? 'PAUSED' : 'ACTIVE') : 'OFF'}
            </Badge>
          }
        />

        {fm.active ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="Required" value={String(fm.requiredCompletionCount)} />
              <Stat label="Verified" value={String(fm.completedCount)} />
              <Stat
                label="Time active"
                value={
                  fm.startedAt
                    ? `${Math.max(0, Math.round((now - Date.parse(fm.startedAt)) / 60_000))} min`
                    : '—'
                }
              />
            </dl>

            {unlocked && (
              <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
                Temporary unlock active — blocking resumes in{' '}
                {formatClock((fm.temporaryUnlockUntil ?? 0) - now)}. Focus Mode stays on and comes
                back by itself.
              </p>
            )}

            <div>
              <p className="mb-2 text-sm font-bold lk-strong">Approve a temporary unlock</p>
              <div className="flex flex-wrap items-center gap-2">
                {UNLOCK_OPTIONS.map((minutes) => (
                  <Chip
                    key={minutes}
                    active={unlockMinutes === minutes}
                    onClick={() => setUnlockMinutes(minutes)}
                  >
                    {minutes} minutes
                  </Chip>
                ))}
                <Button
                  size="sm"
                  icon={<Icon name="unlock" size={15} />}
                  disabled={unlocked}
                  onClick={() => {
                    dispatch({ type: 'TEMPORARY_UNLOCK', minutes: unlockMinutes, byParent: true });
                    toast(`Blocking paused for ${unlockMinutes} minutes.`, 'success');
                  }}
                >
                  Approve unlock
                </Button>
              </div>
              <p className="mt-2 text-xs lk-muted">
                Pauses blocking without ending the session. Blocking returns on its own — nothing
                needs to be turned back on.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 border-t lk-border pt-3">
              <Button variant="danger" size="sm" onClick={() => setConfirmEnd(true)}>
                End Focus Mode
              </Button>
              {unlocked && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => dispatch({ type: 'CANCEL_TEMPORARY_UNLOCK' })}
                >
                  Resume blocking now
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm lk-muted">
            When Focus Mode is running, this panel shows progress and can approve a temporary
            unlock or end the session.
          </p>
        )}
      </Card>

      {/* ---------------- Verification requirements ---------------- */}
      <Card>
        <CardHeader
          title="Verification requirements"
          subtitle="What counts as proof that required work was done."
        />

        <div className="space-y-4">
          <div className="lk-sunken rounded-2xl border lk-border p-3.5">
            <p className="text-sm font-bold lk-strong">Canvas</p>
            <p className="mt-1 text-xs lk-muted">
              A Canvas assignment counts as verified when Canvas itself reports it submitted,
              graded or submitted late. That comes from the school’s own system, so there is no
              stronger proof for LockIn to ask for and no setting to change.
            </p>
          </div>

          <div>
            <p className="text-sm font-bold lk-strong">Edgenuity proof requirement</p>
            <p className="mt-0.5 mb-2 text-xs lk-muted">
              The minimum for every Edgenuity assignment. An individual assignment can ask for
              more, never less.
            </p>
            {(['standard', 'enhanced'] as const).map((mode) => {
              const on = state.settings.edgenuityProofMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'UPDATE_SETTINGS',
                      patch: { edgenuityProofMode: mode },
                      // The parent is already PIN-authenticated to be here.
                      parentApproved: true,
                    })
                  }
                  className={cx(
                    'mb-2 block w-full rounded-2xl border p-3 text-left transition-colors',
                    on ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'lk-border lk-sunken',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cx(
                        'grid h-4 w-4 shrink-0 place-items-center rounded-full border-2',
                        on ? 'border-brand-500 bg-brand-500 text-white' : 'lk-border',
                      )}
                    >
                      {on && <Icon name="check" size={9} strokeWidth={3} />}
                    </span>
                    <span className="text-sm font-bold lk-strong">
                      {mode === 'standard' ? 'Standard' : 'Enhanced'}
                    </span>
                  </span>
                  <span className="mt-1 block pl-6 text-xs lk-muted">
                    {mode === 'standard'
                      ? 'Live camera photo of the progress screen, read on this device.'
                      : 'The same, plus a one-time code that must appear in the same photo.'}
                  </span>
                </button>
              );
            })}
            <p className="text-xs lk-muted">
              Enhanced Proof makes previously prepared screenshots much harder to reuse. It cannot
              prove a screen is genuine, and it asks the student to write a code down for every
              check.
            </p>
          </div>
        </div>
      </Card>

      {/* ---------------- Per-assignment requirement ---------------- */}
      {edgenuityAssignments.length > 0 && (
        <Card>
          <CardHeader
            title="Per-assignment requirement"
            subtitle="Raise the bar for one piece of work without changing the default."
          />
          <div className="space-y-2">
            {edgenuityAssignments.map((assignment) => (
              <AssignmentTrustRow
                key={assignment.id}
                assignment={assignment}
                globalFloor={state.settings.edgenuityProofMode}
              />
            ))}
          </div>
          <p className="mt-3 text-xs lk-muted">
            Changes apply to future verifications. Work already completed under the rule that
            applied at the time stays completed.
          </p>
        </Card>
      )}

      {/* ---------------- Protection switches ---------------- */}
      <Card>
        <CardHeader
          title="Protected settings"
          subtitle="What the student needs the PIN to change."
        />
        <div className="space-y-1 divide-y lk-border">
          <Toggle
            checked={state.parentControls.lockVerificationSettings}
            onChange={(on) =>
              dispatch({ type: 'PARENT_SET_CONTROLS', patch: { lockVerificationSettings: on } })
            }
            label="Lock verification settings"
            description="The Edgenuity proof requirement and per-assignment requirements need the PIN to change."
          />
          <Toggle
            checked={state.parentControls.protectBlocklistInStrictMode}
            onChange={(on) =>
              dispatch({ type: 'PARENT_SET_CONTROLS', patch: { protectBlocklistInStrictMode: on } })
            }
            label="Protect blocked sites during Strict Mode"
            description="Removing a blocked site mid-session needs the PIN. Adding one never does."
          />
          <Toggle
            checked={state.parentControls.protectAllowlistInStrictMode}
            onChange={(on) =>
              dispatch({ type: 'PARENT_SET_CONTROLS', patch: { protectAllowlistInStrictMode: on } })
            }
            label="Protect the school allowlist during Strict Mode"
            description="Widening the allowlist mid-session needs the PIN — that is how an escape route would be carved."
          />
        </div>
        <p className="mt-3 text-xs lk-muted">
          None of these touch ordinary studying. Adding assignments, starting timers, editing
          titles and opening Canvas or Edgenuity stay entirely the student’s to do.
        </p>
      </Card>

      {/* ---------------- School access ---------------- */}
      <Card>
        <CardHeader
          title="School access"
          subtitle="Always reachable, whatever else is blocked."
        />
        <div className="flex flex-wrap gap-2">
          {effectiveAllowlist(state).map((domain) => {
            const isCanvas = domain === state.canvas.connection?.domain;
            const isProtected = DEFAULT_ALLOWLIST.includes(domain);
            return (
              <span
                key={domain}
                className="lk-sunken inline-flex items-center gap-1.5 rounded-xl border lk-border px-2.5 py-1.5 text-xs"
              >
                <span className="font-semibold lk-strong">{prettyDomain(domain)}</span>
                {isCanvas && <Badge tone="brand">Canvas</Badge>}
                {isProtected && <Badge tone="neutral">Protected</Badge>}
              </span>
            );
          })}
        </div>
        <p className="mt-3 text-xs lk-muted">
          Google Search, Docs, Drive and Classroom, the connected Canvas domain, Edgenuity and
          LockIn itself are protected in code. No setting on this page — parent or student — can
          block them, and the emergency exit always works.
        </p>
      </Card>

      <ConfirmDialog
        open={confirmEnd}
        danger
        title="End Focus Mode?"
        message={
          remaining > 0
            ? `${remaining} required assignment${remaining === 1 ? ' is' : 's are'} still incomplete. Blocked sites become available again right away.`
            : 'Blocked sites become available again right away.'
        }
        confirmLabel="End Focus Mode"
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          // The existing parent-override path: recorded once, by the reducer.
          dispatch({ type: 'END_FOCUS_MODE', reason: 'override' });
          setConfirmEnd(false);
          toast('Focus Mode ended. Recorded as a parent override.', 'info');
        }}
      />
    </div>
  );
}

function AssignmentTrustRow({
  assignment,
  globalFloor,
}: {
  assignment: Assignment;
  globalFloor: 'standard' | 'enhanced';
}) {
  const { dispatch } = useApp();
  const config = assignment.edgenuity!.config;
  const own = config.requiredVerificationTrust ?? 'standard';
  const effective = requiredTrustFor(config, globalFloor);
  // The floor already demands Enhanced, so a per-assignment switch here could
  // only appear to lower it — which it must never do.
  const forcedByDefault = globalFloor === 'enhanced';

  return (
    <div className="lk-sunken flex flex-wrap items-center justify-between gap-2 rounded-xl border lk-border px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold lk-strong">{assignment.title}</p>
        <p className="text-xs lk-muted">
          Default: {globalFloor === 'enhanced' ? 'Enhanced' : 'Standard'} · Requirement:{' '}
          <span className="font-semibold lk-strong">
            {effective === 'enhanced' ? 'Enhanced' : 'Standard'}
          </span>
        </p>
      </div>
      {forcedByDefault ? (
        <Badge tone="brand">Enhanced by default</Badge>
      ) : (
        <Toggle
          checked={own === 'enhanced'}
          onChange={(on) =>
            dispatch({
              type: 'PARENT_SET_ASSIGNMENT_TRUST',
              assignmentId: assignment.id,
              trust: on ? 'enhanced' : 'standard',
            })
          }
          label="Require Enhanced"
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lk-sunken rounded-2xl border lk-border p-3 text-center">
      <dd className="text-xl font-extrabold lk-strong">{value}</dd>
      <dt className="text-[0.7rem] font-semibold lk-muted">{label}</dt>
    </div>
  );
}
