/**
 * Connections to the outside world, and the course records they produce.
 *
 * Two ideas live here:
 *
 *  1. **`IntegrationRecord`** — the state of one connection. This is what the
 *     Integrations page renders, and it is deliberately separate from the data
 *     the connection produces: a feed can be erroring while the assignments it
 *     imported last week are still perfectly good, and LockIn has to be able to
 *     say both things at once.
 *
 *  2. **`CourseProgress`** — a course as LockIn understands it, with
 *     **per-field provenance**. A course report knows the activity schedule; a
 *     progress email knows this morning's percentage. Neither is "the source"
 *     for the course, so no single `SourceRecord` on the course would be
 *     honest. Each field carries its own.
 */
import type { SourceRecord } from './source';

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

export const INTEGRATION_IDS = [
  'canvas_calendar',
  'canvas_oauth',
  'edgenuity_email',
  'edgenuity_report',
  'edgenuity_api',
  'companion',
  'school_companion',
] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

/**
 * `not_configured` — never set up. The normal starting state.
 * `connected`      — set up and working.
 * `error`          — set up, and the last attempt failed. Data may still be
 *                    good; `lastSyncedAt` says how old it is.
 * `disabled`       — set up, then deliberately turned off by the student.
 * `unavailable`    — cannot be configured on this install at all, because it
 *                    needs an authorization nobody has. Distinct from
 *                    `not_configured` so the UI never offers a dead button.
 */
export const INTEGRATION_STATUSES = [
  'not_configured',
  'connected',
  'error',
  'disabled',
  'unavailable',
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export interface IntegrationRecord {
  id: IntegrationId;
  status: IntegrationStatus;
  /** ISO. Last time data actually came through. */
  lastSyncedAt?: string;
  /** ISO. Last time a sync was *attempted*, successful or not. */
  lastAttemptAt?: string;
  /**
   * Short and human. Never a stack trace, never a URL — a feed URL is a
   * bearer credential and error text ends up in screenshots and exports.
   */
  lastError?: string;
  /** How many records the last successful sync produced. */
  lastItemCount?: number;
  /**
   * Non-secret identity of what is connected, for display:
   * `myschool.instructure.com`, or the mailbox a report arrived at.
   */
  account?: string;
}

/**
 * The Canvas calendar feed, minus the secret.
 *
 * The URL itself is never held here — it is a bearer credential that grants
 * read access to a student's whole calendar to anyone holding it. It lives
 * behind `lib/secrets.ts`, is excluded from the export allowlist, and is
 * rendered only as `host` plus a mask.
 */
export interface CanvasCalendarConfig {
  /** Whether a feed URL is on file at all. */
  configured: boolean;
  /** Host only, e.g. `myschool.instructure.com`. Safe to show and log. */
  host?: string;
  /** ISO. */
  connectedAt?: string;
  /** How often the companion should re-fetch, in minutes. */
  refreshMinutes: number;
  /** Feed events further out than this are ignored. */
  horizonDays: number;
}

/* ------------------------------------------------------------------ */
/* Per-field provenance                                                */
/* ------------------------------------------------------------------ */

/**
 * One value, and where it came from.
 *
 * The cost is a wrapper object per field; the payoff is that "Progress: 61.7%
 * (from this morning's email)" and "Target: 57.2% (from a report 3 days ago)"
 * can both be true on one card without the card having to guess.
 */
export interface FieldValue<T> {
  value: T;
  source: SourceRecord;
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

/**
 * Which Edgenuity product a course belongs to.
 *
 * This is not pedantry. Classic Edgenuity publishes an actual-versus-target
 * completion percentage and a documented pacing band around it. EdgeEX is a
 * different product with different pacing semantics, and applying classic
 * Edgenuity's percentage rule to it would produce a confident, wrong answer.
 * `UNKNOWN` is the honest default and the Pace Engine treats it as such.
 */
export const COURSE_PRODUCTS = ['EDGENUITY', 'EDGEEX', 'UNKNOWN'] as const;
export type CourseProduct = (typeof COURSE_PRODUCTS)[number];

/** An activity from a course report's schedule. */
export interface CourseActivity {
  /** Stable within a course: slugified name + scheduled date. */
  id: string;
  name: string;
  /** ISO date `YYYY-MM-DD`, when the report scheduled it. */
  scheduledDate?: string;
  /**
   * Only set when the report represents completion *unambiguously*. A blank
   * cell is not a "no" — it is a blank cell, and this stays undefined.
   */
  completed?: boolean;
}

export interface CourseProgress {
  id: string;
  provider: 'edgenuity';
  product: CourseProduct;
  /** Display name, e.g. `Algebra I`. */
  name: string;
  /** Whatever the source calls this course, when it exposes an id. */
  externalCourseId?: string;

  /* --- pacing, typically from a progress email --- */
  actualProgressPercent?: FieldValue<number>;
  targetProgressPercent?: FieldValue<number>;
  overallGrade?: FieldValue<number>;
  actualGrade?: FieldValue<number>;
  relativeGrade?: FieldValue<number>;

  /* --- the plan, typically from a course report --- */
  startDate?: FieldValue<string>;
  targetEndDate?: FieldValue<string>;
  activities: CourseActivity[];
  /** Source of the activity list, when there is one. */
  activitySource?: SourceRecord;

  /** ISO. The timestamp the *report itself* carried, not when we read it. */
  reportedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationsState {
  records: IntegrationRecord[];
  canvasCalendar: CanvasCalendarConfig;
  courses: CourseProgress[];
}
