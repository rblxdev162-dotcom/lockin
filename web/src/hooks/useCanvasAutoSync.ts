/**
 * Keeping Canvas up to date without anybody pressing anything.
 *
 * ## The split, and why it is this way round
 *
 * Whatever is fetching — LockIn's local service, or the companion extension —
 * does it on its own timer, so the newest ICS is cached whether or not LockIn
 * is open. But neither can turn that text into assignments: neither knows what
 * LockIn already has, and duplicating the reconciler would be a second copy of
 * the rules that decide whether something is new.
 *
 * So this hook does the other half. Whenever the app is open it folds the
 * cached feed in — on load, and every 30 minutes after — and it does it
 * silently when there is nothing to decide.
 *
 * ## When it asks first
 *
 * Never, for the ordinary case. New assignments and moved due dates are applied
 * straight away, because a sync that waits behind a dialog is a sync that does
 * not happen: the whole point is that the student's list is right when they
 * open it. **Cancellations are the exception** — those are shown as a toast
 * with the count, because withdrawn work is the one change a student should
 * notice rather than discover.
 *
 * A manual "Sync now" on the Integrations page still shows the full review
 * screen. That is the difference between a background job and a deliberate act.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useApp } from '../store/context';
import { syncFeed } from '../lib/canvas/feedTransport';
import { describeDiff, diffIsInteresting, reconcileFeed } from '../lib/canvas/calendarReconcile';
import { toast } from '../components/ui/Toast';

/** Matches the extension's alarm. One cadence, defined in two places that agree. */
export const AUTO_SYNC_MS = 30 * 60 * 1000;

/** Long enough after load that it never competes with the first paint. */
const FIRST_RUN_DELAY_MS = 4000;

export function useCanvasAutoSync(): void {
  const { state, dispatch, extension } = useApp();

  // Everything the sync needs, read through a ref so the effect below does not
  // re-run — and re-sync — on every keystroke elsewhere in the app.
  const latest = useRef({ state, dispatch });
  latest.current = { state, dispatch };

  const runSync = useCallback(async () => {
    const { state: current, dispatch: send } = latest.current;
    const connected = current.integrations.records.find((r) => r.id === 'canvas_calendar');
    // Nothing configured, nothing to do. This is the common case for a new
    // install and must cost nothing.
    if (!connected || connected.status === 'not_configured') return;

    const now = Date.now();
    // `force: false` — the extension's cache is what this reads, so a page open
    // in two tabs does not become two requests to the school's server.
    const result = await syncFeed(now, current.integrations.canvasCalendar.horizonDays, false);
    if (!result.ok || !result.feed) {
      // A failed background sync is not worth a toast. The Integrations page
      // and the pace engine both surface staleness on their own, and a popup
      // about a network blip the student did not ask for is noise.
      if (result.reason !== 'no-transport') {
        send({
          type: 'INTEGRATION_STATUS',
          id: 'canvas_calendar',
          status: 'error',
          error: 'Canvas could not be reached. Your assignments are still here.',
        });
      }
      return;
    }

    const diff = reconcileFeed(result.feed.items, current.assignments, {
      sourceId: 'canvas-calendar',
      syncedAt: new Date(result.fetchedAt ?? now).toISOString(),
      live: true,
    });

    send({
      type: 'FEED_APPLY',
      diff,
      sourceId: 'canvas-calendar',
      syncedAt: new Date(result.fetchedAt ?? now).toISOString(),
      live: true,
    });
    send({
      type: 'INTEGRATION_STATUS',
      id: 'canvas_calendar',
      status: 'connected',
      itemCount: diff.create.length,
    });

    // Only speak when something actually changed, and only once.
    if (diffIsInteresting(diff)) {
      toast(
        diff.cancel.length > 0
          ? `Canvas: ${describeDiff(diff)}. Cancelled work is still here with reminders off.`
          : `Canvas: ${describeDiff(diff)}`,
        diff.cancel.length > 0 ? 'info' : 'success',
      );
    }
  }, []);

  useEffect(() => {
    // Runs regardless of the extension: the local service is the usual
    // transport, and `syncFeed` returns `no-transport` harmlessly when neither
    // is present.
    const first = window.setTimeout(() => void runSync(), FIRST_RUN_DELAY_MS);
    const interval = window.setInterval(() => void runSync(), AUTO_SYNC_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
    // `extension.status` is a dependency so a companion appearing mid-session
    // triggers an immediate catch-up sync.
  }, [extension.status, runSync]);
}
