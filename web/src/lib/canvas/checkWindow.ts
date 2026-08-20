/**
 * When LockIn is allowed to touch Canvas at all.
 *
 * ## Why this file exists
 *
 * The student takes proctored tests at school on a district Chromebook while
 * this app sits running at home. Nobody wants to have to explain why their
 * home computer was talking to the school's Canvas during a locked-down
 * assessment — however innocent the traffic actually is. So LockIn's rule is
 * not "be careful", it is **structural**: one function decides, every Canvas
 * path asks it first, and when it says no, *zero* Canvas activity happens.
 *
 * Two separate things are being controlled, and conflating them is what makes
 * this kind of feature creep back into automatic polling:
 *
 *  1. **Who started it.** `manual` mode means nothing at all happens unless
 *    the student pressed a button. This is the default, and the automatic
 *    calendar refresh is switched off with it.
 *  2. **When.** Even a student-initiated check is refused during configured
 *    school hours, because that is the window the worry is actually about.
 *
 * ## Deliberately not trapping the student
 *
 * A refusal during school hours can be overridden by a second, explicit press
 * ("I'm not at school right now"). Refusing outright would be LockIn deciding
 * it knows the student's timetable better than they do — and every override is
 * written to the activity log, which is the thing that makes the guarantee
 * checkable rather than merely claimed.
 *
 * Pure. `now` is an input, no clock reads, so the extension mirror and the
 * tests can agree exactly. Mirrored by `extension/canvas/checkWindow.js`;
 * `extension/tests/canvas-grades.test.mjs` runs both over the same matrix and
 * fails if they ever disagree.
 */

/** What kind of Canvas activity is being asked about. */
export const CANVAS_CHECK_REASONS = [
  /** The student pressed Check Canvas. */
  'manual',
  /** The student pressed Check Canvas again, knowing it was refused. */
  'override',
  /** The passive page reader wants to report a page the student opened. */
  'passive',
  /** The calendar feed's timer wants to fetch. */
  'automatic',
] as const;
export type CanvasCheckReason = (typeof CANVAS_CHECK_REASONS)[number];

export const CANVAS_GATE_VERDICTS = [
  'allowed',
  'paused',
  'school_hours',
  'outside_window',
  'automatic_disabled',
  'passive_disabled',
  'not_connected',
] as const;
export type CanvasGateVerdict = (typeof CANVAS_GATE_VERDICTS)[number];

export interface CanvasCheckWindow {
  /**
   * `manual` — LockIn reads Canvas only when the student presses the button.
   * `scheduled` — the calendar feed may also refresh itself inside the window.
   *
   * Ships as `manual`. Automatic polling of a school system is the part of
   * this feature that nobody has explicitly authorised, so it is off until the
   * student decides otherwise.
   */
  mode: 'manual' | 'scheduled';
  /** Days school is in session. 0 = Sunday. */
  schoolDays: number[];
  /** Minutes past midnight. Nothing happens before this on a school day. */
  schoolDayStart: number;
  /** Minutes past midnight. Nothing happens after this, any day. */
  dayEnd: number;
  /** Minutes past midnight, non-school days. */
  freeDayStart: number;
  /** Epoch ms. Everything is refused until then. */
  pausedUntil: number | null;
  /**
   * Whether Canvas pages the student browses are read as they go.
   *
   * Off by default. It makes no network request either way — it reads a page
   * that is already on screen — but "only when I press the button" should be
   * literally true out of the box, not almost true.
   */
  readAsIBrowse: boolean;
}

/** 3:30pm–9:30pm on school days, 9am–9:30pm otherwise, manual only. */
export function defaultCheckWindow(): CanvasCheckWindow {
  return {
    mode: 'manual',
    schoolDays: [1, 2, 3, 4, 5],
    schoolDayStart: 15 * 60 + 30,
    dayEnd: 21 * 60 + 30,
    freeDayStart: 9 * 60,
    pausedUntil: null,
    readAsIBrowse: false,
  };
}

const MINUTES_IN_DAY = 24 * 60;

function clampMinutes(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= MINUTES_IN_DAY ? n : fallback;
}

/** Rebuilds a stored window field by field. Unknown shapes fall back to the default. */
export function normalizeCheckWindow(raw: unknown): CanvasCheckWindow {
  const base = defaultCheckWindow();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<CanvasCheckWindow>;

  const days = Array.isArray(value.schoolDays)
    ? [...new Set(value.schoolDays.map((d) => Math.round(Number(d))))]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b)
    : base.schoolDays;

  const pausedUntil =
    typeof value.pausedUntil === 'number' && Number.isFinite(value.pausedUntil)
      ? value.pausedUntil
      : null;

  return {
    mode: value.mode === 'scheduled' ? 'scheduled' : 'manual',
    schoolDays: days,
    schoolDayStart: clampMinutes(value.schoolDayStart, base.schoolDayStart),
    dayEnd: clampMinutes(value.dayEnd, base.dayEnd),
    freeDayStart: clampMinutes(value.freeDayStart, base.freeDayStart),
    pausedUntil,
    readAsIBrowse: value.readAsIBrowse === true,
  };
}

/** Minutes past local midnight for a timestamp. */
function minutesOfDay(now: number): number {
  const date = new Date(now);
  return date.getHours() * 60 + date.getMinutes();
}

/** The first minute of today on which checks are allowed. */
export function windowStartFor(window: CanvasCheckWindow, now: number): number {
  const isSchoolDay = window.schoolDays.includes(new Date(now).getDay());
  return isSchoolDay ? window.schoolDayStart : window.freeDayStart;
}

export interface GateDecision {
  allowed: boolean;
  verdict: CanvasGateVerdict;
  /**
   * True when a second, explicit press would be allowed through. Only ever set
   * for a time-of-day refusal — a paused or unconfigured LockIn is not
   * something to click past.
   */
  overridable: boolean;
  /** Epoch ms when this would next be allowed on its own, when knowable. */
  nextAllowedAt: number | null;
}

/**
 * The one decision. Every Canvas path in either half of the app calls this.
 *
 * Order matters and is deliberate: connection, then pause, then who started
 * it, then the clock. The student should be told the *first* reason nothing
 * happened, not the last one checked.
 */
export function evaluateCheckWindow(
  window: CanvasCheckWindow,
  reason: CanvasCheckReason,
  now: number,
  options: { connected?: boolean } = {},
): GateDecision {
  const refuse = (verdict: CanvasGateVerdict, overridable = false): GateDecision => ({
    allowed: false,
    verdict,
    overridable,
    nextAllowedAt: nextAllowedAfter(window, now),
  });

  if (options.connected === false) return refuse('not_connected');

  if (typeof window.pausedUntil === 'number' && window.pausedUntil > now) {
    return { allowed: false, verdict: 'paused', overridable: false, nextAllowedAt: window.pausedUntil };
  }

  if (reason === 'automatic' && window.mode !== 'scheduled') {
    return { allowed: false, verdict: 'automatic_disabled', overridable: false, nextAllowedAt: null };
  }
  if (reason === 'passive' && !window.readAsIBrowse) {
    return { allowed: false, verdict: 'passive_disabled', overridable: false, nextAllowedAt: null };
  }

  const minutes = minutesOfDay(now);
  const start = windowStartFor(window, now);
  const inside = minutes >= start && minutes < window.dayEnd;

  if (inside) {
    return { allowed: true, verdict: 'allowed', overridable: false, nextAllowedAt: null };
  }

  // An explicit second press is the student saying "I am not at school". It is
  // allowed, and logged as an override so the record stays honest.
  if (reason === 'override') {
    return { allowed: true, verdict: 'allowed', overridable: false, nextAllowedAt: null };
  }

  // Before the school day ends is the case the whole feature exists for, and
  // it reads differently in the UI from "it's 11pm".
  const beforeStart = minutes < start;
  const schoolDay = window.schoolDays.includes(new Date(now).getDay());
  const verdict: CanvasGateVerdict = beforeStart && schoolDay ? 'school_hours' : 'outside_window';
  return refuse(verdict, reason === 'manual');
}

/** When the window next opens, as an epoch ms. Used for "next check after…" copy. */
export function nextAllowedAfter(window: CanvasCheckWindow, now: number): number | null {
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    day.setSeconds(0, 0);
    const start = window.schoolDays.includes(day.getDay())
      ? window.schoolDayStart
      : window.freeDayStart;
    day.setHours(Math.floor(start / 60), start % 60);
    const candidate = day.getTime();
    if (candidate > now) return candidate;
  }
  return null;
}

/** One short sentence for the UI. Never claims more than the gate enforces. */
export function gateExplanation(decision: GateDecision, window: CanvasCheckWindow): string {
  switch (decision.verdict) {
    case 'allowed':
      return 'LockIn can read Canvas now.';
    case 'paused':
      return 'Canvas checks are paused.';
    case 'school_hours':
      return `Automatic Canvas checks are disabled during your configured school hours (until ${formatMinutes(
        window.schoolDayStart,
      )}).`;
    case 'outside_window':
      return `Canvas checks are set to run between ${formatMinutes(
        windowStartFor(window, Date.now()),
      )} and ${formatMinutes(window.dayEnd)}.`;
    case 'automatic_disabled':
      return 'Automatic Canvas checks are off. LockIn reads Canvas only when you press Check Canvas.';
    case 'passive_disabled':
      return 'LockIn reads Canvas only when you press Check Canvas.';
    case 'not_connected':
      return 'Canvas is not connected yet.';
  }
}

export function formatMinutes(minutes: number): string {
  const hours24 = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, '0')} ${suffix}`;
}
