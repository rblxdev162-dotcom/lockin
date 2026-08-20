/**
 * Connections to the outside world.
 *
 * An `IntegrationRecord` is the state of one connection, and it is deliberately
 * separate from the data that connection produced: a feed can be erroring while
 * the assignments it imported last week are still perfectly good, and LockIn
 * has to be able to say both things at once.
 */

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

export const INTEGRATION_IDS = [
  'canvas_calendar',
  'canvas_oauth',
  'companion',
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
 * lives in the companion extension, is excluded from the export allowlist, and
 * is rendered only as its host.
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

export interface IntegrationsState {
  records: IntegrationRecord[];
  canvasCalendar: CanvasCalendarConfig;
}
