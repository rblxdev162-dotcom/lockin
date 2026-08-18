/**
 * Focus Guard, on the Focus page.
 *
 * The tone here is doing a lot of work. The evidence on friction-based
 * self-control tools is that reactance — "this is annoying, I'm turning it
 * off" — is the main way they fail, and guilt is the fastest route to it. So
 * this shows a number and a fact, and never a judgement: no red, no "you
 * failed", no exclamation marks, nothing that scolds.
 *
 * The model is Forest, whose whole mechanism is making the cost of leaving
 * *visible* rather than punishing it. LockIn cannot stop anyone leaving, so
 * the honest move is to notice, count, and leave the conclusion to them.
 */
import { useApp } from '../../store/context';
import { useFocusGuard } from '../../hooks/useFocusGuard';
import { Card, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Toggle } from '../ui/Field';
import { describeTally, formatAway } from '../../lib/focusGuard';

export function FocusGuardCard() {
  const { state, dispatch, extension } = useApp();
  const guard = useFocusGuard();

  const blocking = extension.status === 'connected' && state.settings.blockingEnabled;

  return (
    <Card>
      <CardHeader
        title="Focus Guard"
        subtitle="Notices when you leave this tab. It can’t stop you."
        action={
          <Badge tone={guard.watching ? 'mint' : 'neutral'}>
            {guard.watching ? 'Watching' : state.settings.focusGuard ? 'Idle' : 'Off'}
          </Badge>
        }
      />

      {guard.watching ? (
        <div className="rounded-2xl lk-sunken p-4">
          {guard.away ? (
            <p className="text-sm font-bold lk-strong">
              You’re away right now — {formatAway(guard.currentMs)}
            </p>
          ) : (
            <p className="text-sm lk-strong">{describeTally(guard)}</p>
          )}
          {guard.count > 0 && !guard.away && (
            <p className="mt-1 text-xs lk-muted">
              Total time away this session: {formatAway(guard.totalMs)}
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-2xl lk-sunken p-4 text-sm lk-muted">
          {state.settings.focusGuard
            ? 'Starts watching when you start Focus Mode.'
            : 'Turned off. LockIn won’t notice when you leave this tab.'}
        </p>
      )}

      <div className="mt-4 space-y-3">
        <Toggle
          label="Notice when I leave this tab"
          description="Counts trips away during Focus Mode and how long they lasted. Trips under 5 seconds are ignored."
          checked={state.settings.focusGuard}
          onChange={(on) => dispatch({ type: 'UPDATE_SETTINGS', patch: { focusGuard: on } })}
        />

        <p className="flex items-start gap-2 rounded-xl border lk-border p-3 text-xs leading-relaxed lk-muted">
          <Icon name="shield" size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            LockIn knows this tab stopped being visible. It does{' '}
            <strong className="lk-strong">not</strong> know where you went — the browser doesn’t
            tell a page that, and LockIn doesn’t ask. Nothing here leaves this device.
          </span>
        </p>

        {!blocking && (
          <p className="text-xs lk-muted">
            Focus Guard notices. It doesn’t block. For sites that actually refuse to open, allow
            website blocking in Settings.
          </p>
        )}
      </div>
    </Card>
  );
}
