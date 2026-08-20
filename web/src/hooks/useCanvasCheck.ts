/**
 * Check Canvas — the one button, and the only way LockIn touches Canvas.
 *
 * ## What one press does
 *
 * 1. Asks the gate. Refused → nothing happens, the reason is shown, and the
 *    refusal is written to the activity log.
 * 2. Folds in the calendar feed (titles and due dates).
 * 3. Asks the extension to re-read **the Canvas page in the active tab** —
 *    which is where submitted / graded / missing and the scores come from.
 *
 * ## Why it is shaped like this
 *
 * The student takes proctored tests at school while this app runs at home, and
 * the design rule that follows is: LockIn makes no request to Canvas of its
 * own, and reads nothing the student did not deliberately open. So there is no
 * poller, no background tab, no API call — there is a button, and the page in
 * front of them.
 *
 * The two halves are here together because they are one question in the
 * student's head ("is my list right?"), and splitting them into two buttons
 * would mean one of them is always the stale one.
 */
import { useCallback, useState } from 'react';
import { useApp } from '../store/context';
import { canvasProvider } from '../lib/canvas/pageProvider';
import { applyCanvasView, describeSync } from '../lib/canvas/reconcile';
import { runFeedSync } from './useCanvasAutoSync';
import { toast } from '../components/ui/Toast';
import {
  evaluateCheckWindow,
  gateExplanation,
  type GateDecision,
} from '../lib/canvas/checkWindow';

export interface CanvasCheckResult {
  ok: boolean;
  /** Set when the gate refused, so the caller can offer the override. */
  refusal?: GateDecision;
}

export function useCanvasCheck() {
  const { state, dispatch, extension } = useApp();
  const [busy, setBusy] = useState(false);
  const [lastRefusal, setLastRefusal] = useState<GateDecision | null>(null);

  const window = state.settings.canvasCheckWindow;

  const check = useCallback(
    async (options: { override?: boolean } = {}): Promise<CanvasCheckResult> => {
      const now = Date.now();
      const decision = evaluateCheckWindow(
        window,
        options.override ? 'override' : 'manual',
        now,
      );

      if (!decision.allowed) {
        setLastRefusal(decision);
        dispatch({
          type: 'LOG',
          eventType: 'canvas_check_refused',
          message: gateExplanation(decision, window),
          meta: { verdict: decision.verdict },
        });
        toast(gateExplanation(decision, window), 'info');
        return { ok: false, refusal: decision };
      }

      setLastRefusal(null);
      setBusy(true);
      try {
        if (options.override) {
          // The override is the interesting event, not the check: it is the
          // student saying the window is wrong for today, and the log is what
          // makes the whole guarantee checkable rather than merely claimed.
          dispatch({
            type: 'LOG',
            eventType: 'canvas_check_override',
            message: 'Checked Canvas outside the usual check window',
          });
        }

        // Due dates first — this half works with no extension at all.
        await runFeedSync(state, dispatch);

        // Then the page in front of them, which is the half that knows what is
        // graded. With no extension there is nothing to ask, and saying so is
        // more useful than a silent no-op.
        if (extension.status !== 'connected') {
          toast(
            'Due dates updated. Install the LockIn extension to read what is graded.',
            'info',
          );
          return { ok: true };
        }

        const view = await canvasProvider.sync(options.override === true);
        applyCanvasView(dispatch, view, { markSynced: true });
        const summary = describeSync(view);
        toast(summary.message, summary.ok ? 'success' : 'info');
        return { ok: summary.ok };
      } finally {
        setBusy(false);
      }
    },
    [dispatch, extension.status, state, window],
  );

  return {
    check,
    busy,
    /** The last refusal, so the UI can offer "check anyway" beside the reason. */
    lastRefusal,
    /** What the gate would say right now, without doing anything. */
    preview: evaluateCheckWindow(window, 'manual', Date.now()),
    explain: (decision: GateDecision) => gateExplanation(decision, window),
  };
}
