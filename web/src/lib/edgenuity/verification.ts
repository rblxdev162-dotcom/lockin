/**
 * The Edgenuity verification policy — pure, no DOM, no React.
 *
 * Answers one question: *given a starting proof and a final proof, has the
 * student actually made the progress they were required to make?* The bias is
 * the same asymmetry the Canvas policy uses — a false negative costs a retake,
 * a false positive unlocks distractions on work that was never done — with one
 * extra constraint that Canvas does not have: the evidence is a photograph, so
 * nothing here may ever be described as proving the screen was genuine.
 *
 * Two rules do most of the work:
 *
 *  - Only a live camera capture can produce a verified result. A manually
 *    corrected value, or a fixture image, is recorded as unverified and cannot
 *    unlock Strict Mode. Otherwise a student could type `100` and be done.
 *  - New progress is measured from `lastVerifiedProgress`, never from the
 *    original starting reading, so the same three points cannot be claimed
 *    twice.
 */
import type {
  EdgenuityConfig,
  EdgenuityLink,
  EdgenuityProof,
  EdgenuitySession,
  VerificationTrust,
} from '../../types/edgenuity';
import {
  EDGENUITY_LARGE_JUMP,
  EDGENUITY_MIN_GAP_MS,
  EDGENUITY_SESSION_TTL_MS,
  meetsTrust,
  weakerTrust,
} from '../../types/edgenuity';
import { meetsEnhancedScreenBar } from './parser';
import { isSameActivity, isSameCourse } from './similarity';

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/**
 * A starting proof stays comparable for 12 hours.
 *
 * Long enough for a normal school day with lunch and other classes in the
 * middle; short enough that Monday's photo cannot be paired with Friday's.
 */
export function sessionExpiryFrom(startedAt: string): string {
  return new Date(Date.parse(startedAt) + EDGENUITY_SESSION_TTL_MS).toISOString();
}

export function isSessionExpired(session: EdgenuitySession, now = Date.now()): boolean {
  const expires = Date.parse(session.expiresAt);
  return Number.isNaN(expires) || expires <= now;
}

/** The one live session for an assignment, if there is one. */
export function activeSessionFor(
  sessions: EdgenuitySession[],
  assignmentId: string,
  now = Date.now(),
): EdgenuitySession | undefined {
  return sessions.find(
    (s) => s.assignmentId === assignmentId && s.status === 'in_progress' && !isSessionExpired(s, now),
  );
}

/* ------------------------------------------------------------------ */
/* Targets                                                            */
/* ------------------------------------------------------------------ */

export function requiredDeltaOf(config: EdgenuityConfig): number {
  return Math.max(1, Math.round(config.requiredProgressDelta ?? 3));
}

export function requiredActivitiesOf(config: EdgenuityConfig): number {
  return Math.max(1, Math.round(config.requiredActivities ?? 1));
}

export function requiredFocusMinutesOf(config: EdgenuityConfig): number {
  return Math.max(1, Math.round(config.requiredFocusMinutes ?? 25));
}

/* ------------------------------------------------------------------ */
/* Trust (Phase 5)                                                     */
/* ------------------------------------------------------------------ */

/**
 * What one captured frame is worth.
 *
 * `enhanced` needs three things at once: a live camera frame, a challenge that
 * was actually matched in that frame, and a screen convincing enough to clear
 * the higher bar. Any one missing drops it to `standard`, and a frame that
 * isn't live is worth nothing at all.
 */
export function proofTrust(proof: EdgenuityProof): VerificationTrust {
  /**
   * A shared window can never reach Enhanced, and the reason is physical
   * rather than policy: the Enhanced bar is a code written by hand and held in
   * shot, and a hand holding paper does not appear inside a screen capture.
   *
   * So it stops at Standard. That is not a demotion of screen capture — an
   * assignment marked Enhanced keeps demanding the camera it was marked for,
   * instead of quietly accepting a proof that cannot carry the code
   * (invariant 13).
   */
  if (proof.source === 'live_screen') return 'standard';
  if (proof.source !== 'live_camera') return 'manual';
  const challengeOk = proof.challenge?.matched === true;
  const screenOk = proof.screenEvidence ? meetsEnhancedScreenBar(proof.screenEvidence) : false;
  return challengeOk && screenOk ? 'enhanced' : 'standard';
}

/**
 * What a *session* is worth: the weaker of its two frames.
 *
 * This is what stops half an Enhanced verification counting as one. A challenge
 * on the final photo alone would leave the starting reading replayable, which
 * is the attack the feature exists to close.
 */
export function sessionTrust(session: EdgenuitySession, after: EdgenuityProof): VerificationTrust {
  return weakerTrust(session.before.trust ?? proofTrust(session.before), proofTrust(after));
}

/**
 * The trust an assignment must reach.
 *
 * Always `standard` since Phase 15.
 *
 * Enhanced was a handwritten one-time code photographed beside the screen, and
 * it went out with the camera — a shared window cannot hold up a piece of
 * paper. The function stays, rather than every call site learning that the
 * answer is now a constant, and because a bar is exactly the kind of thing
 * that comes back.
 *
 * It deliberately ignores any stored `requiredVerificationTrust` and any old
 * `edgenuityProofMode`. A save file written before this change can still say
 * `enhanced`, and honouring that would set a bar nothing on this device can
 * clear — an assignment that could never be completed, with no way for the
 * student to find out why.
 */
export function requiredTrustFor(_config?: EdgenuityConfig): VerificationTrust {
  return 'standard';
}

/** A fresh ledger for a newly configured Edgenuity assignment. */
export function emptyLedger(config: EdgenuityConfig): EdgenuityLink {
  return {
    config,
    verifiedProgressDelta: 0,
    lastVerifiedProgress: null,
    verifiedActivities: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Checking a final proof                                              */
/* ------------------------------------------------------------------ */

export const EDGENUITY_REJECT_REASONS = [
  'not_live',
  'expired',
  'different_course',
  'unreadable',
  'progress_reversed',
  'no_new_progress',
  'not_enough_focus_time',
  'no_activity_change',
  'insufficient_trust',
] as const;
export type EdgenuityRejectReason = (typeof EDGENUITY_REJECT_REASONS)[number];

export type EdgenuityOutcome = 'verified' | 'partial' | 'needs_confirmation' | 'rejected';

export interface EdgenuityCheckResult {
  outcome: EdgenuityOutcome;
  reason?: EdgenuityRejectReason;
  /** Why a second photo is needed, when `outcome` is `needs_confirmation`. */
  confirmReason?: 'large_jump' | 'too_fast';
  /** Student-facing sentence. Never claims the photo proves authenticity. */
  message: string;

  /** Percentage points credited by *this* check. */
  newProgress: number;
  /** Cumulative verified points after this check. */
  totalVerified: number;
  requiredDelta: number;
  progressBefore?: number;
  progressAfter?: number;
  /** Ledger value to store; unchanged when nothing was credited. */
  lastVerifiedProgress: number | null;
  activitiesCredited: number;
  totalActivities: number;
  requirementMet: boolean;
  /** How strong this evidence is, for honest labelling in the UI. */
  strength: 'course_progress' | 'activity_count' | 'focus_plus_proof';
  /** Trust actually achieved by this pair of frames (Phase 5). */
  trust: VerificationTrust;
  /** Trust the assignment demanded, for the "still required" message. */
  requiredTrust: VerificationTrust;
}

/**
 * What the per-target checks return.
 *
 * They decide *whether progress counts*; only `checkProgress` knows the trust
 * levels involved, and it stamps them on the way out. Splitting the type this
 * way means a new target type physically cannot forget to report trust.
 */
type UnstampedResult = Omit<EdgenuityCheckResult, 'trust' | 'requiredTrust'>;

export interface CheckContext {
  session: EdgenuitySession;
  link: EdgenuityLink;
  after: EdgenuityProof;
  /** Minutes logged against this assignment right now (for `session_progress`). */
  focusMinutesNow: number;
  now?: number;
}

function reject(
  reason: EdgenuityRejectReason,
  message: string,
  link: EdgenuityLink,
  config: EdgenuityConfig,
  extra: Partial<EdgenuityCheckResult> = {},
): EdgenuityCheckResult {
  return {
    outcome: 'rejected',
    reason,
    message,
    newProgress: 0,
    totalVerified: link.verifiedProgressDelta,
    requiredDelta: requiredDeltaOf(config),
    lastVerifiedProgress: link.lastVerifiedProgress,
    activitiesCredited: 0,
    totalActivities: link.verifiedActivities,
    requirementMet: false,
    strength: 'course_progress',
    // Overwritten by `checkProgress` once the real levels are known; these are
    // only the values a refusal carries before that point.
    trust: 'manual',
    requiredTrust: config.requiredVerificationTrust ?? 'standard',
    ...extra,
  };
}

/**
 * The whole decision, in one pure function.
 *
 * Everything it needs is passed in, so the reducer, the UI and the tests all
 * ask the same question the same way and cannot drift apart.
 */
export function checkProgress(context: CheckContext): EdgenuityCheckResult {
  const { session, link, after, focusMinutesNow } = context;
  const now = context.now ?? Date.now();
  const config = session.target;

  /* --- Gate 1: live capture only. --- */
  /**
   * A live *stream* this tab opened — the camera, or a window the student
   * shared. What is excluded is unchanged: a file, a fixture, or anything a
   * hand-edited save file claims to be. The rule was never about lenses.
   */
  const live = (source: EdgenuityProof['source']) =>
    source === 'live_camera' || source === 'live_screen';
  if (!live(session.before.source) || !live(after.source)) {
    return reject(
      'not_live',
      'Only a live camera photo or a shared window can verify progress. This capture is recorded as unverified.',
      link,
      config,
    );
  }

  /**
   * Both halves must come from the same kind of capture.
   *
   * Mixing them would let a student photograph a screen for the starting
   * reading and share a doctored window for the final one, and the pair would
   * still look like one session.
   */
  if (session.before.source !== after.source) {
    return reject(
      'not_live',
      'Both readings have to come from the same place — two photos, or two shared windows.',
      link,
      config,
    );
  }

  /* --- Gate 2: the pair has to belong to one session. --- */
  if (isSessionExpired(session, now)) {
    return reject(
      'expired',
      'This starting verification has expired. Take a new starting photo to continue.',
      link,
      config,
    );
  }

  /* --- Gate 3: the same course, when both photos name one. --- */
  const beforeCourse = session.before.courseName ?? config.courseName;
  if (!isSameCourse(beforeCourse, after.courseName)) {
    return reject(
      'different_course',
      'This appears to be a different course. Please show the same Edgenuity course.',
      link,
      config,
    );
  }

  /* --- Gate 4 (Phase 5): strong enough evidence for what was asked. --- */
  const requiredTrust = session.requiredTrust ?? 'standard';
  const achievedTrust = sessionTrust(session, after);
  /** Every result from here down carries the trust levels that produced it. */
  const stamp = (result: UnstampedResult): EdgenuityCheckResult => ({
    ...result,
    trust: achievedTrust,
    requiredTrust,
  });

  if (!meetsTrust(achievedTrust, requiredTrust)) {
    /**
     * Nothing is credited here, deliberately.
     *
     * Banking the progress and asking for the code afterwards would let a
     * student build up their whole target at Standard strength and then top it
     * off with one Enhanced capture — the assignment would complete carrying an
     * Enhanced badge over progress that was never proved that way. Refusing the
     * capture keeps the ledger and the badge honest, and a retake costs seconds.
     */
    return stamp(
      reject(
        'insufficient_trust',
        'Progress was read, but this assignment needs Enhanced Proof — retake the photo with the current verification code visible.',
        link,
        config,
      ),
    );
  }

  if (config.targetType === 'session_progress') {
    return stamp(checkFocusPlusProof(session, link, after, focusMinutesNow));
  }
  if (config.targetType === 'activities') {
    return stamp(checkActivities(session, link, after));
  }
  return stamp(checkPercentProgress(session, link, after, now));
}

/* ---------------- Type 1: course progress percentage ---------------- */

function checkPercentProgress(
  session: EdgenuitySession,
  link: EdgenuityLink,
  after: EdgenuityProof,
  now: number,
): UnstampedResult {
  const config = session.target;
  const required = requiredDeltaOf(config);
  const before = session.before.progressPercent;
  const current = after.progressPercent;

  if (before === undefined || current === undefined) {
    return reject(
      'unreadable',
      'We couldn’t read the progress percentage clearly. Try again with the progress number larger on screen.',
      link,
      config,
      { progressBefore: before, progressAfter: current },
    );
  }

  /**
   * Progress is measured from the highest already-verified reading, so a second
   * check at 48% after 46% was verified credits +2, not +5.
   */
  const baseline = link.lastVerifiedProgress ?? before;

  if (current < baseline) {
    // Could be a course reset, a different section, or a misread. We do not
    // guess, and previously earned progress is never taken away.
    return reject(
      'progress_reversed',
      'Unable to confirm new progress — this reading is lower than the last verified one. Progress already verified is kept.',
      link,
      config,
      { progressBefore: baseline, progressAfter: current },
    );
  }

  const gain = round1(current - baseline);

  if (gain === 0) {
    return reject(
      'no_new_progress',
      'No new progress since the last check. Keep working and verify again.',
      link,
      config,
      { progressBefore: baseline, progressAfter: current },
    );
  }

  /* --- Sanity checks: flag, never accuse. --- */
  const elapsed = now - Date.parse(session.before.capturedAt);
  const pending = session.pendingConfirmation;
  const confirmsPending =
    pending !== undefined &&
    pending.progressPercent !== undefined &&
    Math.abs(current - pending.progressPercent) <= 1;

  if (!confirmsPending) {
    if (gain >= EDGENUITY_LARGE_JUMP) {
      return {
        ...reject('no_new_progress', '', link, config),
        outcome: 'needs_confirmation',
        reason: undefined,
        confirmReason: 'large_jump',
        message: `Large progress change detected (+${gain}%). Please take another verification photo.`,
        progressBefore: baseline,
        progressAfter: current,
      };
    }
    if (elapsed < EDGENUITY_MIN_GAP_MS && gain > 1) {
      return {
        ...reject('no_new_progress', '', link, config),
        outcome: 'needs_confirmation',
        reason: undefined,
        confirmReason: 'too_fast',
        message:
          'That was very soon after the starting photo. Please take another verification photo to confirm.',
        progressBefore: baseline,
        progressAfter: current,
      };
    }
  }

  const totalVerified = round1(link.verifiedProgressDelta + gain);
  const met = totalVerified >= required;

  return {
    outcome: met ? 'verified' : 'partial',
    message: met
      ? `Progress verified — ${before}% → ${current}% (+${totalVerified}% of ${required}% required).`
      : `+${gain}% verified. ${round1(required - totalVerified)}% still to go.`,
    newProgress: gain,
    totalVerified,
    requiredDelta: required,
    progressBefore: baseline,
    progressAfter: current,
    lastVerifiedProgress: current,
    activitiesCredited: 0,
    totalActivities: link.verifiedActivities,
    requirementMet: met,
    strength: 'course_progress',
  };
}

/* ---------------- Type 2: activity completion (experimental) ---------------- */

/**
 * Counting activities needs three things read reliably: an activity name
 * before, an activity name after, and a real change between them. When OCR
 * cannot give that, this refuses rather than inventing a count — which is why
 * the UI labels this mode experimental and steers students to percentages.
 */
function checkActivities(
  session: EdgenuitySession,
  link: EdgenuityLink,
  after: EdgenuityProof,
): UnstampedResult {
  const config = session.target;
  const required = requiredActivitiesOf(config);
  const beforeActivity = link.lastActivityName ?? session.before.activityName;
  const afterActivity = after.activityName;

  if (!beforeActivity || !afterActivity || after.parseConfidence === 'low') {
    return reject(
      'unreadable',
      'We couldn’t read the activity name clearly enough to count it. Use progress-percentage verification when possible.',
      link,
      config,
      { strength: 'activity_count' },
    );
  }

  if (isSameActivity(beforeActivity, afterActivity)) {
    return reject(
      'no_activity_change',
      'This looks like the same activity as before. Finish the next one, then verify again.',
      link,
      config,
      { strength: 'activity_count' },
    );
  }

  // One confirmed change credits exactly one activity. Sequence numbers are not
  // subtracted — Edgenuity numbering is not dependable enough for arithmetic.
  const total = link.verifiedActivities + 1;
  const met = total >= required;
  return {
    outcome: met ? 'verified' : 'partial',
    message: met
      ? `Activity change verified — ${total} of ${required} activities.`
      : `1 activity verified. ${required - total} still to go.`,
    newProgress: 0,
    totalVerified: link.verifiedProgressDelta,
    requiredDelta: requiredDeltaOf(config),
    lastVerifiedProgress: link.lastVerifiedProgress,
    activitiesCredited: 1,
    totalActivities: total,
    requirementMet: met,
    strength: 'activity_count',
  };
}

/* ---------------- Type 3: focus time + screen proof ---------------- */

/**
 * The honest fallback for courses whose percentage never reads reliably.
 *
 * It proves only that the student showed the same Edgenuity course before and
 * after a real focus session — which is why the result is labelled
 * "Focus + Screen Proof" and never "Course Progress Verified".
 */
function checkFocusPlusProof(
  session: EdgenuitySession,
  link: EdgenuityLink,
  after: EdgenuityProof,
  focusMinutesNow: number,
): UnstampedResult {
  const config = session.target;
  const requiredMinutes = requiredFocusMinutesOf(config);
  const studied = Math.max(0, focusMinutesNow - session.focusMinutesAtStart);

  if (studied < requiredMinutes) {
    return reject(
      'not_enough_focus_time',
      `Focus + Screen Proof needs ${requiredMinutes} minutes of focus time — ${studied} logged so far.`,
      link,
      config,
      { strength: 'focus_plus_proof' },
    );
  }

  const current = after.progressPercent;
  const before = session.before.progressPercent;
  const gain =
    current !== undefined && before !== undefined && current >= before ? round1(current - before) : 0;

  return {
    outcome: 'verified',
    message: `Focus + Screen Proof complete — ${studied} minutes of focus time and matching Edgenuity screens.`,
    newProgress: gain,
    totalVerified: round1(link.verifiedProgressDelta + gain),
    requiredDelta: requiredDeltaOf(config),
    progressBefore: before,
    progressAfter: current,
    lastVerifiedProgress: current ?? link.lastVerifiedProgress,
    activitiesCredited: 0,
    totalActivities: link.verifiedActivities,
    requirementMet: true,
    strength: 'focus_plus_proof',
  };
}

/**
 * The trust stored on a completed record.
 *
 * Records written before Phase 5 carry no trust field; they were live-camera
 * verifications without a challenge, which is exactly `standard`.
 */
export function trustOfRecord(record: { evidence?: Record<string, unknown> }): VerificationTrust {
  const value = record.evidence?.trust;
  return value === 'enhanced' || value === 'standard' || value === 'manual' ? value : 'standard';
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/** Honest naming: only percentage targets may claim verified course progress. */
export const STRENGTH_LABEL: Record<EdgenuityCheckResult['strength'], string> = {
  course_progress: 'Course Progress Verified',
  activity_count: 'Activity Change Verified (experimental)',
  focus_plus_proof: 'Focus + Screen Proof',
};

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
