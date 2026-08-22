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
      case 'page-unreadable':
        return {
          ok: false,
          message:
            'Canvas answered, but LockIn could not reliably read this layout. Existing saved results were not counted as a fresh check.',
        };
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

  /**
   * Read something, but not a gradebook.
   *
   * This used to report a cheerful success whenever *any* Canvas page
   * answered — so a dashboard tab could satisfy the check while the student's
   * actual question ("is my finished work marked as finished?") went
   * unanswered, and every assignment stayed "not done". A check that did not
   * read a page carrying scores has not done the job, however many
   * assignments it saw, and it has to say so.
   */
  if (!sync.readGrades) {
    return {
      ok: false,
      message:
        sync.gradebookAnswered
          ? 'The Canvas gradebook answered, but its assignment rows could not be read reliably. LockIn did not guess.'
          : 'Read your Canvas dashboard, which carries no scores. Open a class → Grades, then press Check Canvas again.',
    };
  }

  /**
   * The all-courses page gives class totals and nothing else.
   *
   * Worth saying out loud, because the guidance here was wrong for days: `/grades`
   * lists one row per class, so it can never say whether a particular
   * assignment was handed in, marked or missed. That lives on a *class's* own
   * Grades page, `/courses/<id>/grades`. Reporting "done" after reading the
   * summary page is how a student ends up staring at finished work still
   * listed as not done.
   */
  if (sync.pageKind === 'grades_all' && (sync.updated ?? 0) === 0) {
    return {
      ok: true,
      message:
        'Class grades updated. For which assignments are done, late or missing, open one class → Grades and press again.',
    };
  }

  const currentRows = sync.rowsRead ?? 0;
  const parts = [
    `${currentRows} assignment row${currentRows === 1 ? '' : 's'} read from this page`,
  ];
  if (sync.updated) parts.push(`${sync.updated} updated`);
  if (sync.newlySubmitted) {
    parts.push(`${sync.newlySubmitted} newly submitted`);
  }
  return { ok: true, message: parts.join(' · ') };
}
