/**
 * Turning an extension Canvas view into store actions.
 *
 * This is what makes a submission survive the LockIn tab being closed: the
 * extension keeps its own detection cache, and whenever the app reconnects it
 * replays that cache through the ordinary `CANVAS_DETECTED` path. Because that
 * action is idempotent, replaying costs nothing when nothing changed.
 */
import type { Dispatch } from 'react';
import type { Action } from '../../store/reducer';
import type { CanvasExtensionView } from './pageProvider';
import { sanitizeDetected } from './pageProvider';
import type { CanvasDetectedAssignment } from '../../types/canvas';

export function detectedFromView(view: CanvasExtensionView): CanvasDetectedAssignment[] {
  return view.detected
    .map(sanitizeDetected)
    .filter((d): d is CanvasDetectedAssignment => d !== null);
}

/**
 * Applies a view to the store: connection health first, then detections.
 * Safe to call repeatedly — that is the whole point.
 */
export function applyCanvasView(
  dispatch: Dispatch<Action>,
  view: CanvasExtensionView | null,
  options: { markSynced?: boolean } = {},
): { detectedCount: number } {
  if (!view) {
    dispatch({
      type: 'CANVAS_SET_CONNECTION',
      lastError: 'The LockIn extension did not respond.',
    });
    return { detectedCount: 0 };
  }

  dispatch({
    type: 'CANVAS_SET_CONNECTION',
    permissionGranted: view.permissionGranted,
    lastSeenAt: view.lastSeenAt,
    lastError: null,
    ...(options.markSynced ? { lastSyncAt: new Date().toISOString() } : {}),
  });

  const detected = detectedFromView(view);
  if (detected.length > 0) {
    dispatch({
      type: 'CANVAS_DETECTED',
      detected,
      // The extension's own timestamp is authoritative for "last seen".
      seenAt: view.lastSeenAt || new Date().toISOString(),
    });
  }
  return { detectedCount: detected.length };
}

/** Human-readable summary of a sync, for the toast. */
export function describeSync(view: CanvasExtensionView | null): {
  ok: boolean;
  message: string;
} {
  if (!view) {
    return { ok: false, message: 'The LockIn extension is not connected.' };
  }
  const sync = view.sync;
  if (!sync || !sync.ok) {
    switch (sync?.reason) {
      case 'no-canvas-tab':
        return { ok: false, message: 'Open Canvas in Chrome, then try Sync again.' };
      case 'no-permission':
        return {
          ok: false,
          message: 'Canvas permission not granted. You can enable it from Settings.',
        };
      case 'not-configured':
        return { ok: false, message: 'Set up Canvas first.' };
      default:
        return { ok: false, message: 'Could not reach Canvas.' };
    }
  }

  const parts = [`${sync.found ?? 0} assignment${sync.found === 1 ? '' : 's'} found`];
  if (sync.updated) parts.push(`${sync.updated} updated`);
  if (sync.newlySubmitted) {
    parts.push(`${sync.newlySubmitted} newly submitted`);
  }
  return { ok: true, message: parts.join(' · ') };
}
