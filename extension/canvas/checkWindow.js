/**
 * When LockIn is allowed to touch Canvas at all — extension mirror.
 *
 * Hand-synced with `web/src/lib/canvas/checkWindow.ts`. The reasoning lives
 * there; this is the copy the background worker can import without a build
 * step. `extension/tests/canvas-grades.test.mjs` runs both over the same
 * matrix of windows, reasons and clock times and fails if they ever disagree,
 * so the mirror cannot silently drift.
 *
 * Pure: no clock reads, no Chrome APIs, no storage.
 */

export const CANVAS_CHECK_REASONS = ['manual', 'override', 'passive', 'automatic'];

export const CANVAS_GATE_VERDICTS = [
  'allowed',
  'paused',
  'school_hours',
  'outside_window',
  'automatic_disabled',
  'passive_disabled',
  'not_connected',
];

/** 3:30pm–9:30pm on school days, 9am–9:30pm otherwise, manual only. */
export function defaultCheckWindow() {
  return {
    mode: 'manual',
    schoolDays: [1, 2, 3, 4, 5],
    schoolDayFrom: 7 * 60 + 30,
    schoolDayStart: 15 * 60 + 30,
    dayEnd: 21 * 60 + 30,
    freeDayStart: 9 * 60,
    pausedUntil: null,
    readAsIBrowse: false,
  };
}

const MINUTES_IN_DAY = 24 * 60;

function clampMinutes(value, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= MINUTES_IN_DAY ? n : fallback;
}

export function normalizeCheckWindow(raw) {
  const base = defaultCheckWindow();
  if (!raw || typeof raw !== 'object') return base;

  const days = Array.isArray(raw.schoolDays)
    ? [...new Set(raw.schoolDays.map((d) => Math.round(Number(d))))]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b)
    : base.schoolDays;

  const pausedUntil =
    typeof raw.pausedUntil === 'number' && Number.isFinite(raw.pausedUntil) ? raw.pausedUntil : null;

  return {
    mode: raw.mode === 'scheduled' ? 'scheduled' : 'manual',
    schoolDays: days,
    schoolDayFrom: clampMinutes(raw.schoolDayFrom, base.schoolDayFrom),
    schoolDayStart: clampMinutes(raw.schoolDayStart, base.schoolDayStart),
    dayEnd: clampMinutes(raw.dayEnd, base.dayEnd),
    freeDayStart: clampMinutes(raw.freeDayStart, base.freeDayStart),
    pausedUntil,
    readAsIBrowse: raw.readAsIBrowse === true,
  };
}

function minutesOfDay(now) {
  const date = new Date(now);
  return date.getHours() * 60 + date.getMinutes();
}

export function windowStartFor(window, now) {
  const isSchoolDay = window.schoolDays.includes(new Date(now).getDay());
  return isSchoolDay ? window.schoolDayStart : window.freeDayStart;
}

export function nextAllowedAfter(window, now) {
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

/**
 * The one decision. Every Canvas path in the extension calls this.
 * Order: connection, pause, who started it, then the clock.
 */
export function evaluateCheckWindow(window, reason, now, options = {}) {
  const refuse = (verdict, overridable = false) => ({
    allowed: false,
    verdict,
    overridable,
    nextAllowedAt: nextAllowedAfter(window, now),
  });

  if (options.connected === false) return refuse('not_connected');

  if (typeof window.pausedUntil === 'number' && window.pausedUntil > now) {
    return {
      allowed: false,
      verdict: 'paused',
      overridable: false,
      nextAllowedAt: window.pausedUntil,
    };
  }

  if (reason === 'automatic' && window.mode !== 'scheduled') {
    return {
      allowed: false,
      verdict: 'automatic_disabled',
      overridable: false,
      nextAllowedAt: null,
    };
  }
  if (reason === 'passive' && !window.readAsIBrowse) {
    return { allowed: false, verdict: 'passive_disabled', overridable: false, nextAllowedAt: null };
  }

  const minutes = minutesOfDay(now);
  const start = windowStartFor(window, now);
  const schoolDay = window.schoolDays.includes(new Date(now).getDay());
  // School hours are an interval, not "everything before the after-school
  // time" — 1am is not school, and neither is 10pm.
  const duringSchool = schoolDay && minutes >= window.schoolDayFrom && minutes < start;

  // `dayEnd` bounds the timer only — a press at 10pm is a student at their own
  // desk, and refusing it protects nobody. See the web copy for the reasoning.
  if (reason === 'automatic') {
    return minutes >= start && minutes < window.dayEnd
      ? { allowed: true, verdict: 'allowed', overridable: false, nextAllowedAt: null }
      : refuse(duringSchool ? 'school_hours' : 'outside_window');
  }

  if (!duringSchool) {
    return { allowed: true, verdict: 'allowed', overridable: false, nextAllowedAt: null };
  }

  if (reason === 'override') {
    return { allowed: true, verdict: 'allowed', overridable: false, nextAllowedAt: null };
  }

  return refuse('school_hours', reason === 'manual');
}
