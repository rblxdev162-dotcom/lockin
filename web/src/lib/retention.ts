/**
 * How long LockIn keeps things (Phase 8).
 *
 * localStorage gives a page roughly 5 MB, and a few of LockIn's lists grow
 * with *use* rather than with the amount of schoolwork. Left alone, a heavy
 * year of studying would eventually push the store into quota errors, and the
 * first symptom would be a silently failed save.
 *
 * The rule everywhere below: **history is capped, data is not.** Assignments,
 * exams, the plan, the parent PIN and parent settings have no cap at all, and
 * nothing here ever deletes one.
 *
 * Applied in two places, on purpose:
 *   - the reducer, as records are written (so memory is bounded too)
 *   - `lib/storage.ts` on load (so an oversized file from an older build, or a
 *     hand-edited one, is brought back inside the budget)
 */
import type { ActivityEvent, ActivityType, VerificationRecord } from '../types';

/** Newest activity entries kept, of any kind. */
export const MAX_ACTIVITY = 300;

/**
 * Of that budget, this many are reserved for accountability events.
 *
 * Without a reservation the log is a plain ring buffer, and a busy afternoon of
 * ordinary edits can push every parent override and emergency exit out of the
 * record within a single session — which is exactly the history a parent opens
 * the dashboard to read. Planner keystroke spam was fixed in Phase 7 by not
 * logging it at all; this is the general defence for whatever is noisy next.
 */
export const MAX_KEY_ACTIVITY = 150;

/** Focus sessions kept in `completedSessions`. */
export const MAX_COMPLETED_SESSIONS = 400;

/** Per-domain block counters kept. */
export const MAX_BLOCK_STATS = 100;

/** Verification records kept per assignment. */
export const MAX_VERIFICATION_RECORDS = 40;

/**
 * Events a parent is entitled to find later, whatever else happened since.
 * Everything not listed here is ordinary bookkeeping.
 */
export const KEY_ACTIVITY_TYPES: ReadonlySet<ActivityType> = new Set<ActivityType>([
  'focus_mode_started',
  'focus_mode_completed',
  'focus_mode_ended',
  'parent_override',
  'emergency_exit',
  'temporary_unlock_started',
  'temporary_unlock_ended',
  'assignment_completed',
  'blocking_test_started',
  'allowlist_changed',
  'pin_changed',
  'canvas_submission_verified',
  'edgenuity_progress_verified',
  'edgenuity_verification_failed',
  'parent_controls_changed',
  'parent_requirement_changed',
]);

export function isKeyActivity(event: ActivityEvent): boolean {
  return KEY_ACTIVITY_TYPES.has(event.type);
}

/**
 * Trims the activity log newest-first, keeping `MAX_ACTIVITY` entries but
 * never dropping one of the newest `MAX_KEY_ACTIVITY` accountability events to
 * make room for ordinary ones.
 *
 * Relative order is preserved, so the log still reads as a timeline — it just
 * has gaps where noise used to be, rather than a cliff where history used to
 * be.
 */
export function trimActivity(list: readonly ActivityEvent[]): ActivityEvent[] {
  if (list.length <= MAX_ACTIVITY) return list as ActivityEvent[];

  const keep = new Set<string>();
  let keyKept = 0;
  for (const event of list) {
    if (keyKept >= MAX_KEY_ACTIVITY) break;
    if (isKeyActivity(event)) {
      keep.add(event.id);
      keyKept += 1;
    }
  }

  const budget = MAX_ACTIVITY - keep.size;
  let ordinaryKept = 0;
  const out: ActivityEvent[] = [];
  for (const event of list) {
    if (keep.has(event.id)) {
      out.push(event);
      continue;
    }
    if (ordinaryKept < budget) {
      out.push(event);
      ordinaryKept += 1;
    }
  }
  return out;
}

/** Keeps the newest verification records for one assignment. */
export function trimVerificationRecords(list: readonly VerificationRecord[]): VerificationRecord[] {
  return list.length <= MAX_VERIFICATION_RECORDS
    ? (list as VerificationRecord[])
    : list.slice(0, MAX_VERIFICATION_RECORDS);
}
