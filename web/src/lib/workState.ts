/**
 * What state a piece of work is actually in, and how urgent it is.
 *
 * ## Why this is one file
 *
 * "Done" turned out to mean four different things, and the app was flattening
 * them into a tick box:
 *
 *  - **Graded** — Canvas has marked it. Genuinely finished, nothing to do.
 *  - **Submitted** — handed in, not marked yet. Also nothing to do, but a
 *    different fact, and the one a student checks when they are worried.
 *  - **Done** — the student ticked it off in LockIn. True as far as LockIn can
 *    tell, and no external system has confirmed it.
 *  - **Missing** — Canvas says the deadline passed with nothing handed in.
 *    Distinct from merely overdue, because Canvas is asserting it rather than
 *    LockIn inferring it from a clock.
 *
 * Collapsing those into one checkbox is what made the old list unable to
 * answer "what have I actually got left?".
 *
 * ## Ordering
 *
 * `urgency()` is the single comparator the whole app sorts by. Strictly
 * chronological within a band, bands ordered by how much trouble you are in.
 * Nothing here uses priority as a tiebreak before the due date — a "Normal"
 * assignment due in an hour beats an "Urgent" one due next week, and any
 * ordering that says otherwise is wrong on the only axis that matters.
 */
import type { Assignment } from '../types';
import { CANVAS_OFFLINE_SUBMISSION_TYPES } from '../types/canvas';
import { dueTimestamp, isComplete } from './selectors';
import { classify } from './sources/freshness';

/**
 * Work Canvas can never show a submission for: handed to the teacher on paper,
 * or expecting no submission at all.
 *
 * This matters because absence of evidence was being read as evidence of
 * absence. Canvas marks on-paper homework "Missing" until the teacher enters a
 * grade, and LockIn repeated that as fact — so work the student had physically
 * handed in sat at the top of the list, in the worst-trouble band, for days.
 * Only Canvas' own statement of the submission type gets us out of that; when
 * the page never said, this is false and nothing changes.
 */
export function isHandInWork(assignment: Assignment): boolean {
  const type = assignment.canvas?.submissionType;
  return type !== undefined && CANVAS_OFFLINE_SUBMISSION_TYPES.includes(type);
}

/**
 * The student says done; Canvas says nothing arrived.
 *
 * Deliberately not a `WorkState`: the work stays settled, because a lagging
 * gradebook is not allowed to quietly un-complete work and re-block a browser.
 * It is a disagreement to surface, not a verdict to enforce — and never true
 * of hand-in work, where "Missing" only means "not marked yet".
 */
export function isContested(assignment: Assignment): boolean {
  return (
    assignment.status === 'Completed' &&
    assignment.canvas?.submissionStatus === 'missing' &&
    !isHandInWork(assignment)
  );
}

export const WORK_STATES = [
  'graded',
  'submitted',
  'done',
  'missing',
  'overdue',
  'needs_sync',
  'due_today',
  'upcoming',
  'undated',
] as const;
export type WorkState = (typeof WORK_STATES)[number];

/** Short label. Always shown as words — no state is colour-only. */
export const WORK_STATE_LABEL: Record<WorkState, string> = {
  graded: 'Graded',
  submitted: 'Submitted',
  done: 'Done',
  missing: 'Missing',
  overdue: 'Overdue',
  needs_sync: 'Check date',
  due_today: 'Due today',
  upcoming: 'Upcoming',
  undated: 'No due date',
};

/** Which status token colours it. Only four meanings exist; see index.css. */
export const WORK_STATE_TONE: Record<WorkState, string> = {
  graded: 'lk-status-ahead',
  submitted: 'lk-status-ahead',
  done: 'lk-status-on_track',
  missing: 'lk-status-behind',
  overdue: 'lk-status-behind',
  needs_sync: 'lk-status-unknown',
  due_today: 'lk-status-at_risk',
  upcoming: 'lk-status-unknown',
  undated: 'lk-status-unknown',
};

/** True for states that mean "there is nothing left to do here". */
export function isSettled(state: WorkState): boolean {
  return state === 'graded' || state === 'submitted' || state === 'done';
}

/**
 * The one state an assignment is in.
 *
 * Canvas's own word wins over LockIn's inference wherever it has one: `graded`
 * and `missing` are assertions from the school's system, and overriding them
 * with a clock comparison would be LockIn contradicting the source of truth.
 */
export function workStateOf(assignment: Assignment, now: number): WorkState {
  const canvasStatus = assignment.canvas?.submissionStatus;

  if (canvasStatus === 'graded') return 'graded';
  if (canvasStatus === 'submitted' || canvasStatus === 'late_submitted') return 'submitted';
  if (isComplete(assignment)) return 'done';
  // `missing` is Canvas asserting the deadline passed unhanded-in. It outranks
  // the generic overdue below because it is a fact rather than an inference —
  // but only for work Canvas could have received. For paper homework the same
  // word means "not marked yet", so it falls through to the due date below and
  // is treated exactly like any other unfinished work: honestly overdue if it
  // is overdue, and nothing worse.
  if (canvasStatus === 'missing' && !isHandInWork(assignment)) return 'missing';

  const due = dueTimestamp(assignment);
  if (!Number.isFinite(due) || due === Number.MAX_SAFE_INTEGER) return 'undated';
  if (due < now) {
    const freshness = classify(assignment.source, now).state;
    // A manual date is the student's own current claim. An old Canvas feed is
    // not: once it is stale or unavailable, the date stays visible but cannot
    // be upgraded into the stronger claim that the work is overdue.
    if (
      assignment.source &&
      assignment.source.kind !== 'MANUAL' &&
      (freshness === 'STALE' || freshness === 'UNAVAILABLE')
    ) {
      return 'needs_sync';
    }
    return 'overdue';
  }

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return due <= endOfToday.getTime() ? 'due_today' : 'upcoming';
}

/**
 * How urgent, as a sortable number. Lower comes first.
 *
 * The bands are deliberately coarse and the tiebreak inside each is the due
 * time itself, so "most urgent first" is literally chronological once you are
 * inside a band:
 *
 *   0  missing      Canvas says you did not hand it in
 *   1  overdue      the deadline has passed
 *   2  needs sync   a passed external date LockIn can no longer trust
 *   3  due today
 *   4  upcoming     by due date
 *   5  undated      real work, but nothing is forcing it
 *   6  settled      graded, submitted, or ticked off
 */
export function urgency(assignment: Assignment, now: number): number {
  const state = workStateOf(assignment, now);
  const due = dueTimestamp(assignment);
  const band = {
    missing: 0,
    overdue: 1,
    needs_sync: 2,
    due_today: 3,
    upcoming: 4,
    undated: 5,
    graded: 6,
    submitted: 6,
    done: 6,
  }[state];

  // A band is 10^15 apart, which is comfortably wider than any real timestamp
  // difference, so the band always dominates and the due time only ever breaks
  // ties within one.
  const within = Number.isFinite(due) && due !== Number.MAX_SAFE_INTEGER ? due : 0;
  return band * 1e15 + within;
}

/** Most urgent first. The one ordering the whole app uses. */
export function byUrgency(assignments: Assignment[], now: number): Assignment[] {
  return [...assignments].sort((a, b) => urgency(a, now) - urgency(b, now));
}

/**
 * Work still needing attention, most urgent first.
 *
 * Settled work is dropped rather than sorted to the bottom: a "what do I do
 * next" list that ends with forty finished assignments is a list nobody
 * scrolls.
 */
export function whatToDoNext(assignments: Assignment[], now: number): Assignment[] {
  return byUrgency(
    assignments.filter((a) => !isSettled(workStateOf(a, now))),
    now,
  );
}

/**
 * Grouped by class, each group's own work most urgent first.
 *
 * Groups are ordered by their most urgent item, not alphabetically: the column
 * you need to look at first should be the one on the left. Ties fall back to
 * the class name so the layout does not shuffle between renders.
 */
export interface ClassGroup {
  subject: string;
  assignments: Assignment[];
  /** The urgency of the group's most pressing item. */
  urgency: number;
}

export function groupByClass(assignments: Assignment[], now: number): ClassGroup[] {
  const groups = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    const subject = assignment.subject?.trim() || 'No class';
    const existing = groups.get(subject);
    if (existing) existing.push(assignment);
    else groups.set(subject, [assignment]);
  }

  return [...groups.entries()]
    .map(([subject, list]) => {
      const sorted = byUrgency(list, now);
      const open = sorted.filter((a) => !isSettled(workStateOf(a, now)));
      return {
        subject,
        assignments: sorted,
        // A class with nothing outstanding sorts last however early its
        // finished work was due.
        urgency: open.length > 0 ? urgency(open[0], now) : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.urgency - b.urgency || a.subject.localeCompare(b.subject));
}
