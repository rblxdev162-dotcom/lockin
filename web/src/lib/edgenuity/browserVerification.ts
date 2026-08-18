/**
 * The Edgenuity *browser-read* verification policy — pure, no DOM, no React.
 *
 * The camera policy in `verification.ts` answers "do these two photographs
 * show real progress?". This one answers a narrower question: "the extension
 * just read this course's page — does that reading finish the work?"
 *
 * It is a separate file rather than a branch inside `verification.ts` because
 * the two have almost nothing in common. There is no session here, no pair of
 * proofs, no expiry, no challenge code, no course-name similarity check: a
 * reading arrives already attributed to a course id by the extension, from a
 * tab the background worker verified was on Edgenuity.
 *
 * What it keeps is the part that matters — invariant 10. New work is measured
 * from the highest reading already credited, never from the baseline, so the
 * same activities cannot be counted twice.
 *
 * The other half of that rule is the baseline itself: the first reading after
 * an assignment is configured credits *nothing*. A student who connects
 * Edgenuity 30 activities into a course must not have the target met the
 * instant the page loads.
 */
import type { EdgenuityConfig, EdgenuityLink } from '../../types/edgenuity';
import { requiredActivitiesOf, requiredDeltaOf } from './verification';

/** One reading, as it arrives from the extension. Two integers and an id. */
export interface EdgenuityReading {
  externalCourseId: string;
  courseName?: string;
  progressPercent?: number;
  /** What Edgenuity says the student should be at by now, when the page shows it. */
  targetPercent?: number;
  activitiesCompleted?: number;
  activitiesTotal?: number;
  readAt: string;
}

export type BrowserCheckOutcome =
  /** First reading for this assignment: recorded as the baseline, nothing credited. */
  | 'baseline'
  /** Real movement since the last credited reading. */
  | 'accepted'
  /** A valid reading that simply hasn't moved. Not an error, not a failure. */
  | 'no_change'
  | 'rejected';

export interface BrowserCheckResult {
  outcome: BrowserCheckOutcome;
  reason?: 'wrong_course' | 'unusable_reading' | 'no_target_metric';
  message: string;
  /** Activities newly credited by this reading. */
  newActivities: number;
  /** Percentage points newly credited by this reading. */
  newProgress: number;
  totalActivities: number;
  totalVerified: number;
  /** The ledger values to store: the high-water marks this reading sets. */
  lastVerifiedActivityCount?: number;
  lastVerifiedProgress: number | null;
  requirementMet: boolean;
}

function reject(
  reason: NonNullable<BrowserCheckResult['reason']>,
  message: string,
  link: EdgenuityLink,
): BrowserCheckResult {
  return {
    outcome: 'rejected',
    reason,
    message,
    newActivities: 0,
    newProgress: 0,
    totalActivities: link.verifiedActivities,
    totalVerified: link.verifiedProgressDelta,
    lastVerifiedActivityCount: link.lastVerifiedActivityCount,
    lastVerifiedProgress: link.lastVerifiedProgress,
    requirementMet: false,
  };
}

/** Whether this config is measured by reading the page rather than photographing it. */
export function isBrowserSource(config: EdgenuityConfig): boolean {
  return config.source === 'browser';
}

/**
 * Does this reading belong to this assignment?
 *
 * An assignment configured for a course id only ever accepts that id. Before
 * the id is known — the student configured the assignment before opening the
 * course — the first reading claims it, which is what `baseline` is for.
 */
export function readingMatches(config: EdgenuityConfig, reading: EdgenuityReading): boolean {
  return !config.externalCourseId || config.externalCourseId === reading.externalCourseId;
}

export function checkBrowserProgress({
  config,
  link,
  reading,
}: {
  config: EdgenuityConfig;
  link: EdgenuityLink;
  reading: EdgenuityReading;
}): BrowserCheckResult {
  if (!readingMatches(config, reading)) {
    return reject('wrong_course', 'that reading is from a different Edgenuity course', link);
  }

  const usesActivities = config.targetType === 'activities';
  const metric = usesActivities ? reading.activitiesCompleted : reading.progressPercent;
  if (metric === undefined || !Number.isFinite(metric)) {
    // The page was readable but not in the way this target needs — a course
    // showing a percentage only, against an activity-count target.
    return reject(
      'no_target_metric',
      usesActivities
        ? 'this course page does not show an activity count'
        : 'this course page does not show a progress percentage',
      link,
    );
  }
  if (metric < 0) return reject('unusable_reading', 'that reading could not be used', link);

  // First reading: remember where the student started, credit nothing.
  const baseline = link.browserBaseline;
  if (!baseline) {
    return {
      outcome: 'baseline',
      message: 'Starting point recorded. New work from here counts.',
      newActivities: 0,
      newProgress: 0,
      totalActivities: link.verifiedActivities,
      totalVerified: link.verifiedProgressDelta,
      lastVerifiedActivityCount: reading.activitiesCompleted,
      lastVerifiedProgress: reading.progressPercent ?? null,
      requirementMet: false,
    };
  }

  /**
   * Measure from the high-water mark, falling back to the baseline before
   * anything has been credited. A course that was reset reads *lower* than the
   * mark; that credits nothing rather than going negative, and the mark is
   * left alone so the student cannot farm the same activities by resetting.
   */
  if (usesActivities) {
    const from = link.lastVerifiedActivityCount ?? baseline.activitiesCompleted ?? metric;
    const newActivities = Math.max(0, Math.round(metric - from));
    const totalActivities = link.verifiedActivities + newActivities;
    const required = requiredActivitiesOf(config);

    return {
      outcome: newActivities > 0 ? 'accepted' : 'no_change',
      message:
        newActivities > 0
          ? `${newActivities} more ${newActivities === 1 ? 'activity' : 'activities'} completed.`
          : 'No new activities completed yet.',
      newActivities,
      newProgress: 0,
      totalActivities,
      totalVerified: link.verifiedProgressDelta,
      lastVerifiedActivityCount: Math.max(from, Math.round(metric)),
      lastVerifiedProgress: reading.progressPercent ?? link.lastVerifiedProgress,
      requirementMet: totalActivities >= required,
    };
  }

  const from = link.lastVerifiedProgress ?? baseline.progressPercent ?? metric;
  const newProgress = Math.max(0, Math.round(metric - from));
  const totalVerified = link.verifiedProgressDelta + newProgress;
  const required = requiredDeltaOf(config);

  return {
    outcome: newProgress > 0 ? 'accepted' : 'no_change',
    message:
      newProgress > 0
        ? `Course progress rose ${newProgress} point${newProgress === 1 ? '' : 's'}.`
        : 'Course progress has not moved yet.',
    newActivities: 0,
    newProgress,
    totalActivities: link.verifiedActivities,
    totalVerified,
    lastVerifiedActivityCount: reading.activitiesCompleted ?? link.lastVerifiedActivityCount,
    lastVerifiedProgress: Math.max(from, Math.round(metric)),
    requirementMet: totalVerified >= required,
  };
}
