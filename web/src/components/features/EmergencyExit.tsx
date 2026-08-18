/**
 * Emergency exit. Deliberately always available in Strict Mode: a study tool
 * must never trap someone during a real emergency. The friction is a 3-second
 * press-and-hold plus a logged reason, not a locked door.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Field';
import { Icon } from '../ui/Icon';

/** Kept module-local so this file stays Fast Refresh friendly. */
const EXIT_REASONS = [
  'School site blocked',
  'Technical problem',
  'Urgent family situation',
  'Assignment changed',
  'Other',
] as const;

const HOLD_MS = 3000;

export function EmergencyExit({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [held, setHeld] = useState(0);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (open) {
      setReason(null);
      setHeld(0);
    }
  }, [open]);

  const stopHold = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    rafRef.current = null;
    timerRef.current = null;
    setHeld(0);
  };

  useEffect(() => stopHold, []);

  /**
   * Completion is driven by a timer, not by the animation frame loop: rAF is
   * throttled or stopped outright when the tab is occluded, and a hold that
   * silently never finishes would be a bad way to fail during an emergency.
   * The frame loop only paints the fill.
   */
  const startHold = () => {
    if (!reason || timerRef.current !== null) return;
    startRef.current = performance.now();

    timerRef.current = window.setTimeout(() => {
      stopHold();
      onConfirm(reason);
    }, HOLD_MS);

    const step = () => {
      const pct = Math.min(1, (performance.now() - startRef.current) / HOLD_MS);
      setHeld(pct);
      if (pct < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  return (
    <Modal
      open={open}
      title="Emergency exit"
      subtitle="This turns off Focus Mode and unblocks every site right away."
      onClose={() => {
        stopHold();
        onClose();
      }}
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-semibold lk-strong">What’s going on?</p>
          <div className="flex flex-wrap gap-2">
            {EXIT_REASONS.map((r) => (
              <Chip key={r} active={reason === r} onClick={() => setReason(r)}>
                {r}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <button
            type="button"
            disabled={!reason}
            onPointerDown={startHold}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            // touch-none stops a long press turning into a scroll/selection
            // gesture, which would cancel the hold on phones.
            className="relative w-full touch-none overflow-hidden rounded-2xl bg-flame-600 px-5 py-4 text-center font-bold text-white transition-opacity select-none disabled:opacity-40"
          >
            <span
              className="absolute inset-y-0 left-0 bg-black/25 transition-none"
              style={{ width: `${held * 100}%` }}
              aria-hidden
            />
            <span className="relative flex items-center justify-center gap-2">
              <Icon name="alert" size={17} />
              {held > 0 ? 'Keep holding…' : 'Hold to confirm exit'}
            </span>
          </button>
          <p className="mt-2 text-center text-xs lk-muted">
            {reason ? 'Press and hold for 3 seconds.' : 'Pick a reason first.'}
          </p>
        </div>

        <Button
          variant="secondary"
          block
          onClick={() => {
            stopHold();
            onClose();
          }}
        >
          Never mind, stay locked in
        </Button>
      </div>
    </Modal>
  );
}
