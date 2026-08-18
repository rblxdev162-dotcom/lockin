/**
 * The Canvas provider abstraction.
 *
 * Everything above this interface (reducer, UI, verification policy) is written
 * against `CanvasProvider` and knows nothing about *how* Canvas data was
 * obtained. That is what lets an institution-approved API provider replace
 * browser detection later without touching Focus Mode or the UI.
 *
 * Two implementations:
 *   CanvasPageProvider — SHIPPING. Reads Canvas pages the student already
 *                        opened, via the extension. No credentials, no API.
 *   CanvasApiProvider  — STUB ONLY. Reserved for official OAuth2/Developer Key
 *                        access. Deliberately unimplemented; see api.ts.
 */
import type {
  CanvasAssignmentStatus,
  CanvasConnectionStatus,
  CanvasCourse,
  CanvasDetectedAssignment,
} from '../../types/canvas';

export interface CanvasDetectionResult {
  courses: CanvasCourse[];
  assignments: CanvasDetectedAssignment[];
  /** Pages that looked like Canvas but could not be parsed. */
  unreadablePages: number;
  /** Set when the whole attempt failed (no permission, no tab, no extension). */
  error?: string;
}

export interface CanvasProvider {
  /** `browser` today; `api` reserved. Shown in the UI so the label stays honest. */
  readonly kind: 'browser' | 'api';
  /** Human-facing name. Never "Official Canvas Integration" for the page provider. */
  readonly label: string;

  getConnectionStatus(): Promise<CanvasConnectionStatus>;
  detectCourses(): Promise<CanvasCourse[]>;
  detectAssignments(): Promise<CanvasDetectedAssignment[]>;
  getAssignmentStatus(
    courseId: string,
    assignmentId: string,
  ): Promise<CanvasAssignmentStatus>;
}

/** Convenience for providers that cannot answer right now. */
export function unavailableStatus(
  reason: string,
  domain: string | null = null,
): CanvasConnectionStatus {
  return {
    configured: !!domain,
    permissionGranted: false,
    domain,
    extensionConnected: false,
    lastSeenAt: null,
    detectedCount: 0,
    unavailableReason: reason,
  };
}
