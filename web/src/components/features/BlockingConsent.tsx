/**
 * "Allow LockIn to block distracting websites?" — the permission-style ask.
 *
 * Blocking is the most invasive thing LockIn does, and until Phase 9 it was
 * presented as a chore ("go to chrome://extensions and load unpacked"). That
 * is backwards: the install is the *mechanism*, the decision is the point, and
 * the decision belongs to the student.
 *
 * So this asks the way a browser permission asks, and holds itself to the same
 * standards:
 *
 *   - **Specific.** It names exactly what access is granted and what it is for.
 *   - **Informed.** It says what LockIn will and will not be able to see.
 *   - **Refusable.** "Not now" is a real answer that leads somewhere real —
 *     Focus Guard — rather than a dead end or a loop back to the same prompt.
 *   - **Revocable.** It says how to undo it, before it is done.
 *
 * Deliberately not a browser permission dialog lookalike. Imitating Chrome's
 * own UI to borrow its authority is a dark pattern, and this needs to read as
 * LockIn asking, honestly, for something it cannot take.
 */
import { useState } from 'react';
import { useApp } from '../../store/context';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';

export function BlockingConsent({
  onDecided,
  compact,
}: {
  /** Called after either answer, so a host step can move on. */
  onDecided?: (allowed: boolean) => void;
  compact?: boolean;
}) {
  const { state, dispatch, extension } = useApp();
  const [showing, setShowing] = useState<'ask' | 'how'>(
    extension.status === 'connected' ? 'how' : 'ask',
  );

  const connected = extension.status === 'connected';

  const answer = (allowed: boolean) => {
    dispatch({ type: 'UPDATE_SETTINGS', patch: { blockingAsked: true } });
    if (allowed) {
      setShowing('how');
    } else {
      // Refusing turns blocking off rather than leaving it armed-but-broken.
      // A setting that says "on" while nothing is blocked is the dishonesty
      // this whole screen exists to avoid.
      dispatch({ type: 'UPDATE_SETTINGS', patch: { blockingEnabled: false } });
      toast('No problem — Focus Guard is on instead.', 'info');
    }
    onDecided?.(allowed);
  };

  if (connected) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-mint-500/40 bg-mint-400/10 p-4">
        <Icon name="shield" size={20} aria-hidden className="mt-0.5 shrink-0 text-mint-600 dark:text-mint-400" />
        <div className="text-sm">
          <p className="font-bold lk-strong">Website blocking is allowed</p>
          <p className="mt-0.5 lk-muted">
            LockIn can block the sites on your list while Focus Mode is running. You can turn this
            off at any time in Settings, or by removing the extension from Chrome.
          </p>
        </div>
      </div>
    );
  }

  if (showing === 'ask') {
    return (
      <div className="rounded-2xl border lk-border lk-raised p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
            <Icon name="shield" size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight lk-strong">
              Allow LockIn to block distracting websites?
            </h2>
            <p className="mt-1 text-sm leading-relaxed lk-muted">
              Only while <strong className="lk-strong">you</strong> have Focus Mode running, and
              only the sites on the list you choose.
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-2 text-sm">
          <Line ok>Redirect the sites on your blocked list to a LockIn page</Line>
          <Line ok>Count how many times each of those sites was blocked</Line>
          <Line>see which pages you visit, or your history</Line>
          <Line>block anything while Focus Mode is off</Line>
          <Line>send anything anywhere — it all stays on this device</Line>
        </ul>

        <p className="mt-4 rounded-xl lk-sunken p-3 text-xs leading-relaxed lk-muted">
          Saying yes means installing the LockIn Chrome extension — a web page can’t block
          websites on its own, and no browser lets one. It takes about a minute, and you can
          remove it from <code className="rounded bg-black/10 px-1 dark:bg-white/10">chrome://extensions</code>{' '}
          whenever you like.
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="secondary" block onClick={() => answer(false)}>
            Not now
          </Button>
          <Button block onClick={() => answer(true)}>
            Allow blocking
          </Button>
        </div>

        <p className="mt-3 text-center text-xs lk-muted">
          Either way, LockIn still plans your work and notices when you wander off.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border lk-border lk-raised p-5">
      <h2 className="text-base font-extrabold tracking-tight lk-strong">
        One-minute setup
      </h2>
      <p className="mt-1 text-sm lk-muted">
        Chrome won’t let a page install this for you, so these four steps are yours.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm lk-muted">
        <li>
          Open a new tab and go to{' '}
          <code className="rounded bg-black/10 px-1 dark:bg-white/10">chrome://extensions</code>
        </li>
        <li>
          Turn on <strong className="lk-strong">Developer mode</strong> (top right)
        </li>
        <li>
          Click <strong className="lk-strong">Load unpacked</strong> and choose the{' '}
          <code className="rounded bg-black/10 px-1 dark:bg-white/10">lockin/extension</code>{' '}
          folder — the one that has{' '}
          <code className="rounded bg-black/10 px-1 dark:bg-white/10">manifest.json</code> directly
          inside it, <strong className="lk-strong">not</strong> the outer{' '}
          <code className="rounded bg-black/10 px-1 dark:bg-white/10">lockin</code> folder
        </li>
        <li>Come back here and reload this tab</li>
      </ol>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            const ok = await extension.test();
            toast(
              ok ? 'Connected — blocking is ready.' : 'Not responding yet. Reload this tab and try again.',
              ok ? 'success' : 'error',
            );
          }}
        >
          Check again
        </Button>
        {!compact && (
          <Button variant="ghost" onClick={() => answer(false)}>
            Skip for now
          </Button>
        )}
      </div>

      {state.settings.focusGuard && (
        <p className="mt-4 text-xs lk-muted">
          Until then, Focus Guard is watching this tab — see below.
        </p>
      )}
    </div>
  );
}

/**
 * A capability line. The `ok` ones are what LockIn gains; the rest are what it
 * still cannot do — listed on purpose, because a permission prompt that only
 * lists powers is a sales pitch.
 */
function Line({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon
        name={ok ? 'check' : 'close'}
        size={15}
        aria-hidden
        className={ok ? 'mt-0.5 shrink-0 text-mint-600' : 'mt-0.5 shrink-0 lk-muted'}
      />
      <span className={ok ? 'lk-strong' : 'lk-muted'}>
        {ok ? '' : 'It still can’t '}
        {children}
      </span>
    </li>
  );
}
