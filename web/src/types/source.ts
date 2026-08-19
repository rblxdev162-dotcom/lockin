/**
 * Where a piece of school data came from, and how much it should be trusted.
 *
 * ## Why this exists
 *
 * Before Phase 16, provenance was smeared across four fields — `platform`
 * said "Canvas", `canvas` held a link, `verificationRecords` held evidence,
 * and nothing said when any of it was last true. That was survivable while
 * there was one source per platform. It stops being survivable the moment
 * Edgenuity progress can arrive from a progress email *and* a course report,
 * and the two disagree about which is newer.
 *
 * So every external academic record now carries a `SourceRecord`: which
 * channel produced it, when, whether that channel is live, and what went wrong
 * if anything did.
 *
 * ## The rule the whole file exists to enforce
 *
 * **Freshness is derived, never stored.** A stored `state: 'LIVE'` is a lie
 * the moment the clock moves; `classify()` takes `now` as an input and works
 * it out every time. There is deliberately no setter for `DataState`.
 */

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every channel school data can legitimately reach LockIn through.
 *
 * `CANVAS_CALENDAR` — the official Canvas Calendar Feed (ICS). Implemented.
 * `CANVAS_OAUTH`    — Canvas REST API under a proper Developer Key. The
 *                     adapter boundary exists; the authorization does not.
 * `EDGENUITY_PROGRESS_EMAIL`
 *                   — a progress report Edgenuity emailed to the authorized
 *                     guardian, parsed locally.
 * `EDGENUITY_COURSE_REPORT`
 *                   — a course report the student legitimately downloaded
 *                     from their own account, parsed locally.
 * `EDGENUITY_APPROVED_API`
 *                   — interface only. Nothing probes an undocumented endpoint.
 * `MANUAL`          — the student typed it. Real work, zero external evidence.
 * `LOCKIN_VERIFIED` — LockIn itself watched it happen (a screen-share reading,
 *                     a Canvas submission it read on the page).
 */
export const SOURCE_KINDS = [
  'CANVAS_CALENDAR',
  'CANVAS_OAUTH',
  'EDGENUITY_PROGRESS_EMAIL',
  'EDGENUITY_COURSE_REPORT',
  'EDGENUITY_APPROVED_API',
  'MANUAL',
  'LOCKIN_VERIFIED',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * How a record should be presented right now.
 *
 * `LIVE`        — a connection that is answering, refreshed within its cadence.
 * `SYNCED`      — pulled from a real connection, inside its freshness window.
 * `IMPORTED`    — came from a file the student handed over. Never goes stale on
 *                 its own — it was a snapshot when it arrived and it says so.
 * `VERIFIED`    — LockIn watched the evidence itself.
 * `STALE`       — from a real connection that has not answered in too long.
 * `MANUAL`      — typed. Accurate or not, LockIn has no way to know.
 * `UNAVAILABLE` — the connection is erroring, or was never established.
 */
export const DATA_STATES = [
  'LIVE',
  'SYNCED',
  'IMPORTED',
  'VERIFIED',
  'STALE',
  'MANUAL',
  'UNAVAILABLE',
] as const;
export type DataState = (typeof DATA_STATES)[number];

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/**
 * The provenance stamp carried by every externally-sourced record.
 *
 * Small on purpose: this is attached to every assignment and every course, so
 * it has to survive a hundred of them without bloating storage.
 */
export interface SourceRecord {
  kind: SourceKind;
  /**
   * Which *connection* produced this, when a kind can have more than one —
   * e.g. two Canvas calendar feeds, or two imported course reports. Stable
   * across syncs; it is what deduplication keys on together with `externalId`.
   */
  sourceId: string;
  /**
   * The identifier the external system uses. An ICS `UID`, a Canvas
   * assignment id. Absent for MANUAL. Never a URL containing a secret.
   */
  externalId?: string;
  /** ISO. When this record was last refreshed from its source. */
  lastSyncedAt?: string;
  /** ISO. When a human or LockIn last confirmed it against reality. */
  lastVerifiedAt?: string;
  confidence: Confidence;
  /**
   * True only while the producing connection is genuinely answering. A file
   * import is never live, however recent it is.
   */
  isLive: boolean;
  /** Short, human-readable. Never a stack trace, never a secret URL. */
  syncError?: string;
  /**
   * Whether the original payload (ICS text, email HTML, report file) is still
   * held anywhere. LockIn's answer is `false` everywhere today; the field
   * exists so the Integrations page can state it as a fact rather than a
   * promise.
   */
  rawDataRetained: boolean;
}

/* ------------------------------------------------------------------ */
/* Freshness policy                                                    */
/* ------------------------------------------------------------------ */

/**
 * How long a source's data stays believable, in hours.
 *
 * These are not arbitrary. A calendar feed is polled a few times a day, so six
 * hours is a missed poll, not a problem; twenty-four is. Edgenuity progress
 * emails arrive on a schedule the family chose — weekly is common — so the
 * window is days, and the number is deliberately generous: telling a student
 * their data is stale when it is behaving exactly as configured trains them to
 * ignore the word.
 */
export const FRESHNESS_HOURS: Record<SourceKind, { fresh: number; stale: number }> = {
  CANVAS_CALENDAR: { fresh: 6, stale: 24 },
  CANVAS_OAUTH: { fresh: 1, stale: 12 },
  EDGENUITY_PROGRESS_EMAIL: { fresh: 24 * 8, stale: 24 * 14 },
  EDGENUITY_COURSE_REPORT: { fresh: 24 * 7, stale: 24 * 21 },
  EDGENUITY_APPROVED_API: { fresh: 6, stale: 24 },
  MANUAL: { fresh: Infinity, stale: Infinity },
  LOCKIN_VERIFIED: { fresh: 24 * 3, stale: 24 * 14 },
};

/** Sources that represent a one-off snapshot rather than a live connection. */
export const IMPORT_KINDS: readonly SourceKind[] = [
  'EDGENUITY_COURSE_REPORT',
  'EDGENUITY_PROGRESS_EMAIL',
];

export interface Freshness {
  state: DataState;
  /** Milliseconds since `lastSyncedAt`, or null when it was never synced. */
  ageMs: number | null;
  /** True when the age has passed this source's `stale` threshold. */
  stale: boolean;
  /** One short sentence, e.g. "Synced 7 minutes ago". Never a bare number. */
  label: string;
}
