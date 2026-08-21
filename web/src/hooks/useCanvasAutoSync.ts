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
 *
 * ## Phase 18: this only runs if the student switched it on
 *
 * Refreshing the feed is a request to the school's server, so it goes through
 * the same gate as everything else Canvas-shaped. The shipped default is
 * `manual`, in which this hook does nothing at all and the Check Canvas button
 * runs `runFeedSync` directly. See `lib/canvas/checkWindow.ts`.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useApp } from '../store/context';
import { syncFeed } from '../lib/canvas/feedTransport';
import { describeDiff, diffIsInteresting, reconcileFeed } from '../lib/canvas/calendarReconcile';
import { toast } from '../components/ui/Toast';
import { evaluateCheckWindow } from '../lib/canvas/checkWindow';
import type { AppState } from '../types';
import type { Action } from '../store/reducer';
import type { Dispatch } from 'react';

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

    /**
     * The gate, before anything else.
     *
     * Refreshing the calendar feed is a request to the school's server like
     * any other, so it obeys the same rule as reading a page: nothing on a
     * timer unless the student switched automatic checks on, and nothing at
     * all during their configured school hours. In the default `manual` mode
     * this returns immediately, every time, and the feed is refreshed by the
     * Check Canvas button instead.
     */
    const gate = evaluateCheckWindow(current.settings.canvasCheckWindow, 'automatic', Date.now());
    if (!gate.allowed) return;

    await runFeedSync(current, send);
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

  useEffect(() => {
    const current = state.settings.canvasCheckWindow;
    const decision = evaluateCheckWindow(current, 'automatic', Date.now());
    if (decision.allowed || decision.nextAllowedAt === null) return;

    // Wake at the exact first allowed minute instead of waiting for the next
    // half-hour interval. This is what makes a teacher's moved deadline arrive
    // as soon as LockIn's configured after-school window opens.
    const delay = Math.min(decision.nextAllowedAt - Date.now() + 250, 2_147_000_000);
    const timer = window.setTimeout(() => void runSync(), Math.max(0, delay));
    return () => window.clearTimeout(timer);
  }, [state.settings.canvasCheckWindow, runSync]);
}

/**
 * Fold the cached Canvas calendar feed into assignments.
 *
 * Exported because the Check Canvas button runs exactly this, as the
 * student's own act — it is the same work, differing only in who asked for
 * it, and a second copy would be a second set of reconciliation rules.
 */
export async function runFeedSync(
  current: AppState,
  send: Dispatch<Action>,
  origin: 'manual' | 'automatic' = 'automatic',
): Promise<{ ok: boolean; changed: boolean; created: number; updated: number; cancelled: number }> {
  const connected = current.integrations.records.find((r) => r.id === 'canvas_calendar');
  // Nothing configured, nothing to do. The common case for a new install, and
  // it must cost nothing.
  if (!connected || connected.status === 'not_configured') {
    return { ok: false, changed: false, created: 0, updated: 0, cancelled: 0 };
  }

  const now = Date.now();
  // `force: false` — this reads whatever was cached, so the same page open in
  // two tabs does not become two requests to the school's server.
  const result = await syncFeed(now, current.integrations.canvasCalendar.horizonDays, false);
  if (!result.ok || !result.feed) {
    // A failed background sync is not worth a toast. The Integrations page and
    // the pace engine both surface staleness on their own, and a popup about a
    // network blip nobody asked for is noise.
    if (result.reason !== 'no-transport') {
      send({
        type: 'INTEGRATION_STATUS',
        id: 'canvas_calendar',
        status: 'error',
        error: 'Canvas could not be reached. Your assignments are still here.',
      });
    }
    return { ok: false, changed: false, created: 0, updated: 0, cancelled: 0 };
  }

  const syncedAt = new Date(result.fetchedAt ?? now).toISOString();
  const diff = reconcileFeed(result.feed.items, current.assignments, {
    sourceId: 'canvas-calendar',
    syncedAt,
    live: true,
  });

  send({ type: 'FEED_APPLY', diff, sourceId: 'canvas-calendar', syncedAt, live: true });
  send({
    type: 'INTEGRATION_STATUS',
    id: 'canvas_calendar',
    status: 'connected',
    itemCount: diff.create.length,
  });
  const updated = diff.update.filter((item) => item.changes.length > 0).length;
  send({
    type: 'CANVAS_CHECK_RECORDED',
    report: {
      checkedAt: syncedAt,
      origin,
      ok: true,
      message: describeDiff(diff),
      newAssignments: diff.create.length,
      updatedAssignments: updated,
      cancelledAssignments: diff.cancel.length,
    },
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
  return {
    ok: true,
    changed: diffIsInteresting(diff),
    created: diff.create.length,
    updated,
    cancelled: diff.cancel.length,
  };
}
