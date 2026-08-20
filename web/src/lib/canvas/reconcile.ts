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
import { sanitizeDetected, sanitizeGrade } from './pageProvider';
import type { CanvasDetectedAssignment } from '../../types/canvas';
import type { CourseGrade } from '../../types/grades';

export function gradesFromView(view: CanvasExtensionView): CourseGrade[] {
  return (view.grades ?? [])
    .map(sanitizeGrade)
    .filter((g): g is CourseGrade => g !== null);
}

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
): { detectedCount: number; gradeCount: number } {
  if (!view) {
    dispatch({
      type: 'CANVAS_SET_CONNECTION',
      lastError: 'The LockIn extension did not respond.',
    });
    return { detectedCount: 0, gradeCount: 0 };
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

  // Grades go their own way: a percentage is not evidence that work is done,
  // and must never reach the completion path (invariant 1).
  const grades = gradesFromView(view);
  if (grades.length > 0) {
    dispatch({
      type: 'CANVAS_GRADES',
      grades,
      readAt: view.lastSeenAt || new Date().toISOString(),
    });
  }

  return { detectedCount: detected.length, gradeCount: grades.length };
}

/**
 * Why the gate said no, in the student's own terms.
 *
 * Deliberately never stronger than what the gate actually enforces: LockIn
 * cannot know whether a test is happening, only what window it was told about.
 */
export function refusalMessage(verdict: string | undefined): string {
  switch (verdict) {
    case 'school_hours':
      return 'Automatic Canvas checks are disabled during your configured school hours.';
    case 'outside_window':
      return 'Canvas checks are set to run only inside your check window.';
    case 'paused':
      return 'Canvas checks are paused.';
    case 'automatic_disabled':
      return 'LockIn reads Canvas only when you press Check Canvas.';
    case 'not_connected':
      return 'Canvas is not connected yet.';
    default:
      return 'LockIn did not read Canvas.';
  }
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
        return {
          ok: false,
          message: 'Open Canvas → Grades in this tab, then press Check Canvas.',
        };
      case 'tab-not-ready':
        return { ok: false, message: 'Reload the Canvas tab, then press Check Canvas again.' };
      case 'gate-refused':
        return { ok: false, message: refusalMessage(sync.verdict) };
      case 'no-permission':
        return {
          ok: false,
          message: 'Canvas permission not granted. You can enable it from Settings.',
        };
      case 'not-configured':
        return { ok: false, message: 'Set up Canvas first.' };
      default:
        return { ok: false, message: 'Could not read Canvas.' };
    }
  }

  // Read a page that carries no scores: say so, rather than reporting a
  // successful check that found nothing and letting them assume the worst.
  if (!sync.readGrades && (sync.found ?? 0) === 0) {
    return {
      ok: false,
      message: 'That Canvas page had nothing to read. Open Grades and press Check Canvas.',
    };
  }

  const parts = [`${sync.found ?? 0} assignment${sync.found === 1 ? '' : 's'} found`];
  if (sync.updated) parts.push(`${sync.updated} updated`);
  if (sync.newlySubmitted) {
    parts.push(`${sync.newlySubmitted} newly submitted`);
  }
  return { ok: true, message: parts.join(' · ') };
}
