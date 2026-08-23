/**
 * Canvas actions for the UI.
 *
 * Wraps the provider so components never talk to the bridge directly, and so
 * every result is folded back through the reducer (which is what keeps Focus
 * Mode honest).
 */
import { useCallback, useState } from 'react';
import { useApp } from '../store/context';
import { canvasProvider } from '../lib/canvas/pageProvider';
import { applyCanvasView, describeSync } from '../lib/canvas/reconcile';
import { toast } from '../components/ui/Toast';
import type { Assignment } from '../types';

export function useCanvas() {
  const { state, dispatch } = useApp();
  const [busy, setBusy] = useState<null | 'sync' | 'connect' | 'disconnect' | 'check'>(null);

  const connection = state.canvas.connection;

  /** Store the domain, then open the extension's consent page. */
  const connect = useCallback(
    async (domain: string) => {
      setBusy('connect');
      try {
        const view = await canvasProvider.requestPermission(domain);
        if (!view) {
          /*
            The Companion is the only thing that can talk to Canvas, and it
            only answers on the one web address it was built for. Saying just
            "install it first" sent students who *had* installed it looking for
            a problem in Chrome instead of in which copy they installed.
          */
          const host = typeof window === 'undefined' ? 'this site' : window.location.host;
          toast(
            `The LockIn Companion is not answering on ${host}. Install it — or, if it is already installed, check that the copy was built for this address.`,
            'error',
          );
          return false;
        }
        // Record the intent now; the granted flag is corrected when the
        // consent page reports back and the extension pushes a new view.
        dispatch({ type: 'CANVAS_CONNECT', domain, permissionGranted: view.permissionGranted });
        applyCanvasView(dispatch, view);
        toast('Approve Canvas access in the tab that just opened.', 'info');
        return true;
      } finally {
        setBusy(null);
      }
    },
    [dispatch],
  );

  const refresh = useCallback(async () => {
    const view = await canvasProvider.getView();
    applyCanvasView(dispatch, view);
    return view;
  }, [dispatch]);

  const sync = useCallback(async () => {
    setBusy('sync');
    try {
      const view = await canvasProvider.sync();
      applyCanvasView(dispatch, view, { markSynced: true });
      const summary = describeSync(view);
      toast(summary.message, summary.ok ? 'success' : 'error');
      return view;
    } finally {
      setBusy(null);
    }
  }, [dispatch]);

  const disconnect = useCallback(
    async (keepAssignments: boolean) => {
      setBusy('disconnect');
      try {
        const view = await canvasProvider.disconnect();
        dispatch({ type: 'CANVAS_DISCONNECT', keepAssignments });
        toast(
          view?.disconnect?.permissionRemoved
            ? 'Canvas disconnected and site access removed.'
            : 'Canvas disconnected.',
          'info',
        );
      } finally {
        setBusy(null);
      }
    },
    [dispatch],
  );

  const openInCanvas = useCallback(async (url: string) => {
    const ok = await canvasProvider.openInCanvas(url);
    if (!ok) toast('Could not open Canvas. Is the extension connected?', 'error');
    return ok;
  }, []);

  /**
   * "Check Canvas Status" on a single assignment.
   * If a Canvas tab is open, a sync re-parses it. Otherwise the assignment's
   * saved Canvas URL is opened, and the content script reports back on load.
   */
  const checkStatus = useCallback(
    async (assignment: Assignment) => {
      if (!assignment.canvas) return;
      setBusy('check');
      try {
        const view = await canvasProvider.sync();
        if (view?.sync?.ok) {
          applyCanvasView(dispatch, view, { markSynced: true });
          toast('Canvas checked.', 'success');
          return;
        }
        await canvasProvider.openInCanvas(assignment.canvas.url);
        toast('Once Canvas loads, LockIn will check the status automatically.', 'info');
      } finally {
        setBusy(null);
      }
    },
    [dispatch],
  );

  return {
    connection,
    busy,
    connect,
    refresh,
    sync,
    disconnect,
    openInCanvas,
    checkStatus,
  };
}
