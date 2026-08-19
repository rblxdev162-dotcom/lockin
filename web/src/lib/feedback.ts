/**
 * Noticing when things go well, without becoming a cheerleader.
 *
 * ## The failure mode this is designed against
 *
 * Praise that arrives for everything is noise, and noise that congratulates
 * you is worse than noise that doesn't — it teaches you the app is not paying
 * attention. So every line here has three properties:
 *
 *  1. **It is a fact.** "Everything due tomorrow is handled" is checked before
 *     it is said. Nothing here is a generic affirmation.
 *  2. **It is earned.** Trivial actions get nothing. Finishing one assignment
 *     is not an achievement; finishing everything due tomorrow is.
 *  3. **It is rationed.** One piece of feedback per cooldown, and the same
 *     line never repeats within its own window.
 *
 * No motivational quotes, no streak counters, no emoji. The Phase 9 research
 * is explicit that invented scores invite arguing about the score.
 */
import type { AppState } from '../types';
import type { PaceReport } from '../types/pace';
import { dueTimestamp, isComplete } from './selectors';

export const FEEDBACK_KINDS = [
  'week_ahead',
  'tomorrow_clear',
  'moved_to_on_track',
  'no_overdue_streak',
  'finished_early',
  'already_working',
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface Feedback {
  kind: FeedbackKind;
  text: string;
}

/**
 * How long each kind stays quiet after being shown.
 *
 * Different lines deserve different rationing: "you're ahead for the week" is
 * a weekly observation and saying it daily would drain it, while "you're
 * already working, I'll stay out of the way" is about right now and can
 * legitimately recur the same day.
 */
export const FEEDBACK_COOLDOWN_MS: Record<FeedbackKind, number> = {
  week_ahead: 5 * 24 * 3600_000,
  tomorrow_clear: 20 * 3600_000,
  moved_to_on_track: 24 * 3600_000,
  no_overdue_streak: 3 * 24 * 3600_000,
  finished_early: 12 * 3600_000,
  already_working: 2 * 3600_000,
};

/** What the caller remembers between visits: kind → epoch ms last shown. */
export type FeedbackHistory = Partial<Record<FeedbackKind, number>>;

const DAY = 86_400_000;

export interface FeedbackInput {
  state: AppState;
  report: PaceReport;
  now: number;
  history: FeedbackHistory;
  /** True when the companion says the student is working right now. */
  working?: boolean;
}

/**
 * The one thing worth saying, or nothing at all.
 *
 * Returns a single item rather than a list, deliberately: two pieces of praise
 * at once is a wall of congratulation, and the second one always undercuts the
 * first. Candidates are ordered by how much they mean, and the first one that
 * is both true and off cooldown wins.
 */
export function chooseFeedback(input: FeedbackInput): Feedback | null {
  const { state, report, now, history } = input;

  for (const candidate of candidates(input)) {
    const last = history[candidate.kind] ?? 0;
    if (now - last < FEEDBACK_COOLDOWN_MS[candidate.kind]) continue;
    return candidate;
  }

  // Nothing to say is the common case and a perfectly good outcome.
  void state;
  void report;
  return null;
}

function candidates(input: FeedbackInput): Feedback[] {
  const { state, report, now, working } = input;
  const out: Feedback[] = [];

  const open = state.assignments.filter((a) => !isComplete(a));
  const dueTomorrow = open.filter((a) => {
    const due = dueTimestamp(a);
    return Number.isFinite(due) && due !== Number.MAX_SAFE_INTEGER && due <= now + 36 * 3600_000;
  });
  const overdue = open.filter((a) => dueTimestamp(a) < now);

  // Strongest first.
  if (report.status === 'AHEAD' && overdue.length === 0) {
    out.push({ kind: 'week_ahead', text: 'You’re ahead for the week.' });
  }

  const aheadCourse = report.reasons.find((r) => r.code === 'course_ahead');
  if (aheadCourse && report.status !== 'BEHIND') {
    out.push({ kind: 'moved_to_on_track', text: aheadCourse.text });
  }

  if (dueTomorrow.length === 0 && overdue.length === 0 && state.assignments.length > 0) {
    out.push({ kind: 'tomorrow_clear', text: 'Everything due tomorrow is handled.' });
  }

  const days = daysWithoutOverdue(state, now);
  if (days >= 3 && overdue.length === 0) {
    out.push({
      kind: 'no_overdue_streak',
      text: `${days} days in a row with nothing overdue.`,
    });
  }

  const early = recentlyFinishedEarly(state, now);
  if (early) {
    out.push({ kind: 'finished_early', text: `You finished “${early}” ahead of its due date.` });
  }

  if (working) {
    out.push({
      kind: 'already_working',
      text: 'You’re already working on it, so I’ll stay out of the way.',
    });
  }

  return out;
}

/**
 * How many consecutive days end with nothing overdue.
 *
 * Capped at a week: "12 days" invites treating it as a streak to protect,
 * which is the loss-aversion mechanic Phase 9 deliberately did not build.
 */
export function daysWithoutOverdue(state: AppState, now: number): number {
  let days = 0;
  for (let back = 0; back < 7; back += 1) {
    const at = now - back * DAY;
    const overdueThen = state.assignments.some((a) => {
      const due = dueTimestamp(a);
      if (!Number.isFinite(due) || due === Number.MAX_SAFE_INTEGER) return false;
      if (due > at) return false;
      const completedAt = a.completedAt ? Date.parse(a.completedAt) : null;
      // It counts as overdue on that day if it was not finished by then.
      return completedAt === null || completedAt > at;
    });
    if (overdueThen) break;
    days += 1;
  }
  return days;
}

/** The title of something finished comfortably before it was due, if any. */
function recentlyFinishedEarly(state: AppState, now: number): string | null {
  for (const assignment of state.assignments) {
    if (!isComplete(assignment) || !assignment.completedAt) continue;
    const completedAt = Date.parse(assignment.completedAt);
    if (Number.isNaN(completedAt) || now - completedAt > DAY) continue;
    const due = dueTimestamp(assignment);
    if (!Number.isFinite(due) || due === Number.MAX_SAFE_INTEGER) continue;
    // A full day early is worth remarking on; an hour early is just finishing.
    if (due - completedAt >= DAY) return assignment.title;
  }
  return null;
}
