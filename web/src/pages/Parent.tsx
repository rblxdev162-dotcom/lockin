/**
 * The Parent Dashboard: a PIN gate, then a calm read-only review of work.
 *
 * Three things this page is careful about.
 *
 * It shows nothing before the PIN — not a summary, not a count, not a
 * silhouette of the week. A dashboard that leaks its headline numbers to
 * whoever opens the URL is not gated.
 *
 * Viewing is read-only. Nothing on the review side dispatches, so opening the
 * dashboard cannot add events to the log the parent is trying to read.
 *
 * It uses the same visual system as the student app, one tone quieter. This is
 * a different room in the same house, not a different house.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/context';
import { useParentSession } from '../hooks/useParentSession';
import { Card, CardHeader, EmptyState } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, TextInput } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { toast } from '../components/ui/Toast';
import { ParentSummary } from '../components/features/parent/ParentSummary';
import { ParentWorkReview } from '../components/features/parent/ParentWorkReview';
import { ParentFocusHistory } from '../components/features/parent/ParentFocusHistory';
import { ParentControlsPanel } from '../components/features/parent/ParentControlsPanel';
import { ParentDataPanel } from '../components/features/parent/ParentDataPanel';
import { verifyPin } from '../lib/pin';
import { cx } from '../lib/cx';

const TABS = ['Overview', 'Work', 'Focus', 'Controls', 'Data'] as const;
type Tab = (typeof TABS)[number];

export function ParentPage() {
  const { state, now } = useApp();
  const session = useParentSession(now);
  const [tab, setTab] = useState<Tab>('Overview');

  // `now` ticks every second; the date object is only rebuilt when the minute
  // changes, so the weekly selectors don't rerun sixty times a minute.
  const minute = Math.floor(now / 60_000);
  const asDate = useMemo(() => new Date(now), [minute]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session.unlocked) {
    return <ParentGate onUnlock={session.unlock} />;
  }

  const hasHistory =
    state.assignments.some((a) => a.status === 'Completed') ||
    state.focusRuns.length > 0 ||
    state.activity.length > 0;

  return (
    <div className="min-h-dvh lk-surface">
      <ParentHeader secondsLeft={session.secondsLeft} onExit={session.lock} />

      <main
        className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
        // Any interaction inside the dashboard pushes the idle timeout out.
        onPointerDown={session.keepAlive}
        onKeyDown={session.keepAlive}
      >
        <nav className="sticky top-0 z-10 -mx-4 mb-5 overflow-x-auto px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex gap-2">
            {TABS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTab(name)}
                aria-current={tab === name ? 'page' : undefined}
                className={cx(
                  'rounded-xl px-3.5 py-2 text-sm font-bold whitespace-nowrap transition-colors',
                  tab === name
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'lk-sunken border lk-border lk-muted hover:lk-strong',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </nav>

        {!hasHistory && tab !== 'Controls' && tab !== 'Data' ? (
          <Card>
            <EmptyState
              icon={<Icon name="shield" size={26} />}
              title="No accountability history yet"
              hint="Verification and Focus Mode activity will appear here as LockIn is used."
            />
          </Card>
        ) : (
          <>
            {tab === 'Overview' && <ParentSummary state={state} now={asDate} />}
            {tab === 'Work' && <ParentWorkReview state={state} now={asDate} />}
            {tab === 'Focus' && <ParentFocusHistory state={state} />}
            {tab === 'Controls' && <ParentControlsPanel state={state} now={now} />}
            {tab === 'Data' && <ParentDataPanel state={state} now={asDate} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ParentHeader({ secondsLeft, onExit }: { secondsLeft: number; onExit: () => void }) {
  const navigate = useNavigate();
  const minutes = Math.floor(secondsLeft / 60);

  return (
    <header className="mb-2 border-b lk-border">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
          <Icon name="shield" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-lg leading-tight font-extrabold tracking-tight lk-strong">LockIn</p>
          <p className="text-xs font-semibold lk-muted">Parent View</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Badge tone="neutral">
            {minutes > 0 ? `Locks in ${minutes} min` : `Locks in ${secondsLeft}s`}
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="lock" size={15} />}
            onClick={() => {
              onExit();
              navigate('/home');
            }}
          >
            Exit Parent View
          </Button>
        </div>
      </div>
    </header>
  );
}

/**
 * The gate.
 *
 * Wrong-PIN handling is the existing behaviour from `ParentPinDialog` — five
 * attempts, then a thirty-second pause — rather than a second lockout scheme
 * with its own rules to keep in step.
 */
const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 30_000;

function ParentGate({ onUnlock }: { onUnlock: () => void }) {
  const { state } = useApp();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [checking, setChecking] = useState(false);

  const locked = Date.now() < lockedUntil;

  // Never leave the digits sitting in state after we're done with them.
  useEffect(() => () => setPin(''), []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (locked || checking) return;
    setChecking(true);
    const ok = await verifyPin(pin, state.parentPin);
    setChecking(false);
    setPin('');

    if (ok) {
      setAttempts(0);
      setError(undefined);
      onUnlock();
      return;
    }
    const next = attempts + 1;
    setAttempts(next);
    if (next >= LOCKOUT_AFTER) {
      setLockedUntil(Date.now() + LOCKOUT_MS);
      setAttempts(0);
      setError('Too many wrong attempts. Try again in 30 seconds.');
    } else {
      setError(`Incorrect PIN. ${LOCKOUT_AFTER - next} attempt${LOCKOUT_AFTER - next === 1 ? '' : 's'} left.`);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center lk-surface px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
            <Icon name="shield" size={19} />
          </span>
          <div>
            <p className="text-xl leading-tight font-extrabold tracking-tight lk-strong">
              Parent Dashboard
            </p>
            <p className="text-xs font-semibold lk-muted">LockIn · this device only</p>
          </div>
        </div>

        <Card>
          {state.parentPin ? (
            <>
              <CardHeader
                title="Enter parent PIN"
                subtitle="The same PIN used for overrides and temporary unlocks."
              />
              <form onSubmit={submit} className="space-y-4">
                <Field label="Parent PIN" error={error}>
                  <TextInput
                    autoFocus
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={pin}
                    disabled={locked}
                    placeholder="••••"
                    aria-label="Parent PIN"
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="secondary" onClick={() => navigate('/home')}>
                    Back to Student View
                  </Button>
                  <Button type="submit" disabled={pin.length < 4 || locked || checking}>
                    {checking ? 'Checking…' : 'Unlock'}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <>
              <CardHeader
                title="No parent PIN is set"
                subtitle="The dashboard needs one before it can be opened."
              />
              <p className="text-sm lk-muted">
                Set a PIN under <strong className="lk-strong">Settings → Parent controls</strong>.
                It is hashed with a random salt and the digits are never stored.
              </p>
              <Button
                className="mt-4"
                onClick={() => {
                  navigate('/settings');
                  toast('Set a parent PIN under Parent controls.', 'info');
                }}
              >
                Go to Settings
              </Button>
            </>
          )}
        </Card>

        <p className="mt-4 text-center text-xs lk-muted">
          The dashboard locks itself after a few minutes idle, and again whenever this page is
          reloaded or the browser is restarted.
        </p>
      </div>
    </div>
  );
}
