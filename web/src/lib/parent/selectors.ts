/**
 * Everything the Parent Dashboard shows, derived from structured state.
 *
 * Pure functions over `AppState`: no React, no DOM, no reading the Activity
 * Log's prose. The log's `message` field is written for humans and gets
 * reworded; the numbers here come from assignments, verification records,
 * focus runs, completed sessions and *typed* activity events, so a copy edit
 * can never silently change a parent's summary.
 *
 * The scope of what these can possibly return is the product promise: work and
 * verification events. There is no selector for browsing history, page visits,
 * photos or OCR text, because none of that is stored anywhere to select from.
 */
import type {
  ActivityEvent,
  AppState,
  Assignment,
  Exam,
  FocusRun,
  VerificationRecord,
} from '../../types';
import { daysUntil } from '../time';

/* ------------------------------------------------------------------ */
/* Time windows                                                        */
/* ------------------------------------------------------------------ */

/** Local midnight, `days` ago. Week boundaries follow the device's clock. */
export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * The window the dashboard calls "this week": today plus the six days before,
 * from local midnight. Not a calendar week — a rolling seven days is what
 * someone checking in on a Wednesday actually wants.
 */
export function weekWindow(now = new Date()): { from: Date; to: Date } {
  const to = new Date(now);
  const from = startOfDay(new Date(now));
  from.setDate(from.getDate() - 6);
  return { from, to };
}

function within(iso: string | undefined, from: Date, to: Date): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && at >= from.getTime() && at <= to.getTime();
}

/* ------------------------------------------------------------------ */
/* How something was verified                                          */
/* ------------------------------------------------------------------ */

export const VERIFICATION_KINDS = [
  'canvas',
  'manual',
] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const VERIFICATION_KIND_LABEL: Record<VerificationKind, string> = {
  canvas: 'Canvas verified',
  manual: 'Manual',
};

/**
 * Honest one-line explanations, shown next to the counts.
 *
 * Note what none of them claim: that the work is proven. Canvas is the
 * strongest because the school's own system reported the submission; Enhanced
 * is next because a code the student could not have known in advance appeared
 * in both photos; neither means a human checked the work.
 */
export const VERIFICATION_KIND_EXPLANATION: Record<VerificationKind, string> = {
  canvas:
    'Canvas itself reported the assignment as submitted or graded. LockIn read that status from the school’s own page.',
  manual:
    'The student marked this done themselves, or a focus timer completed it. No external evidence was involved.',
};

/** The last accepted verification record on an assignment, if any. */
export function latestVerification(assignment: Assignment): VerificationRecord | undefined {
  return [...assignment.verificationRecords]
    .reverse()
    .find((record) => record.status === 'verified');
}

/**
 * Which bucket a completed assignment belongs in.
 *
 * Driven by the record that actually completed it, not by the assignment's
 * platform label — a Canvas-platform assignment finished by ticking a box is
 * `manual`, and saying otherwise would overstate the evidence.
 */
export function verificationKindOf(assignment: Assignment): VerificationKind {
  const record = latestVerification(assignment);
  if (!record) return 'manual';
  if (record.type === 'canvas_submission') return 'canvas';
  return 'manual';
}

/* ------------------------------------------------------------------ */
/* Weekly summary                                                      */
/* ------------------------------------------------------------------ */

export interface WeeklySummary {
  from: string;
  to: string;
  assignmentsCompleted: number;
  /** Completed with external evidence — Canvas or Edgenuity. */
  verifiedCompletions: number;
  manualCompletions: number;
  focusSessions: number;
  focusMinutes: number;
  parentOverrides: number;
  emergencyExits: number;
  temporaryUnlocks: number;
  focusRunsStarted: number;
  focusRunsCompleted: number;
}

export function selectWeeklySummary(state: AppState, now = new Date()): WeeklySummary {
  const { from, to } = weekWindow(now);

  const completed = state.assignments.filter((a) => within(a.completedAt, from, to));
  const verified = completed.filter((a) => verificationKindOf(a) !== 'manual');
  const sessions = state.completedSessions.filter((s) => within(s.endedAt, from, to));
  const runs = state.focusRuns.filter((r) => within(r.startedAt, from, to) && !r.isTest);

  const countEvents = (type: ActivityEvent['type']) =>
    state.activity.filter((e) => e.type === type && within(e.timestamp, from, to)).length;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    assignmentsCompleted: completed.length,
    verifiedCompletions: verified.length,
    manualCompletions: completed.length - verified.length,
    focusSessions: sessions.length,
    focusMinutes: sessions.reduce((total, s) => total + Math.max(0, s.actualMinutes), 0),
    parentOverrides: countEvents('parent_override'),
    emergencyExits: countEvents('emergency_exit'),
    // Counted separately from overrides on purpose: pausing blocking for
    // fifteen minutes is not the same act as ending the session early.
    temporaryUnlocks: countEvents('temporary_unlock_started'),
    focusRunsStarted: runs.length,
    focusRunsCompleted: runs.filter((r) => r.outcome === 'completed').length,
  };
}

/* ------------------------------------------------------------------ */
/* Verification breakdown                                              */
/* ------------------------------------------------------------------ */

export interface VerificationBreakdown {
  kind: VerificationKind;
  label: string;
  explanation: string;
  count: number;
}

/** Counts of each verification kind among completions in the window. */
export function selectVerificationBreakdown(
  state: AppState,
  now = new Date(),
): VerificationBreakdown[] {
  const { from, to } = weekWindow(now);
  const counts = new Map<VerificationKind, number>(VERIFICATION_KINDS.map((k) => [k, 0]));

  for (const assignment of state.assignments) {
    if (!within(assignment.completedAt, from, to)) continue;
    const kind = verificationKindOf(assignment);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return VERIFICATION_KINDS.map((kind) => ({
    kind,
    label: VERIFICATION_KIND_LABEL[kind],
    explanation: VERIFICATION_KIND_EXPLANATION[kind],
    count: counts.get(kind) ?? 0,
  }));
}

/* ------------------------------------------------------------------ */
/* Recent work                                                         */
/* ------------------------------------------------------------------ */

export interface RecentVerification {
  assignmentId: string;
  title: string;
  subject: string;
  completedAt: string;
  kind: VerificationKind;
  label: string;
  record?: VerificationRecord;
  /** Edgenuity only: the before → after reading. */
  /** Canvas only: the status the page reported. */
  canvasStatus?: string;
  /** How many rejected attempts preceded this success. */
  attemptsBefore: number;
}

/**
 * Completed work, newest first.
 *
 * `attemptsBefore` counts verification records that were refused before the
 * accepted one. It is shown as a count rather than as a list of failures: a
 * refused check is not misconduct, and a parent scrolling a wall of them would
 * reasonably conclude otherwise.
 */
export function selectRecentVerifications(
  state: AppState,
  limit = 12,
): RecentVerification[] {
  return state.assignments
    .filter((a) => a.status === 'Completed' && a.completedAt)
    .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))
    .slice(0, limit)
    .map((assignment) => {
      const record = latestVerification(assignment);
      const kind = verificationKindOf(assignment);
      const failedBefore = assignment.verificationRecords.filter(
        (r) =>
          r.status === 'failed' &&
          record !== undefined &&
          Date.parse(r.timestamp) <= Date.parse(record.timestamp),
      ).length;

      return {
        assignmentId: assignment.id,
        title: assignment.title,
        subject: assignment.subject,
        completedAt: assignment.completedAt!,
        kind,
        label: VERIFICATION_KIND_LABEL[kind],
        record,
        canvasStatus:
          typeof record?.evidence?.canvasStatus === 'string'
            ? record.evidence.canvasStatus
            : undefined,
        attemptsBefore: failedBefore,
      };
    });
}

/* ------------------------------------------------------------------ */
/* Focus Mode history                                                  */
/* ------------------------------------------------------------------ */

export interface FocusHistoryEntry extends FocusRun {
  /** Minutes the run lasted, or has lasted so far. */
  minutes: number;
  /** Titles of the required assignments, for display. */
  requiredTitles: string[];
  outcomeLabel: string;
  totalBlocked: number;
}

const OUTCOME_LABEL: Record<FocusRun['outcome'], string> = {
  active: 'Still running',
  completed: 'Completed normally',
  ended: 'Ended by the student',
  override: 'Parent override used',
  emergency: 'Emergency exit used',
  test_expired: 'Blocking test finished',
};

export function selectFocusHistory(
  state: AppState,
  { limit = 20, includeTests = false, now = Date.now() } = {},
): FocusHistoryEntry[] {
  const titles = new Map(state.assignments.map((a) => [a.id, a.title]));

  return state.focusRuns
    .filter((run) => includeTests || !run.isTest)
    .slice(0, limit)
    .map((run) => {
      const started = Date.parse(run.startedAt);
      const ended = run.endedAt ? Date.parse(run.endedAt) : now;
      return {
        ...run,
        minutes: Math.max(0, Math.round((ended - started) / 60_000)),
        requiredTitles: run.requiredTaskIds.map((id) => titles.get(id) ?? 'Deleted assignment'),
        outcomeLabel: OUTCOME_LABEL[run.outcome],
        totalBlocked: run.blocked.reduce((total, b) => total + b.count, 0),
      };
    });
}

/* ------------------------------------------------------------------ */
/* Overrides, exits and unlocks                                        */
/* ------------------------------------------------------------------ */

export const OVERRIDE_KINDS = ['override', 'emergency', 'temporary_unlock'] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

export interface OverrideEntry {
  id: string;
  kind: OverrideKind;
  at: string;
  /** The reason the student typed, for emergency exits. */
  note?: string;
  minutes?: number;
  /** Set when the matching "blocking resumed" event was found. */
  endedAt?: string;
}

/**
 * Overrides, emergency exits and temporary unlocks — kept as three distinct
 * kinds.
 *
 * A temporary unlock is explicitly *not* an override: Focus Mode stays on and
 * blocking comes back by itself. Folding them together would make a parent
 * think the session was abandoned when it wasn't.
 */
export function selectOverrideHistory(state: AppState, limit = 30): OverrideEntry[] {
  const entries: OverrideEntry[] = [];
  // The log is newest-first, so unlock ends are seen before their starts.
  const pendingEnds: string[] = [];

  for (const event of state.activity) {
    if (event.type === 'temporary_unlock_ended') {
      pendingEnds.push(event.timestamp);
      continue;
    }
    if (event.type === 'temporary_unlock_started') {
      entries.push({
        id: event.id,
        kind: 'temporary_unlock',
        at: event.timestamp,
        minutes: typeof event.meta?.minutes === 'number' ? event.meta.minutes : undefined,
        endedAt: pendingEnds.pop(),
      });
    } else if (event.type === 'parent_override') {
      entries.push({ id: event.id, kind: 'override', at: event.timestamp });
    } else if (event.type === 'emergency_exit') {
      // The reason is appended to the message as "Emergency exit used — <why>".
      const separator = event.message.indexOf('—');
      entries.push({
        id: event.id,
        kind: 'emergency',
        at: event.timestamp,
        note: separator >= 0 ? event.message.slice(separator + 1).trim() : undefined,
      });
    }
    if (entries.length >= limit) break;
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* Assignments and exams                                               */
/* ------------------------------------------------------------------ */

export const PARENT_ASSIGNMENT_FILTERS = [
  'all',
  'completed',
  'incomplete',
  'canvas',
  'manual',
] as const;
export type ParentAssignmentFilter = (typeof PARENT_ASSIGNMENT_FILTERS)[number];

export interface ParentAssignmentRow {
  assignment: Assignment;
  kind: VerificationKind | null;
}

export function selectParentAssignmentSummary(
  state: AppState,
  filter: ParentAssignmentFilter = 'all',
): ParentAssignmentRow[] {
  const rows: ParentAssignmentRow[] = state.assignments.map((assignment) => {
    const done = assignment.status === 'Completed';
    return {
      assignment,
      kind: done ? verificationKindOf(assignment) : null,
    };
  });

  switch (filter) {
    case 'completed':
      return rows.filter((r) => r.assignment.status === 'Completed');
    case 'incomplete':
      return rows.filter((r) => r.assignment.status !== 'Completed');
    case 'canvas':
      return rows.filter((r) => r.kind === 'canvas');
    case 'manual':
      return rows.filter((r) => r.kind === 'manual');
    default:
      return rows;
  }
}

export interface ParentExamRow {
  exam: Exam;
  daysAway: number;
  /** Focus sessions logged against this subject in the last week. */
  studySessions: number;
}

export function selectParentExams(state: AppState, now = new Date()): ParentExamRow[] {
  const { from, to } = weekWindow(now);
  const byAssignment = new Map(state.assignments.map((a) => [a.id, a]));

  return state.exams
    .map((exam) => ({ exam, daysAway: daysUntil(exam.examDate, now) ?? -1 }))
    .filter((row) => row.daysAway >= 0)
    .sort((a, b) => a.daysAway - b.daysAway)
    .map((row) => ({
      ...row,
      studySessions: state.completedSessions.filter((session) => {
        if (!within(session.endedAt, from, to)) return false;
        const subject = session.assignmentId
          ? byAssignment.get(session.assignmentId)?.subject
          : undefined;
        return subject?.toLowerCase() === row.exam.subject.toLowerCase();
      }).length,
    }));
}

/* ------------------------------------------------------------------ */
/* Daily series (for the chart, and its text equivalent)               */
/* ------------------------------------------------------------------ */

export interface DailyPoint {
  /** `YYYY-MM-DD`, local. */
  date: string;
  label: string;
  verified: number;
  manual: number;
  focusMinutes: number;
}

/**
 * Seven days of totals.
 *
 * Returned as numbers rather than drawn as a chart so the same data can be
 * rendered as bars *and* read out as text — the chart is never the only way to
 * get the information.
 */
export function selectDailySeries(state: AppState, now = new Date(), days = 7): DailyPoint[] {
  const points: DailyPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = startOfDay(new Date(now));
    day.setDate(day.getDate() - offset);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);

    const completed = state.assignments.filter((a) => within(a.completedAt, day, next));
    const minutes = state.completedSessions
      .filter((s) => within(s.endedAt, day, next))
      .reduce((total, s) => total + Math.max(0, s.actualMinutes), 0);

    points.push({
      date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(
        day.getDate(),
      ).padStart(2, '0')}`,
      label: day.toLocaleDateString(undefined, { weekday: 'short' }),
      verified: completed.filter((a) => verificationKindOf(a) !== 'manual').length,
      manual: completed.filter((a) => verificationKindOf(a) === 'manual').length,
      focusMinutes: minutes,
    });
  }
  return points;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/**
 * The weekly summary as a plain object, safe to write to disk.
 *
 * Built by naming every field rather than by filtering a copy of the state:
 * an allowlist cannot accidentally start including the PIN hash, a challenge
 * value or an OCR string the way a denylist would the moment someone adds a
 * field somewhere else.
 */
export function buildWeeklyExport(state: AppState, now = new Date()) {
  const summary = selectWeeklySummary(state, now);
  const breakdown = selectVerificationBreakdown(state, now);
  const series = selectDailySeries(state, now);

  return {
    generatedAt: new Date(now).toISOString(),
    week: { from: summary.from, to: summary.to },
    totals: {
      assignmentsCompleted: summary.assignmentsCompleted,
      verifiedCompletions: summary.verifiedCompletions,
      manualCompletions: summary.manualCompletions,
      focusSessions: summary.focusSessions,
      focusMinutes: summary.focusMinutes,
      parentOverrides: summary.parentOverrides,
      emergencyExits: summary.emergencyExits,
      temporaryUnlocks: summary.temporaryUnlocks,
    },
    verification: breakdown.map((b) => ({ kind: b.kind, label: b.label, count: b.count })),
    daily: series.map((d) => ({
      date: d.date,
      verified: d.verified,
      manual: d.manual,
      focusMinutes: d.focusMinutes,
    })),
    completedWork: selectRecentVerifications(state, 50).map((entry) => ({
      title: entry.title,
      subject: entry.subject,
      completedAt: entry.completedAt,
      verification: entry.label,
      canvasStatus: entry.canvasStatus,
    })),
    note: 'Generated locally by LockIn. Contains no PIN data and no browsing history.',
  };
}

/** The same completed work as CSV, one row per assignment. */
export function buildWeeklyCsv(state: AppState): string {
  const rows = selectRecentVerifications(state, 200);
  const escape = (value: string | number | undefined) => {
    if (value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = ['Completed at', 'Subject', 'Assignment', 'Verification', 'Canvas status'];
  const lines = rows.map((row) =>
    [row.completedAt, row.subject, row.title, row.label, row.canvasStatus]
      .map(escape)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
