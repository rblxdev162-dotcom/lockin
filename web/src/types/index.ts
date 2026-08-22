/**
 * LockIn core data models.
 *
 * These types are the contract between the store, the persistence layer and the
 * Chrome extension bridge. When you add a field, bump SCHEMA_VERSION in
 * lib/storage.ts and add a migration step.
 */

import type { CanvasLink, CanvasState } from './canvas';
import type { CanvasCheckWindow } from '../lib/canvas/checkWindow';
import type { GradesState } from './grades';
import type { FocusRun, ParentControls } from './parent';
import type { PlannerState } from './planner';
import type { IntegrationsState } from './integrations';
import type { SourceRecord } from './source';
import type { SchoolSchedule } from '../lib/schoolSchedule';

export * from './canvas';
export * from './parent';
export * from './planner';
export * from './source';
export * from './integrations';

/* ------------------------------------------------------------------ */
/* Assignments                                                         */
/* ------------------------------------------------------------------ */

export const PLATFORMS = ['Canvas', 'Other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const STATUSES = ['Not Started', 'In Progress', 'Completed'] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ['Normal', 'Important', 'Urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * How an assignment is allowed to be marked complete.
 * `manual`, `timer` and `canvas` are implemented; `future` exists so completion
 * is never hard-coded to "user ticked a checkbox" — verification back-ends can
 * be added without reshaping the model.
 */
export const COMPLETION_METHODS = [
  'manual',
  'timer',
  'canvas',
  'future',
] as const;
export type CompletionMethod = (typeof COMPLETION_METHODS)[number];

export const VERIFICATION_STATUSES = [
  'not_required',
  'pending',
  'verified',
  'failed',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Evidence that an assignment was really finished. `manual`, `timer` and
 * `canvas_submission` records are written today.
 *
 * Never store page HTML, cookies, photos or raw OCR text in here — only the
 * small, structured facts below.
 */
export interface VerificationRecord {
  id: string;
  /** e.g. "manual", "timer", "canvas_submission". */
  type: string;
  timestamp: string;
  status: VerificationStatus;

  /* --- Canvas evidence (Phase 3) --- */
  /** Canvas host the evidence came from, e.g. `myschool.instructure.com`. */
  sourceDomain?: string;
  externalCourseId?: string;
  externalAssignmentId?: string;
  /** Small structured evidence, e.g. `{ canvasStatus: 'submitted' }`. */
  evidence?: Record<string, string | number | boolean>;

  note?: string;
}

export interface ReminderSettings {
  /** Minutes before dueDate/dueTime for the first nudge. */
  firstReminderMinutes: number;
  /** Minutes before due for the escalated nudge. */
  escalationMinutes: number;
  /** Minutes before due for the "Focus Mode is about to matter" warning. */
  focusWarningMinutes: number;
  enabled: boolean;
}

export interface Assignment {
  id: string;
  title: string;
  subject: string;
  platform: Platform;
  /** ISO date, `YYYY-MM-DD`. */
  dueDate: string;
  /** 24h `HH:MM`. */
  dueTime: string;
  estimatedMinutes: number;
  priority: Priority;
  status: Status;
  completionMethod: CompletionMethod;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;

  /** Minutes actually logged against this assignment by focus sessions. */
  loggedMinutes: number;

  reminders: ReminderSettings;
  /** Timestamps of reminders already fired, so they fire once per stage. */
  remindersFired: string[];

  /**
   * External verification back-end. `canvas` is the only live one.
   * The two id fields below are the external identity — Canvas fills them in.
   */
  verificationMethod?: CompletionMethod;
  externalAssignmentId?: string;
  externalCourseId?: string;
  verificationStatus: VerificationStatus;
  verificationRecords: VerificationRecord[];

  /**
   * Where this assignment came from, and how fresh that is (Phase 16).
   *
   * Absent on assignments created before schema v9; `MANUAL` from then on for
   * anything typed. Freshness is never stored here — `lib/sources/freshness.ts`
   * derives it from `lastSyncedAt` and the current time, so a record cannot go
   * on claiming to be live after its connection stopped answering.
   */
  source?: SourceRecord;

  /** Present only when this assignment is linked to a Canvas assignment. */
  canvas?: CanvasLink;

  /** Small, student-authored milestones for work that is bigger than one sitting. */
  steps: { id: string; text: string; done: boolean }[];

}

/* ------------------------------------------------------------------ */
/* Exams                                                               */
/* ------------------------------------------------------------------ */

export const MATERIAL_AMOUNTS = ['Light', 'Medium', 'Heavy'] as const;
export type MaterialAmount = (typeof MATERIAL_AMOUNTS)[number];

export const CONFIDENCE_LEVELS = ['Low', 'Medium', 'High'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export interface Exam {
  id: string;
  name: string;
  subject: string;
  /** ISO date, `YYYY-MM-DD`. */
  examDate: string;
  materialAmount: MaterialAmount;
  createdAt: string;
  updatedAt: string;

  /* --- Smart Study Planner (Phase 7, schema v6) --- */
  /**
   * Minutes of study the planner should spread across the days before the
   * exam. Seeded from `materialAmount` and editable — the defaults are
   * reasonable starting points, not measurements.
   */
  studyEstimateMinutes?: number;
  /** Minutes actually studied for this exam, logged by focus sessions. */
  loggedMinutes: number;
  /** Optional self-report; nudges the estimate up when confidence is Low. */
  confidenceLevel?: ConfidenceLevel;
}

/* ------------------------------------------------------------------ */
/* Focus sessions (the timer)                                          */
/* ------------------------------------------------------------------ */

export const SESSION_STATES = ['idle', 'running', 'paused', 'ended'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/**
 * A running timer is stored as timestamps + accumulated milliseconds rather
 * than a tick counter, so a refresh (or a laptop lid closing) recovers exactly.
 */
export interface FocusSession {
  id: string;
  assignmentId: string | null;
  /**
   * Set when the session is exam revision rather than an assignment (Phase 7).
   * Exactly one of `assignmentId` / `examId` is ever set.
   */
  examId?: string | null;
  /** The planned item this session was started from, when it was. */
  plannedItemId?: string;
  plannedMinutes: number;
  state: SessionState;
  startedAt: string;
  /** When the current run segment began; null while paused. */
  runningSince: string | null;
  /** Milliseconds accumulated across finished run segments. */
  accumulatedMs: number;
  endedAt?: string;
}

export interface CompletedSession {
  id: string;
  assignmentId: string | null;
  /** Exam revision session (Phase 7). */
  examId?: string | null;
  assignmentTitle: string | null;
  plannedMinutes: number;
  actualMinutes: number;
  startedAt: string;
  endedAt: string;
}

/* ------------------------------------------------------------------ */
/* Focus Mode (the blocking contract)                                  */
/* ------------------------------------------------------------------ */

export interface FocusMode {
  active: boolean;
  startedAt: string | null;
  /** Assignments that must be completed before distractions unlock. */
  requiredTaskIds: string[];
  requiredCompletionCount: number;
  completedCount: number;
  /** Epoch ms; while in the future, blocking pauses but Focus Mode stays on. */
  temporaryUnlockUntil: number | null;
  overrideUsed: boolean;
  emergencyExitUsed: boolean;
  /** True when started by the Settings "5-minute blocking test". */
  isTest: boolean;
  /** Epoch ms; test mode self-expires. */
  testExpiresAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Settings / profile                                                  */
/* ------------------------------------------------------------------ */

export const REMINDER_MODES = ['Normal', 'Focused', 'Strict'] as const;
export type ReminderMode = (typeof REMINDER_MODES)[number];

export interface Profile {
  firstName: string;
  onboarded: boolean;
  createdAt: string;
}

export interface ParentPin {
  /** Hex SHA-256 of `salt + pin`. The raw PIN is never stored. */
  hash: string;
  salt: string;
  createdAt: string;
}

export interface Settings {
  reminderMode: ReminderMode;
  /** 24h `HH:MM`. */
  defaultStudyTime: string;
  defaultFocusMinutes: number;
  blockingEnabled: boolean;
  blockedDomains: string[];
  allowedDomains: string[];
  notificationsAsked: boolean;
  theme: 'light' | 'dark' | 'system';
  /**
   * True once the Chrome extension has answered on this device (Phase 8).
   *
   * It is the difference between two very different sentences: "Browser
   * Protection isn't installed" and "Browser Protection has stopped
   * responding". The second one matters most during a Focus Mode that the
   * student believes is blocking things, so it has to survive a restart —
   * which is why this is stored rather than kept in React state.
   */
  extensionSeen: boolean;
  /**
   * Focus Guard: notice and record when the student leaves the LockIn tab
   * during Focus Mode (Phase 9).
   *
   * On by default, and announced during onboarding rather than slipped in.
   * It needs no permission, collects nothing about other sites, and cannot
   * block anything — it is the honest half of what a website can do, and the
   * commitment-device evidence is that the low-friction option is the one
   * people actually keep using. See `lib/focusGuard.ts`.
   */
  focusGuard: boolean;
  /**
   * Whether the student has been asked about website blocking yet (Phase 9).
   *
   * Distinct from `extensionSeen`: this records that the *question* was put,
   * so LockIn asks once and then stops nagging. "Not now" is a real answer and
   * has to be remembered as one.
   */
  blockingAsked: boolean;
  /**
   * Suspend website blocking while school is in session (schema v15).
   *
   * On by default. Blocking exists to protect homework time, and school time
   * is not homework time: during the school day the sites a student needs are
   * chosen by a teacher, not by this app, and a block page in the middle of a
   * lesson is LockIn getting in the way of the exact thing it claims to
   * protect. The school day comes from the schedule the student filled in
   * during onboarding — see `schoolHoursFrom()`.
   *
   * This only suspends *blocking*. Focus Mode, its timer, Focus Guard and
   * reminders are untouched: a student who deliberately starts a session in a
   * free period still gets one, it simply does not redirect anything.
   */
  pauseBlockingDuringSchool: boolean;
  /**
   * Block distractions automatically through homework hours, with no Focus
   * session started (schema v16).
   *
   * Until this existed, blocking only ever ran inside a timer the student
   * chose to start, which meant the student most in need of it — the one who
   * never presses Start — was never blocked at all. Paired with the school
   * pause above, the rule a student can actually hold in their head is:
   * **LockIn blocks after school, and only after school.**
   *
   * Blocking still needs `blockingEnabled`, a non-empty blocklist, and the
   * extension. This decides *when*, not *whether*.
   */
  autoBlockAfterSchool: boolean;
  /**
   * When LockIn is allowed to touch Canvas at all (schema v11).
   *
   * The student takes proctored tests at school on a district device while
   * this app runs at home, and nobody should have to explain why their home
   * computer was talking to the school's Canvas mid-assessment. So the answer
   * is not "be careful": one gate decides, every Canvas path asks it first,
   * and it ships in `manual` mode where nothing at all happens unless the
   * student presses the button. See `lib/canvas/checkWindow.ts`.
   */
  canvasCheckWindow: CanvasCheckWindow;
  /** The student's own timetable. Local planning data; never sent to Canvas. */
  schoolSchedule: SchoolSchedule;
}

/* ------------------------------------------------------------------ */
/* Activity log                                                        */
/* ------------------------------------------------------------------ */

export const ACTIVITY_TYPES = [
  'focus_mode_started',
  'focus_mode_completed',
  'focus_mode_ended',
  'parent_override',
  'emergency_exit',
  'temporary_unlock_started',
  'temporary_unlock_ended',
  'assignment_completed',
  'assignment_created',
  'assignment_deleted',
  'class_renamed',
  'focus_session_completed',
  'blocking_test_started',
  'allowlist_changed',
  'pin_changed',
  /* --- Canvas (Phase 3) --- */
  'canvas_connected',
  'canvas_disconnected',
  'canvas_assignment_imported',
  'canvas_assignment_linked',
  'canvas_submission_verified',
  'canvas_assignment_missing',
  /* --- Parent accountability (Phase 6) --- */
  'parent_controls_changed',
  'parent_requirement_changed',
  /* --- Smart Study Planner (Phase 7) --- */
  'plan_generated',
  'plan_settings_changed',
  'plan_item_skipped',
  'plan_item_moved',
  /* --- Integrations (Phase 16) --- */
  'integration_connected',
  'integration_disconnected',
  'integration_synced',
  'integration_error',
  'feed_assignments_imported',
  'feed_assignment_updated',
  'feed_assignment_cancelled',
  'course_progress_updated',
  /* --- Canvas grades and the check gate (Phase 18) --- */
  'canvas_grades_read',
  'canvas_check_refused',
  'canvas_check_override',
  /* --- Hand-in work and later grading (Phase 35) --- */
  'canvas_grade_confirmed',
  'canvas_completion_contested',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  timestamp: string;
  message: string;
  /** Small structured payload; never raw browsing history. */
  meta?: Record<string, string | number | boolean>;
}

/** Aggregate block counts only — we deliberately never store visited URLs. */
export interface BlockStat {
  domain: string;
  count: number;
  lastBlockedAt: string;
}

/* ------------------------------------------------------------------ */
/* Root persisted state                                                */
/* ------------------------------------------------------------------ */

export interface AppState {
  schemaVersion: number;
  profile: Profile | null;
  assignments: Assignment[];
  exams: Exam[];
  settings: Settings;
  focusMode: FocusMode;
  activeSession: FocusSession | null;
  completedSessions: CompletedSession[];
  activity: ActivityEvent[];
  parentPin: ParentPin | null;
  blockStats: BlockStat[];
  /** Canvas Browser Connection state (schema v2). */
  canvas: CanvasState;
  /** Parent accountability switches (schema v5). */
  parentControls: ParentControls;
  /** One record per Focus Mode run, for the Parent Dashboard (schema v5). */
  focusRuns: FocusRun[];
  /** Smart Study Planner: settings, the current plan, history (schema v6). */
  planner: PlannerState;
  /** Connections to school systems, and the courses they describe (schema v9). */
  integrations: IntegrationsState;
  /** Class grades read off the Canvas Grades page (schema v11). */
  grades: GradesState;
}
