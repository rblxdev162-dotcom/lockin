/**
 * The Check Canvas button.
 *
 * One control, and the only thing in LockIn that touches Canvas. It says what
 * it will do before it does it, and when the gate refuses it says which rule
 * refused and offers the one honest way past — an explicit second press that
 * is recorded as an override.
 *
 * The "open Canvas → Grades" hint is shown *before* the press when the app can
 * already tell the active tab is not Canvas, rather than as an error
 * afterwards. Telling somebody what they should have done is worse than
 * telling them what to do.
 */
import { useState } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useCanvasCheck } from '../../hooks/useCanvasCheck';
import { useApp } from '../../store/context';
import { relativeTime } from '../../lib/time';
import { cx } from '../../lib/cx';

export function CheckCanvasButton({
  size = 'sm',
  className,
  showStatus = true,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showStatus?: boolean;
}) {
  const { state, now } = useApp();
  const { check, busy, lastRefusal, preview, explain } = useCanvasCheck();
  const [offeringOverride, setOfferingOverride] = useState(false);

  const connected = state.canvas.connection !== null;
  const lastRead = state.grades.lastReadAt ?? state.canvas.connection?.lastSeenAt ?? null;

  const run = async (override: boolean) => {
    const result = await check({ override });
    setOfferingOverride(!!result.refusal?.overridable);
  };

  return (
    <div className={cx('min-w-0', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size={size}
          variant="secondary"
          icon={<Icon name="refresh" size={15} />}
          disabled={busy || !connected}
          onClick={() => void run(false)}
        >
          {busy ? 'Reading…' : 'Check Canvas'}
        </Button>

        {offeringOverride && lastRefusal?.overridable && (
          <Button size={size} variant="ghost" onClick={() => void run(true)}>
            I'm not at school — check anyway
          </Button>
        )}
      </div>

      {showStatus && (
        <p className="mt-1.5 text-caption lk-muted">
          {!connected ? (
            'Connect Canvas in Settings to check what is graded.'
          ) : lastRefusal ? (
            explain(lastRefusal)
          ) : !preview.allowed ? (
            // Said before the press, not after it — and once, not twice: the
            // explanation already names the time the window opens.
            explain(preview)
          ) : (
            <>
              Open a class → <strong>Grades</strong> for what's done, or{' '}
              <strong>/grades</strong> for class totals, then press this.
              {lastRead && <> Last read {relativeTime(lastRead, new Date(now))}.</>}
            </>
          )}
        </p>
      )}
    </div>
  );
}
