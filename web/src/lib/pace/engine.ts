/**
 * The Pace Engine — the one place that decides whether the student is ahead,
 * on track, at risk, behind, or whether LockIn simply does not know.
 *
 * ## Rules it exists to enforce
 *
 * 1. **A missing sync is not bad news.** If the data is stale, the answer is
 *    UNKNOWN with the stale source named — never BEHIND.
 * 2. **Nothing is overdue without a due date worth trusting.** A due date from
 *    a feed that has not answered in a week is not evidence that something is
 *    late; it is evidence that LockIn is out of date.
 * 3. **Disappearing is not completing.** Nothing here infers completion from
 *    absence; a record that stopped arriving is handled by the reconciler,
 *    which marks it, and never by this file.
 * 4. **The wording is part of the output.** Reasons come out as sentences so
 *    two screens cannot describe the same state differently.
 *
 * Pure: `now` is an input, nothing is read from the clock, nothing is
 * dispatched, nothing is stored. The same state at the same instant always
 * produces the same report.
 */
import type { AppState, Assignment } from '../../types';
import type {
  PaceAction,
  PaceReason,
  PaceReport,
  PaceStatus,
  StaleSource,
} from '../../types/pace';
import type { Confidence } from '../../types/source';
import { SOURCE_LABEL, classify, relativeAge, trustworthyForJudgment } from '../sources/freshness';
import { dueTimestamp, isComplete, sortByDue } from '../selectors';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The window "due soon" means everywhere in LockIn. One definition only. */
export const DUE_SOON_MS = 48 * HOUR;

export interface PaceInput {
  state: AppState;
  now: number;
}

/**
 * Whether an assignment's due date can carry a judgment.
 *
 * MANUAL counts: the student typed the date themselves, so calling it late is
 * repeating their own claim back to them, not asserting something LockIn
 * cannot know. A synced source counts while it is fresh. A stale one does not,
 * and that is rule 2.
 */
export function dueDateTrustworthy(assignment: Assignment, now: number): boolean {
  const source = assignment.source;
  if (!source) return true; // pre-v9 records; the student created them by hand
  if (source.kind === 'MANUAL') return true;
  return trustworthyForJudgment(source, now);
}

/** Assignments genuinely late, by a due date worth trusting. */
export function trustedOverdue(state: AppState, now: number): Assignment[] {
  return sortByDue(
    state.assignments.filter(
      (a) => !isComplete(a) && dueTimestamp(a) < now && dueDateTrustworthy(a, now),
    ),
  );
}

/** Unfinished work due inside the next 48 hours. */
export function dueSoonUnfinished(state: AppState, now: number): Assignment[] {
  return sortByDue(
    state.assignments.filter((a) => {
      if (isComplete(a)) return false;
      const due = dueTimestamp(a);
      return due >= now && due - now <= DUE_SOON_MS;
    }),
  );
}

/** Work due inside 48 hours that is already finished. */
function dueSoonComplete(state: AppState, now: number): Assignment[] {
  return state.assignments.filter((a) => {
    if (!isComplete(a)) return false;
    const due = dueTimestamp(a);
    return due >= now - DAY && due - now <= DUE_SOON_MS;
  });
}

/** Minutes of work left on an assignment, floored at zero. */
export function remainingMinutes(a: Assignment): number {
  return Math.max(0, (a.estimatedMinutes || 0) - (a.loggedMinutes || 0));
}

/** Every source in play, with the ones that cannot be believed picked out. */
export function staleSources(state: AppState, now: number): StaleSource[] {
  const seen = new Map<string, StaleSource>();

  const consider = (record: Parameters<typeof classify>[0]) => {
    if (!record || record.kind === 'MANUAL') return;
    const freshness = classify(record, now);
    if (freshness.state !== 'STALE' && freshness.state !== 'UNAVAILABLE') return;
    // One entry per source kind: five stale assignments from one feed is one
    // problem, and listing it five times reads as five.
    if (seen.has(record.kind)) return;
    seen.set(record.kind, {
      kind: record.kind,
      label: SOURCE_LABEL[record.kind],
      age: freshness.ageMs === null ? 'never' : relativeAge(freshness.ageMs),
    });
  };

  for (const assignment of state.assignments) {
    if (!isComplete(assignment)) consider(assignment.source);
  }

  return [...seen.values()];
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

/**
 * The order of these checks *is* the policy, so it is written out rather than
 * buried in nested conditionals:
 *
 *   1. Nothing to judge at all   → UNKNOWN (no data)
 *   2. Something genuinely late  → BEHIND
 *   3. More due in 24h than fits → AT_RISK
 *   4. Nothing due soon, and
 *      recent work finished      → AHEAD
 *   5. Otherwise                 → ON_TRACK
 *
 * Every branch that reaches a verdict on stale inputs is intercepted first by
 * the stale check, which downgrades to UNKNOWN instead.
 */
export function computePace({ state, now }: PaceInput): PaceReport {
  const reasons: PaceReason[] = [];
  const stale = staleSources(state, now);

  const overdue = trustedOverdue(state, now);
  const soon = dueSoonUnfinished(state, now);
  const done = dueSoonComplete(state, now);
  const nothingKnown = state.assignments.filter((a) => !isComplete(a)).length === 0;

  /* --- 1. nothing to judge --- */
  if (nothingKnown) {
    if (state.assignments.length === 0) {
      return {
        status: 'UNKNOWN',
        confidence: 'low',
        reasons: [
          {
            code: 'no_data',
            tone: 'neutral',
            text: 'Nothing to go on yet — add work or connect Canvas.',
          },
        ],
        staleSources: stale,
        suggestedAction: { kind: 'connect', text: 'Connect your school tools' },
      };
    }
    reasons.push({ code: 'nothing_due', tone: 'good', text: 'Nothing is outstanding right now.' });
    if (done.length > 0) {
      // Work due in the next two days is already finished. That is what being
      // ahead is, and calling it merely "on track" undersells a real thing the
      // student did.
      reasons.push({
        code: 'due_soon_complete',
        tone: 'good',
        text: 'Everything due in the next two days is finished.',
      });
    }
    return {
      status: done.length > 0 ? 'AHEAD' : 'ON_TRACK',
      confidence: confidenceFrom(state, stale.length),
      reasons,
      staleSources: stale,
      suggestedAction: { kind: 'none', text: 'Nothing needs doing right now.' },
    };
  }

  /* --- the stale gate --- */
  // Everything the student has is from a source that stopped answering. Any
  // verdict here would be a verdict about old data presented as a verdict
  // about them.
  if (allEvidenceStale(state, now)) {
    return {
      status: 'UNKNOWN',
      confidence: 'low',
      reasons: [
        {
          code: 'stale_data',
          tone: 'warn',
          text:
            stale.length === 1
              ? `${stale[0].label} data was last updated ${stale[0].age}.`
              : 'Your school data is out of date, so this is not a fair read.',
        },
      ],
      staleSources: stale,
      suggestedAction: { kind: 'sync', text: 'Sync before judging your pace' },
    };
  }


  /* --- 2. genuinely late --- */
  if (overdue.length > 0) {
    reasons.push({
      code: 'overdue_work',
      tone: 'warn',
      text:
        overdue.length === 1
          ? `“${overdue[0].title}” is past its due date.`
          : `${overdue.length} assignments are past their due date.`,
    });
    return {
      status: 'BEHIND',
      confidence: confidenceFrom(state, stale.length),
      reasons,
      staleSources: stale,
      suggestedAction: startAction(overdue[0], 'Start with the oldest one'),
    };
  }


  /* --- 4. the next day does not fit --- */
  const next24 = soon.filter((a) => dueTimestamp(a) - now <= DAY);
  const minutesNeeded = next24.reduce((sum, a) => sum + remainingMinutes(a), 0);
  const hoursLeft = next24.length > 0 ? (dueTimestamp(next24[0]) - now) / HOUR : Infinity;
  // Two thirds of the remaining hours is the most anyone plans to spend, and
  // treating every waking hour as available is how a planner starts lying.
  const tight = minutesNeeded > Math.max(0, hoursLeft) * 60 * 0.66;

  if (next24.length > 0 && tight) {
    reasons.push({
      code: 'capacity_tight',
      tone: 'warn',
      text: `About ${Math.round(minutesNeeded)} minutes of work is due in the next day.`,
    });
    return {
      status: 'AT_RISK',
      confidence: confidenceFrom(state, stale.length),
      reasons,
      staleSources: stale,
      suggestedAction: startAction(next24[0], 'Start the one due soonest'),
    };
  }


  /* --- 6 and 7 --- */
  if (soon.length === 0) {
    reasons.push({
      code: 'due_soon_complete',
      tone: 'good',
      text:
        done.length > 0
          ? 'Everything due in the next two days is finished.'
          : 'Nothing is due in the next two days.',
    });
  } else {
    reasons.push({
      code: 'due_soon_remaining',
      tone: 'neutral',
      text:
        soon.length === 1
          ? '1 assignment is due in the next two days.'
          : `${soon.length} assignments are due in the next two days.`,
    });
  }
  if (overdue.length === 0 && state.assignments.length > 0) {
    reasons.push({ code: 'nothing_due', tone: 'good', text: 'Nothing is overdue.' });
  }

  const ahead = soon.length === 0 && done.length > 0;
  return {
    status: ahead ? 'AHEAD' : 'ON_TRACK',
    confidence: confidenceFrom(state, stale.length),
    reasons,
    staleSources: stale,
    suggestedAction: soon[0]
      ? startAction(soon[0], 'Next up')
      : { kind: 'none', text: 'Nothing needs doing right now.' },
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function startAction(assignment: Assignment, text: string): PaceAction {
  return { kind: 'start_focus', text, assignmentId: assignment.id };
}


/**
 * True when every piece of evidence in play is stale.
 *
 * Deliberately "every", not "any": one stale feed alongside a fresh one is a
 * partial view, which the report names in `staleSources` while still answering
 * the question. Refusing to answer whenever anything at all is stale would
 * make UNKNOWN the permanent state of a real student's account.
 */
function allEvidenceStale(state: AppState, now: number): boolean {
  const openWork = state.assignments.filter((a) => !isComplete(a));
  if (openWork.length === 0) return false;
  return !openWork.some((a) => dueDateTrustworthy(a, now));
}

/**
 * How sure the report is.
 *
 * Low whenever anything is stale, or when the only inputs are hand-typed —
 * not because typed work is wrong, but because LockIn has no way to check it,
 * and a confident-sounding verdict built on unverifiable input is exactly the
 * thing this engine is supposed to avoid.
 */
function confidenceFrom(state: AppState, staleCount: number): Confidence {
  if (staleCount > 0) return 'low';

  const open = state.assignments.filter((a) => !isComplete(a));
  // Measured across *all* assignments, not just open ones: the question is
  // whether LockIn has real connections feeding it, and a week where
  // everything synced is already finished is the best case, not the least
  // certain one.
  const external = state.assignments.filter((a) => a.source && a.source.kind !== 'MANUAL');

  // Hand-typed work is not wrong, but LockIn has no way to check it, and a
  // confident verdict built on unverifiable input is what this engine exists
  // to avoid.
  if (external.length === 0) return open.length === 0 ? 'medium' : 'low';
  return external.length >= open.length ? 'high' : 'medium';
}

/** Short label for a status, used by badges and notification titles. */
export const PACE_LABEL: Record<PaceStatus, string> = {
  AHEAD: 'Ahead',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  BEHIND: 'Behind',
  UNKNOWN: 'Not enough data',
};

/**
 * The one-line summary under the greeting.
 *
 * Behind never reads as a verdict on the student — it names the work and the
 * way out, because the documented failure mode of these tools is reactance,
 * and guilt is the fastest route to it.
 */
export function paceHeadline(report: PaceReport): string {
  switch (report.status) {
    case 'AHEAD':
      return 'You’re ahead.';
    case 'ON_TRACK':
      return 'You’re on track.';
    case 'AT_RISK':
      return 'Tight, but doable.';
    case 'BEHIND':
      return 'A little behind — here’s the way back.';
    default:
      return 'Not enough to go on yet.';
  }
}
