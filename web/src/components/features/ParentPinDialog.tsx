/**
 * PIN prompt. Verification lives in lib/pin.ts — this component only collects
 * digits and reports success, so the rules can be reused elsewhere (or tested)
 * without rendering anything.
 */
import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, TextInput } from '../ui/Field';
import { useApp } from '../../store/context';
import { verifyPin } from '../../lib/pin';

const LOCKOUT_AFTER = 5;
const LOCKOUT_MS = 30_000;

export function ParentPinDialog({
  open,
  title,
  description,
  confirmLabel = 'Verify',
  onVerified,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onVerified: () => void;
  onCancel: () => void;
}) {
  const { state } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (open) {
      setPin('');
      setError(undefined);
    }
  }, [open]);

  const locked = Date.now() < lockedUntil;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked || checking) return;
    setChecking(true);
    const ok = await verifyPin(pin, state.parentPin);
    setChecking(false);
    if (ok) {
      setAttempts(0);
      setPin('');
      onVerified();
      return;
    }
    const next = attempts + 1;
    setAttempts(next);
    setPin('');
    if (next >= LOCKOUT_AFTER) {
      setLockedUntil(Date.now() + LOCKOUT_MS);
      setAttempts(0);
      setError('Too many wrong attempts. Try again in 30 seconds.');
    } else {
      setError(`Incorrect PIN. ${LOCKOUT_AFTER - next} attempt${LOCKOUT_AFTER - next === 1 ? '' : 's'} left.`);
    }
  };

  if (!state.parentPin) {
    return (
      <Modal
        open={open}
        title="No parent PIN is set"
        onClose={onCancel}
        footer={<Button onClick={onCancel}>Close</Button>}
      >
        <p className="text-sm lk-muted">
          A parent PIN hasn’t been set up on this device yet. Add one under{' '}
          <strong className="lk-strong">Settings → Parent Controls</strong> to use overrides.
        </p>
      </Modal>
    );
  }

  return (
    <Modal open={open} title={title} subtitle={description} onClose={onCancel}>
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
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={pin.length < 4 || locked || checking}>
            {checking ? 'Checking…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
