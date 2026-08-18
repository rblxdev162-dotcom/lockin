/**
 * Parent accountability models (Phase 6).
 *
 * The shape of this file is a product decision as much as a technical one.
 * A parent gets to see *work and verification events* — what was required,
 * what was verified, how strongly, and when Focus Mode was cut short. There is
 * deliberately nothing here that could carry browsing history, screenshots,
 * photos, keystrokes or location, because those are the things that would turn
 * accountability into surveillance.
 *
 * Note what is *not* here: the minimum Edgenuity proof strength. That already
 * exists as `settings.edgenuityProofMode` (Phase 5) and the Parent Dashboard
 * edits it directly rather than keeping a second copy that could disagree.
 */

/* ------------------------------------------------------------------ */
/* Parent controls                                                     */
/* ------------------------------------------------------------------ */

/**
 * The switches a parent owns.
 *
 * All three are about *accountability and restriction strength*. None of them
 * touch ordinary studying: adding an assignment, starting a timer, editing a
 * title or opening Canvas stay entirely the student's to do, PIN or no PIN.
 */
export interface ParentControls {
  /**
   * Verification-strength settings need the PIN to change.
   * Covers the global Edgenuity proof mode and any per-assignment requirement.
   */
  lockVerificationSettings: boolean;
  /**
   * While Strict Focus Mode is running, removing a blocked site needs the PIN.
   * Adding one never does — tightening your own restrictions is always allowed.
   */
  protectBlocklistInStrictMode: boolean;
  /**
   * While Strict Focus Mode is running, changing the school allowlist needs the
   * PIN. Widening the allowlist is how a student would carve an escape route
   * out of an active session.
   */
  protectAllowlistInStrictMode: boolean;
}

export function defaultParentControls(): ParentControls {
  return {
    lockVerificationSettings: false,
    protectBlocklistInStrictMode: false,
    protectAllowlistInStrictMode: false,
  };
}

/** Settings a locked device refuses to change without the PIN. */
export const PROTECTED_SETTING_KEYS = ['edgenuityProofMode'] as const;
export type ProtectedSettingKey = (typeof PROTECTED_SETTING_KEYS)[number];

/* ------------------------------------------------------------------ */
/* Focus Mode history                                                  */
/* ------------------------------------------------------------------ */

/**
 * How a Focus Mode run ended.
 *
 * `completed` is the only outcome that means the required work was actually
 * finished. The rest are recorded plainly and without judgement — an emergency
 * exit is a feature, not an accusation.
 */
export const FOCUS_RUN_OUTCOMES = [
  'active',
  'completed',
  'ended',
  'override',
  'emergency',
  'test_expired',
] as const;
export type FocusRunOutcome = (typeof FOCUS_RUN_OUTCOMES)[number];

/** A temporary unlock granted during a run. */
export interface FocusRunUnlock {
  minutes: number;
  startedAt: string;
  endedAt?: string;
  /** True when a parent granted it from the dashboard rather than the app. */
  byParent: boolean;
}

/**
 * One Focus Mode session, recorded as it happens.
 *
 * Built in the reducer rather than reconstructed later from log messages: the
 * Activity Log is prose meant for humans, and parsing it back into numbers
 * would break the first time someone reworded a sentence.
 */
export interface FocusRun {
  id: string;
  startedAt: string;
  endedAt?: string;
  requiredTaskIds: string[];
  requiredCount: number;
  /** Required tasks finished by the time the run ended. */
  completedCount: number;
  outcome: FocusRunOutcome;
  /** The reason typed into the emergency exit, when there was one. */
  note?: string;
  /** Started by the Settings blocking test rather than by real work. */
  isTest: boolean;
  unlocks: FocusRunUnlock[];
  /**
   * Blocked-attempt counts *for this run*, per domain.
   *
   * The extension only reports running totals, so a snapshot is taken at the
   * start and subtracted at the end. Counts only — LockIn has never recorded
   * which pages were visited, and this does not change that.
   */
  blocked: { domain: string; count: number }[];
  /** Cumulative totals when the run started, used to compute `blocked`. */
  blockBaseline: { domain: string; count: number }[];
  /**
   * Focus Guard: how often the student left this tab during the run, and for
   * how long in total (Phase 9).
   *
   * Two numbers, and deliberately only two. The Page Visibility API cannot
   * report where someone went, so LockIn cannot either — a parent sees "left
   * four times, eleven minutes" and never sees a destination, because none was
   * ever collected. Runs recorded before Focus Guard existed carry 0.
   */
  awayCount: number;
  awayMs: number;
}

/** Runs are kept for review, not forever. */
export const MAX_FOCUS_RUNS = 120;

/* ------------------------------------------------------------------ */
/* Parent session (never persisted)                                    */
/* ------------------------------------------------------------------ */

/**
 * An unlocked Parent Dashboard.
 *
 * Held in React state only — never in `localStorage`, never in the reducer.
 * That is what makes "reload, or restart the browser, and the PIN is required
 * again" true by construction rather than by remembering to clear something.
 */
export interface ParentSession {
  authenticatedAt: number;
  lastActivityAt: number;
  expiresAt: number;
}

/** Idle timeout for an unlocked dashboard. */
export const PARENT_SESSION_TTL_MS = 12 * 60 * 1000;

export function createParentSession(now = Date.now()): ParentSession {
  return { authenticatedAt: now, lastActivityAt: now, expiresAt: now + PARENT_SESSION_TTL_MS };
}

/** Any interaction pushes the expiry out; idleness still ends the session. */
export function touchParentSession(session: ParentSession, now = Date.now()): ParentSession {
  return { ...session, lastActivityAt: now, expiresAt: now + PARENT_SESSION_TTL_MS };
}

export function isParentSessionValid(session: ParentSession | null, now = Date.now()): boolean {
  return !!session && session.expiresAt > now;
}
