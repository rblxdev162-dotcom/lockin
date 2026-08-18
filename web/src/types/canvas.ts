/**
 * Canvas Browser Connection types.
 *
 * This is *browser detection*: LockIn reads Canvas pages the student already
 * opened. It is not the official Canvas API and must never be labelled as such.
 * See `web/src/lib/canvas/provider.ts` for the abstraction that lets an
 * official-API provider replace this later.
 *
 * Identifiers deliberately reuse the fields `Assignment` already reserved in
 * Phase 1 (`externalCourseId`, `externalAssignmentId`) rather than inventing
 * parallel ones.
 */

/**
 * Normalised submission state.
 *
 * `unknown`                 — nothing has been read yet.
 * `verification_unavailable`— the page was read but gave no trustworthy signal
 *                             (ambiguous quiz, external tool, changed markup).
 * A false negative is fine. A false positive is not.
 */
export const CANVAS_SUBMISSION_STATUSES = [
  'unknown',
  'not_submitted',
  'submitted',
  'graded',
  'missing',
  'late_submitted',
  'verification_unavailable',
] as const;
export type CanvasSubmissionStatus = (typeof CANVAS_SUBMISSION_STATUSES)[number];

/** The only statuses that may complete an assignment. */
export const CANVAS_COMPLETE_STATUSES: readonly CanvasSubmissionStatus[] = [
  'submitted',
  'graded',
  'late_submitted',
];

export interface CanvasConnection {
  /** Bare host, e.g. `myschool.instructure.com`. */
  domain: string;
  /** Only `browser` exists today; `api` is reserved for a future provider. */
  mode: 'browser' | 'api';
  connectedAt: string;
  /** Last time any Canvas page was successfully parsed. */
  lastSeenAt: string | null;
  /** Whether Chrome granted the optional host permission for this origin. */
  permissionGranted: boolean;
}

export interface CanvasCourse {
  externalCourseId: string;
  /** Exactly what Canvas calls it, e.g. `MATH-7-P3-26-27-SMITH`. */
  originalName: string;
  /** What the student wants to see, e.g. `Math`. Defaults to originalName. */
  displayName: string;
  url?: string;
}

/** A Canvas assignment seen on a page — not yet necessarily imported. */
export interface CanvasDetectedAssignment {
  externalAssignmentId: string;
  externalCourseId: string;
  title: string;
  /** ISO timestamp when Canvas showed a due date; absent when undated. */
  dueAt?: string;
  url: string;
  pointsPossible?: number;
  submissionStatus: CanvasSubmissionStatus;
  detectedAt: string;
  /** Canvas course name at detection time, used to name the subject on import. */
  courseName?: string;
  /** `quiz` / `assignment` / `external_tool` / `discussion` when knowable. */
  kind?: string;
}

/** Per-assignment Canvas link stored on an Assignment. */
export interface CanvasLink {
  /** Which Canvas host this came from — part of the identity. */
  domain: string;
  url: string;
  submissionStatus: CanvasSubmissionStatus;
  /** Last time LockIn read a Canvas page for this assignment. */
  lastCheckedAt: string | null;
  /** Last time the status actually changed (drives "Verified 2 min ago"). */
  lastStatusChangeAt: string | null;
  courseName?: string;
  kind?: string;
}

export interface CanvasState {
  connection: CanvasConnection | null;
  courses: CanvasCourse[];
  /** Detection cache of things seen but not yet imported or ignored. */
  detected: CanvasDetectedAssignment[];
  /** External keys the student chose to ignore, so they stop being offered. */
  ignoredKeys: string[];
  lastSyncAt: string | null;
  /** Human-readable reason the last sync failed, or null. */
  lastError: string | null;
}

export function defaultCanvasState(): CanvasState {
  return {
    connection: null,
    courses: [],
    detected: [],
    ignoredKeys: [],
    lastSyncAt: null,
    lastError: null,
  };
}

/**
 * The identity of a Canvas assignment: host + course + assignment.
 * Titles are never part of identity — they change and collide.
 */
export function canvasKey(
  domain: string,
  externalCourseId: string,
  externalAssignmentId: string,
): string {
  return `${domain}|${externalCourseId}|${externalAssignmentId}`;
}

/** Connection status as reported by a CanvasProvider. */
export interface CanvasConnectionStatus {
  configured: boolean;
  permissionGranted: boolean;
  domain: string | null;
  /** True when the extension is reachable at all. */
  extensionConnected: boolean;
  lastSeenAt: string | null;
  detectedCount: number;
  /** Set when the provider cannot work (e.g. the API provider is a stub). */
  unavailableReason?: string;
}

/** Result of asking a provider for one assignment's status. */
export interface CanvasAssignmentStatus {
  externalCourseId: string;
  externalAssignmentId: string;
  submissionStatus: CanvasSubmissionStatus;
  checkedAt: string;
  /** True when the provider could not read the page at all. */
  unavailable?: boolean;
}
