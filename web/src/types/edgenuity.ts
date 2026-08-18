/**
 * Edgenuity live-camera progress verification types (Phase 4).
 *
 * Edgenuity usually runs on a school-managed computer LockIn cannot inspect, so
 * the evidence is a *photo of that screen* taken on the student's own device,
 * read locally with OCR. That is deliberately weaker than the Canvas path: it
 * makes casual lying harder than pressing "I did it", and it is never described
 * as proof the screen is genuine.
 *
 * Identity note: unlike Canvas there is no external assignment id to key on.
 * An Edgenuity verification session belongs to exactly one LockIn assignment
 * and one session id, and proofs are only ever compared inside one session.
 */

/* ------------------------------------------------------------------ */
/* Configuration — how a student's progress is measured                */
/* ------------------------------------------------------------------ */

/**
 * `progress_percent`  — course-progress percentage must rise by N points.
 * `activities`        — N activities completed. Experimental: only counts when
 *                       activity names are read confidently on both photos.
 * `session_progress`  — fallback for courses whose percentage OCR is not
 *                       reliable: a focus session *plus* before/after screen
 *                       proof of the same course. Labelled "Focus + Screen
 *                       Proof", never "Course Progress Verified".
 */
/**
 * Where a reading came from (Phase 11).
 *
 * `camera`  — Phase 4: a photo of the Edgenuity screen, read locally with OCR.
 * `browser` — the LockIn extension read the number off the Edgenuity page the
 *             student themselves opened, in their own logged-in session.
 *
 * Neither is "the real one". A camera works when Edgenuity runs on a school
 * computer LockIn cannot see; a browser read works when it runs in the same
 * Chrome. An assignment picks one.
 */
export const EDGENUITY_SOURCES = ['camera', 'browser'] as const;
export type EdgenuitySource = (typeof EDGENUITY_SOURCES)[number];

export const EDGENUITY_TARGET_TYPES = [
  'progress_percent',
  'activities',
  'session_progress',
] as const;
export type EdgenuityTargetType = (typeof EDGENUITY_TARGET_TYPES)[number];

export interface EdgenuityConfig {
  /** How progress is measured. Defaults to `camera` — Phase 4's behaviour. */
  source?: EdgenuitySource;
  /**
   * `browser` only: which Edgenuity course this assignment tracks, as reported
   * by the extension. Readings for any other course are refused outright —
   * otherwise finishing Biology would complete the Algebra assignment.
   */
  externalCourseId?: string;
  /** What Edgenuity calls the course, e.g. `Physical Science Semester A`. */
  courseName?: string;
  /** Optional activity/lesson label the student is working through. */
  activityName?: string;
  targetType: EdgenuityTargetType;
  /** `progress_percent`: percentage points of new progress required. */
  requiredProgressDelta?: number;
  /** `activities`: how many activities must be completed. */
  requiredActivities?: number;
  /** `session_progress`: focus minutes required alongside the screen proof. */
  requiredFocusMinutes?: number;
  /**
   * How strong the evidence has to be for this assignment (Phase 5).
   * Defaults to `standard`; the global proof-mode setting can raise the floor
   * but never lower it. See `requiredTrustFor()`.
   */
  requiredVerificationTrust?: RequirableTrust;
}

/* ------------------------------------------------------------------ */
/* Trust levels (Phase 5)                                              */
/* ------------------------------------------------------------------ */

/**
 * How much a piece of evidence is worth.
 *
 * `manual`   — the student told us. Never unlocks anything.
 * `standard` — Phase 4: a live camera frame that OCR read as an Edgenuity
 *              screen with a progress value.
 * `browser`  — Phase 11: the extension read the number off the Edgenuity page
 *              in the student's own logged-in session. Immune to the replay a
 *              photo allows — nobody can hold up last week's screen — so it
 *              outranks `standard`.
 * `enhanced` — Phase 5: the same as `standard`, plus a one-time code issued
 *              seconds earlier that had to appear in the same frame. Kept above
 *              `browser` so an assignment a parent marked Enhanced still needs
 *              the code it was marked for; ordering never over-credits.
 *
 * Ordered deliberately so comparisons are just index arithmetic.
 */
export const VERIFICATION_TRUSTS = ['manual', 'standard', 'browser', 'enhanced'] as const;
export type VerificationTrust = (typeof VERIFICATION_TRUSTS)[number];

/**
 * The trust levels a *requirement* can be set to.
 *
 * `browser` is something a reading can be, never something a student can be
 * asked for: the bar is "photograph it" or "photograph it with a code", and a
 * page read either happens or doesn't. Keeping the requirement narrow is what
 * stops "required: browser" becoming an unreachable bar on a school computer.
 */
export type RequirableTrust = Extract<VerificationTrust, 'standard' | 'enhanced'>;

export function trustRank(trust: VerificationTrust): number {
  const index = VERIFICATION_TRUSTS.indexOf(trust);
  // An unrecognised value must never outrank a real one.
  return index === -1 ? 0 : index;
}

export function meetsTrust(achieved: VerificationTrust, required: VerificationTrust): boolean {
  return trustRank(achieved) >= trustRank(required);
}

/** The weaker of two trust levels — a session is only as strong as its weakest proof. */
export function weakerTrust(a: VerificationTrust, b: VerificationTrust): VerificationTrust {
  return trustRank(a) <= trustRank(b) ? a : b;
}

export const TRUST_LABEL: Record<VerificationTrust, string> = {
  manual: 'MANUAL',
  standard: 'STANDARD VERIFIED',
  browser: 'READ FROM EDGENUITY',
  enhanced: 'ENHANCED VERIFIED',
};

/**
 * Stored on an Assignment whose `completionMethod` is `edgenuity`.
 *
 * `verifiedProgressDelta` and `lastVerifiedProgress` are the anti-double-count
 * ledger: each successful check adds only the progress above the last verified
 * reading, never the whole distance from the original starting point.
 */
export interface EdgenuityLink {
  config: EdgenuityConfig;
  /** Total percentage points verified so far across all checks. */
  verifiedProgressDelta: number;
  /** Highest progress reading ever verified. New progress is measured from here. */
  lastVerifiedProgress: number | null;
  /** Activities credited so far (target type `activities`). */
  verifiedActivities: number;
  /**
   * `browser` only: the reading this assignment started from, and the highest
   * reading credited since.
   *
   * The baseline exists because connecting mid-course must credit nothing —
   * without it, a student 30 activities into Biology would have the target met
   * the instant the extension read the page. Invariant 10 in its browser form.
   */
  browserBaseline?: { activitiesCompleted?: number; progressPercent?: number; at: string };
  /** Highest completed-activity count ever credited. New work is measured from here. */
  lastVerifiedActivityCount?: number;
  /** Course name as last read from a photo — used to reject a different course. */
  observedCourseName?: string;
  lastActivityName?: string;
  lastVerifiedAt?: string;
  /** Trust of the most recent accepted check, for the badge (Phase 5). */
  lastVerifiedTrust?: VerificationTrust;
}

/* ------------------------------------------------------------------ */
/* OCR results                                                         */
/* ------------------------------------------------------------------ */

export const PARSE_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ParseConfidence = (typeof PARSE_CONFIDENCES)[number];

/**
 * One recognised word and where it sat on the page.
 *
 * Plain OCR text flattens a two-column layout into
 * `Course Progress Overall Grade` / `43% 92%`, which makes it impossible to
 * tell which number belongs to which label. Word positions are what make that
 * association possible, so they are carried alongside the text.
 */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rectangle in image coordinates. */
export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One candidate percentage found in the text, with the reason it scored. */
export interface PercentCandidate {
  value: number;
  /** 0..1 — how strongly the surrounding words suggest *course progress*. */
  score: number;
  /** The words that earned the score, e.g. `['course progress']`. */
  reasons: string[];
  /** The line it was found on, trimmed and capped. Diagnostics only. */
  context: string;
  /**
   * Where the value and its label sat, when word positions were available.
   * Phase 5 uses it to insist a challenge code is somewhere *else* in the frame.
   */
  box?: OcrBox;
}

/**
 * The structured reading of one photo.
 *
 * `rawText` is present only while a capture is being processed. It is stripped
 * before anything is persisted (see `redactOcrResult`) because a photo of a
 * school screen can contain unrelated names, grades and schedules.
 */
export interface EdgenuityOcrResult {
  rawText?: string;
  /** Mean OCR character confidence, 0..100, as reported by the engine. */
  confidence?: number;

  detectedCourse?: string;
  detectedActivity?: string;
  detectedProgressPercent?: number;

  /** All plausible percentages, best first. Drives the ambiguity warning. */
  percentCandidates: PercentCandidate[];
  /** Which Edgenuity-ish signals were seen, e.g. `['edgenuity', 'progress']`. */
  edgenuitySignals: string[];
  /** 0..1 confidence that this is an Edgenuity-like screen at all. */
  screenScore: number;
  /** The region the chosen progress reading came from, when positions existed. */
  progressRegion?: OcrBox;
  parseConfidence: ParseConfidence;
  /** Set when the reading cannot be used, with a student-facing reason. */
  problem?: EdgenuityReadProblem;
}

export const EDGENUITY_READ_PROBLEMS = [
  'not_edgenuity',
  'no_percentage',
  'ambiguous_percentage',
  'unreadable',
] as const;
export type EdgenuityReadProblem = (typeof EDGENUITY_READ_PROBLEMS)[number];

/* ------------------------------------------------------------------ */
/* Screen evidence (Phase 5)                                           */
/* ------------------------------------------------------------------ */

/**
 * How strongly a photo looks like a real Edgenuity course page.
 *
 * Phase 4 answered this with a single boolean. Enhanced Proof needs a higher
 * bar than Standard, so the answer is now a score plus the signals that earned
 * it. Deliberately signal-based rather than layout-matching: districts rebrand
 * Edgenuity, and a stricter rule that only accepts one exact screenshot would
 * reject most real deployments.
 */
export interface ScreenEvidence {
  /** 0..1. */
  score: number;
  signals: string[];
  confidence: ParseConfidence;
}

/* ------------------------------------------------------------------ */
/* Challenges (Phase 5)                                                */
/* ------------------------------------------------------------------ */

export const CHALLENGE_TYPES = ['visual_code', 'qr_code'] as const;
export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

export const CHALLENGE_STATUSES = ['pending', 'verified', 'failed', 'expired'] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

/** Which half of a verification session a challenge belongs to. */
export type ChallengePhase = 'before' | 'after';

/**
 * A one-time code that must appear in the live photo.
 *
 * The point is narrow and worth stating plainly: a photo taken before the code
 * existed cannot contain it. That is the whole anti-replay value — it says
 * nothing about whether the screen in the photo is genuine.
 *
 * `sessionId` is null for a `before` challenge, because the session does not
 * exist until the starting proof is accepted; consuming the challenge binds it.
 */
export interface VerificationChallenge {
  id: string;
  assignmentId: string;
  sessionId: string | null;
  phase: ChallengePhase;
  type: ChallengeType;
  /** The code itself. Cleared once consumed — see `valueHash`. */
  value?: string;
  /**
   * Non-cryptographic digest of `value`, kept after consumption so a record can
   * still be tied to its challenge without holding the code. It is an audit
   * aid, not a security measure: the codes are short and public to the student
   * by design.
   */
  valueHash: string;
  createdAt: string;
  expiresAt: string;
  status: ChallengeStatus;
  /** When it was successfully consumed. A consumed challenge never counts twice. */
  usedAt?: string;
  /** Capture attempts made against it. Diagnostics only — never a lockout. */
  attempts: number;
}

/**
 * What OCR found when looking for a specific expected code.
 *
 * This is deliberately the *result of looking for one known value*, not "some
 * code we saw": the expected value is known before the photo is read, so there
 * is no reason to go hunting for arbitrary codes and then compare later.
 */
export interface ChallengeDetection {
  /** True when the expected code was matched confidently and unambiguously. */
  matched: boolean;
  /** The token that matched, normalised. Absent when nothing plausible was found. */
  matchedText?: string;
  /** 0..1 confidence in the match. */
  confidence: number;
  /** Several code-like tokens were equally plausible — refuse rather than pick. */
  ambiguous: boolean;
  /**
   * True when the code sat clear of the progress reading. A code found *inside*
   * the progress area is more likely to be misread page text than a written
   * card held beside the screen.
   */
  separated: boolean;
  /** Why it failed, for the retake message. */
  problem?: 'not_found' | 'ambiguous' | 'overlaps_progress' | 'low_confidence';
}

/* ------------------------------------------------------------------ */
/* Proofs and sessions                                                 */
/* ------------------------------------------------------------------ */

/** What survives from a photo once the image and raw text are discarded. */
export interface EdgenuityProof {
  capturedAt: string;
  progressPercent?: number;
  courseName?: string;
  activityName?: string;
  /** Engine confidence, 0..100. */
  confidence?: number;
  parseConfidence: ParseConfidence;
  /**
   * `live_camera` and `live_screen` are the values that may produce a verified
   * result — both are frames the browser handed back from a live MediaStream
   * this tab opened. `fixture` exists for automated tests and developer mode
   * and is refused by the verification policy.
   */
  source: 'live_camera' | 'live_screen' | 'fixture';

  /* --- Phase 5 --- */
  /** How convincingly this frame looked like an Edgenuity page. */
  screenEvidence?: ScreenEvidence;
  /** The challenge reading for this frame, when one was expected. */
  challenge?: ChallengeDetection;
  /** Id of the challenge this frame was checked against. */
  challengeId?: string;
  /** Trust this single frame earned. The session takes the weaker of the two. */
  trust?: VerificationTrust;
}

export const EDGENUITY_SESSION_STATUSES = [
  'in_progress',
  'verified',
  'expired',
  'cancelled',
] as const;
export type EdgenuitySessionStatus = (typeof EDGENUITY_SESSION_STATUSES)[number];

/**
 * One before/after verification attempt.
 *
 * A session pairs proofs so a Monday photo cannot be compared with a Friday
 * one. It expires after `expiresAt` (same-day by default) and a stale session
 * is never silently compared against.
 */
export interface EdgenuitySession {
  id: string;
  assignmentId: string;
  status: EdgenuitySessionStatus;
  startedAt: string;
  expiresAt: string;
  before: EdgenuityProof;
  /** Set once a final proof has been accepted. */
  after?: EdgenuityProof;
  /** Snapshot of the target at session start, so editing config mid-session is safe. */
  target: EdgenuityConfig;
  /** Focus minutes logged against the assignment when the session started. */
  focusMinutesAtStart: number;
  /**
   * Set when a reading was implausible (a huge jump, or a near-instant claim)
   * and a second confirming photo is required before it can count.
   */
  pendingConfirmation?: {
    reason: 'large_jump' | 'too_fast';
    /** The reading that triggered it, awaiting a second photo that agrees. */
    progressPercent?: number;
    at: string;
  };

  /* --- Phase 5 --- */
  /**
   * Trust required when this session started, snapshotted like `target` so
   * changing the setting mid-session cannot retroactively invalidate work.
   */
  requiredTrust: VerificationTrust;
  /** Challenge consumed by the starting proof, if any. */
  beforeChallengeId?: string;
  /** Challenge consumed by the accepted final proof, if any. */
  afterChallengeId?: string;
}

/** Root Edgenuity slice (schema v3; challenges added in v4). */
export interface EdgenuityState {
  /** Active and recently finished sessions. Capped; see MAX_EDGENUITY_SESSIONS. */
  sessions: EdgenuitySession[];
  /** Issued challenges, live and spent. Capped; see MAX_EDGENUITY_CHALLENGES. */
  challenges: VerificationChallenge[];
  /**
   * Opt-in developer diagnostics. When on, raw OCR text and a small thumbnail
   * may be kept for the *active* session only, and the fixture capture source
   * becomes selectable. It can never produce a verified result.
   */
  developerMode: boolean;
  /** Remembered so Settings can show camera state without re-prompting. */
  cameraPermission: 'unknown' | 'granted' | 'denied';
  /** True once the OCR engine has been initialised at least once. */
  ocrEverLoaded: boolean;
}

export function defaultEdgenuityState(): EdgenuityState {
  return {
    sessions: [],
    challenges: [],
    developerMode: false,
    cameraPermission: 'unknown',
    ocrEverLoaded: false,
  };
}

/** How long a starting proof stays comparable. Same study day, in practice. */
export const EDGENUITY_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Old sessions are pruned rather than kept forever. */
export const MAX_EDGENUITY_SESSIONS = 40;

/** Percentage jump beyond which a second confirming photo is required. */
export const EDGENUITY_LARGE_JUMP = 25;

/** Below this gap, a large claimed jump is treated as implausibly fast. */
export const EDGENUITY_MIN_GAP_MS = 3 * 60 * 1000;

/**
 * How long a challenge code stays usable.
 *
 * Short enough that a code cannot be written down today and photographed
 * tomorrow; long enough to find a pen, write four characters, and frame a
 * photo without being rushed. Retakes reuse the same code until it expires.
 */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Spent challenges are kept briefly for the audit trail, then pruned. */
export const MAX_EDGENUITY_CHALLENGES = 60;
