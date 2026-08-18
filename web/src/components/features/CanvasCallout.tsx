/**
 * Canvas, offered where the student already is (Phase 10).
 *
 * Until now there was exactly one door: Settings → Canvas. The connect flow
 * lived there, and — worse — the list of assignments Canvas had *found* was
 * reachable only from inside that same panel. So a student would connect
 * Canvas, browse their courses, come back, and see an app that looked
 * identical. The work was in `state.canvas.detected` and nothing said so.
 *
 * The progressive-disclosure literature has a name for that failure:
 * **over-hiding** — "primary actions are buried so deep that users cannot find
 * them". The prescription is not "put it in Settings", it is *contextual*
 * disclosure: surface the option when something makes it relevant.
 *
 * This component is that surface, and it has exactly three states:
 *
 *  1. **Nothing connected, and no work yet** — an empty assignments list is the
 *     single best place in the app to offer Canvas. "The first empty screen
 *     should be treated as onboarding": headline, one line, and a real button.
 *  2. **Connected, with work waiting to be imported** — say so, with a count,
 *     wherever the student is. This is the fix for "do all that and then find
 *     it": the app tells you rather than waiting to be asked.
 *  3. **Nothing to say** — render nothing at all. A callout that is always
 *     there is furniture, and furniture gets ignored.
 *
 * Deliberately *not* added to first-run onboarding. Setup should be triggered
 * by behaviour rather than by a step counter, and a student who has not yet
 * seen an assignment list has no reason to care about Canvas.
 *
 * See `docs/research/2026-08-canvas-discoverability.md`.
 */
import { useState } from 'react';
import { useApp } from '../../store/context';
import { useCanvas } from '../../hooks/useCanvas';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { CanvasImportModal } from './CanvasImportModal';
import { CanvasSetupModal } from './CanvasSettings';
import { importCandidates } from '../../lib/selectors';

export function CanvasCallout({ variant = 'banner' }: { variant?: 'banner' | 'empty' }) {
  const { state, extension } = useApp();
  const { connection, busy, connect } = useCanvas();
  const [setupOpen, setSetupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const candidates = importCandidates(state);
  const connected = !!connection;

  // State 3: nothing worth saying.
  if (dismissed) return null;
  if (connected && candidates.length === 0) return null;
  if (!connected && variant === 'banner') return null;

  /* ---------------- State 2: work is waiting ---------------- */
  if (connected) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-500/40 bg-brand-500/10 p-3.5">
          <Icon name="canvas" size={18} aria-hidden className="shrink-0 text-brand-600 dark:text-brand-300" />
          <p className="min-w-0 flex-1 text-sm lk-strong">
            <strong>{candidates.length}</strong>{' '}
            {candidates.length === 1 ? 'assignment' : 'assignments'} found on Canvas
            <span className="ml-1 font-normal lk-muted">— nothing is added until you choose.</span>
          </p>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            Review
          </Button>
          <button
            type="button"
            aria-label="Hide this for now"
            onClick={() => setDismissed(true)}
            className="rounded-lg p-1 lk-muted hover:lk-strong"
          >
            <Icon name="close" size={15} aria-hidden />
          </button>
        </div>
        <CanvasImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      </>
    );
  }

  /* ---------------- State 1: the empty list offers Canvas ---------------- */
  return (
    <>
      <div className="rounded-2xl border border-dashed lk-border p-5 text-center">
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white">
          <Icon name="canvas" size={20} aria-hidden />
        </span>
        <p className="text-sm font-bold lk-strong">Pull your work from Canvas</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed lk-muted">
          LockIn can read assignments and submission status from Canvas pages you open. It never
          needs your Canvas password, and it only ever sees pages you visit yourself.
        </p>
        <Button className="mt-4" icon={<Icon name="canvas" size={16} aria-hidden />} onClick={() => setSetupOpen(true)}>
          Connect Canvas
        </Button>
      </div>

      <CanvasSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onConnect={async (domain) => {
          const ok = await connect(domain);
          if (!ok) return;
          setSetupOpen(false);
          // Land on the payoff, not back where you started. Whether anything
          // has been detected yet or not, the import list is the screen that
          // answers "so what happens now?".
          setImportOpen(true);
        }}
        connecting={busy === 'connect'}
        extensionConnected={extension.status === 'connected'}
      />
      <CanvasImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
