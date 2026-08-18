/**
 * Settings → Data (Phase 8).
 *
 * Export, three scoped clears, and the full reset. Two rules run through it:
 *
 *  - **Every destructive action confirms**, and says exactly what survives.
 *  - **Clearing history needs the parent PIN when one is set.** History is the
 *    accountability record; a student who can quietly erase last night's
 *    emergency exit has a Parent Dashboard that reports nothing. Export never
 *    needs a PIN — reading your own data is not a privileged act.
 *
 * The clears reuse `PARENT_CLEAR_HISTORY` rather than adding new actions, so
 * there is still exactly one code path that can delete history.
 */
import { useState } from 'react';
import { useApp } from '../../store/context';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { ConfirmDialog } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';
import { ParentPinDialog } from './ParentPinDialog';
import { buildExport, downloadExport } from '../../lib/export';
import { APP_VERSION } from '../../version';

type Scope = 'activity' | 'focus' | 'verification';

const SCOPE_COPY: Record<Scope, { label: string; detail: string; confirm: string }> = {
  activity: {
    label: 'Clear activity history',
    detail: 'The timeline on the Activity page.',
    confirm:
      'The activity timeline will be deleted from this device. Your assignments, exams, plan and settings are not affected.',
  },
  focus: {
    label: 'Clear focus history',
    detail: 'Finished focus sessions and past Focus Mode runs.',
    confirm:
      'Finished focus sessions and past Focus Mode runs will be deleted. Minutes already logged against assignments stay logged, and nothing else is affected.',
  },
  verification: {
    label: 'Clear verification history',
    detail: 'Canvas and Edgenuity verification records.',
    confirm:
      'Verification records and the Edgenuity session log will be deleted. Assignments already marked complete stay complete — only the evidence trail is removed.',
  },
};

export function DataPanel() {
  const { state, dispatch } = useApp();
  const [confirmScope, setConfirmScope] = useState<Scope | null>(null);
  const [pinScope, setPinScope] = useState<Scope | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const pinSet = state.parentPin !== null;

  const clear = (scope: Scope) => {
    dispatch({ type: 'PARENT_CLEAR_HISTORY', scope });
    setConfirmScope(null);
    setPinScope(null);
    toast(`${SCOPE_COPY[scope].label.replace('Clear', 'Cleared')}.`, 'info');
  };

  return (
    <Card id="data">
      <CardHeader
        title="Your data"
        subtitle="Everything below is stored on this device only. Nothing is uploaded anywhere."
      />

      <div className="space-y-4">
        <div className="rounded-2xl border lk-border p-4">
          <p className="text-sm font-bold lk-strong">Export my LockIn data</p>
          <p className="mt-1 text-sm leading-relaxed lk-muted">
            Downloads a readable JSON file with your assignments, exams, plan, focus history and
            verification summaries. It deliberately leaves out your parent PIN, verification
            challenge codes and anything camera-related — LockIn can’t import the file back.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            icon={<Icon name="external" size={16} aria-hidden />}
            onClick={() => {
              downloadExport(buildExport(state, APP_VERSION));
              toast('Export downloaded.', 'success');
            }}
          >
            Export my data
          </Button>
        </div>

        <div className="space-y-2">
          {(Object.keys(SCOPE_COPY) as Scope[]).map((scope) => (
            <div
              key={scope}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border lk-border p-3.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold lk-strong">{SCOPE_COPY[scope].label}</p>
                <p className="text-xs lk-muted">
                  {SCOPE_COPY[scope].detail}
                  {pinSet && ' Needs the parent PIN.'}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setConfirmScope(scope)}>
                Clear
              </Button>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-flame-500/40 p-4">
          <p className="text-sm font-bold lk-strong">Reset LockIn</p>
          <p className="mt-1 text-sm leading-relaxed lk-muted">
            Erases everything LockIn has stored on this device, including your assignments, exams,
            plan, history and parent PIN. There is no undo, so export first if you want a copy.
          </p>
          <Button className="mt-3" variant="danger" onClick={() => setResetOpen(true)}>
            Erase all LockIn data
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmScope !== null}
        danger
        title={confirmScope ? SCOPE_COPY[confirmScope].label + '?' : ''}
        confirmLabel={pinSet ? 'Enter parent PIN' : 'Clear'}
        message={confirmScope ? SCOPE_COPY[confirmScope].confirm : ''}
        onCancel={() => setConfirmScope(null)}
        onConfirm={() => {
          if (!confirmScope) return;
          if (pinSet) {
            setPinScope(confirmScope);
            setConfirmScope(null);
          } else {
            clear(confirmScope);
          }
        }}
      />

      <ParentPinDialog
        open={pinScope !== null}
        title="Parent PIN required"
        description="Clearing history removes part of the accountability record, so it needs the parent PIN."
        confirmLabel="Clear history"
        onCancel={() => setPinScope(null)}
        onVerified={() => pinScope && clear(pinScope)}
      />

      <ConfirmDialog
        open={resetOpen}
        danger
        title="Erase all LockIn data?"
        confirmLabel="Erase everything"
        message="Assignments, exams, your study plan, all history, settings and your parent PIN will be deleted from this device. This cannot be undone."
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          dispatch({ type: 'RESET' });
          setResetOpen(false);
          window.location.href = '/';
        }}
      />
    </Card>
  );
}
