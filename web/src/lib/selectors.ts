/** Derived views over AppState. Pure functions, no React. */
import type { Assignment, AppState, CanvasDetectedAssignment, Exam } from '../types';
import { canvasKey } from '../types/canvas';
import { daysUntil, parseDueDate, todayISO } from './time';
import { homeworkWindowFrom, isDuringSchoolHours, isHomeworkTime, schoolHoursFrom } from './schoolSchedule';
import type { HomeworkWindow, SchoolHours } from './schoolSchedule';
import type { BridgeState } from './protocol';

export function isComplete(a: Assignment): boolean {
  return a.status === 'Completed';
}

export function dueTimestamp(a: Assignment): number {
  return parseDueDate(a.dueDate, a.dueTime)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

export function sortByDue(list: Assignment[]): Assignment[] {
  const weight = { Urgent: 0, Important: 1, Normal: 2 } as const;
  return [...list].sort(
    (a, b) => dueTimestamp(a) - dueTimestamp(b) || weight[a.priority] - weight[b.priority],
  );
}

export function dueToday(state: AppState, now = new Date()): Assignment[] {
  const today = todayISO(now);
  return sortByDue(
    state.assignments.filter((a) => !isComplete(a) && a.dueDate === today),
  );
}

export function overdue(state: AppState, now = new Date()): Assignment[] {
  return sortByDue(
    state.assignments.filter((a) => !isComplete(a) && dueTimestamp(a) < now.getTime()),
  );
}

/** Overdue + today + the next few days — what the dashboard calls "Today". */
export function dueSoon(state: AppState, days = 2, now = new Date()): Assignment[] {
  return sortByDue(
    state.assignments.filter((a) => {
      if (isComplete(a)) return false;
      const d = daysUntil(a.dueDate, now);
      return d === null || d <= days;
    }),
  );
}

export function todayProgress(state: AppState, now = new Date()): { done: number; total: number } {
  const today = todayISO(now);
  const todays = state.assignments.filter((a) => a.dueDate === today);
  return { done: todays.filter(isComplete).length, total: todays.length };
}

export function upcomingExams(state: AppState, now = new Date()): Exam[] {
  return [...state.exams]
    .filter((e) => (daysUntil(e.examDate, now) ?? -1) >= 0)
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
}

export function requiredAssignments(state: AppState): Assignment[] {
  return state.focusMode.requiredTaskIds
    .map((id) => state.assignments.find((a) => a.id === id))
    .filter((a): a is Assignment => !!a);
}

export function requiredRemaining(state: AppState): number {
  return Math.max(0, state.focusMode.requiredCompletionCount - state.focusMode.completedCount);
}

/** Title shown on the block page and in the popup. */
export function currentTaskTitle(state: AppState): string | null {
  const required = requiredAssignments(state).find((a) => !isComplete(a));
  if (required) return required.title;
  const next = dueSoon(state, 7)[0];
  return next ? next.title : null;
}

/**
 * The school day LockIn should keep blocking out of, or `null` for "do not
 * suspend anything" — either because the student turned the pause off, or
 * because no schedule has been configured to derive it from.
 */
export function blockingSchoolHours(state: AppState): SchoolHours | null {
  if (!state.settings.pauseBlockingDuringSchool) return null;
  return schoolHoursFrom(state.settings.schoolSchedule, state.settings.canvasCheckWindow);
}

/**
 * The homework hours blocking runs inside on its own, or `null` when
 * automatic blocking is off.
 */
export function blockingHomeworkWindow(state: AppState): HomeworkWindow | null {
  if (!state.settings.autoBlockAfterSchool) return null;
  return homeworkWindowFrom(state.settings.schoolSchedule, state.settings.canvasCheckWindow);
}

/**
 * True while blocking should actually be applied right now.
 *
 * **LockIn blocks after school, and only after school.** The school day is
 * carved out, and homework hours block on their own without a Focus session —
 * which is the half that matters, because a blocker that waits to be switched
 * on never reaches the student who needs it most. A deliberately started Focus
 * session still blocks any time outside school.
 *
 * Mirrored in `extension/background/rules.js`, which is what enforces.
 */
export function blockingActive(state: AppState, now = Date.now()): boolean {
  const fm = state.focusMode;
  if (!state.settings.blockingEnabled) return false;
  if (fm.temporaryUnlockUntil && fm.temporaryUnlockUntil > now) return false;
  if (fm.isTest && fm.testExpiresAt && fm.testExpiresAt <= now) return false;
  // The 5-minute test from Settings ignores the schedule: it is the only way
  // to confirm blocking works, and one that silently does nothing at the wrong
  // hour teaches the opposite of what it is for.
  if (fm.isTest && fm.active) return true;
  const dates = state.settings.schoolSchedule.noSchoolDates;
  if (isDuringSchoolHours(blockingSchoolHours(state), now, dates)) return false;
  if (fm.active) return true;
  return isHomeworkTime(blockingHomeworkWindow(state), now, dates);
}

/**
 * Domains that must never be blocked, including the configured Canvas host.
 * Canvas is added here (and sent to the extension separately) so that removing
 * it from the school allowlist cannot lock a student out of their homework.
 */
export function effectiveAllowlist(state: AppState): string[] {
  const canvasDomain = state.canvas?.connection?.domain;
  const list = [...state.settings.allowedDomains];
  if (canvasDomain && !list.includes(canvasDomain)) list.push(canvasDomain);
  return list;
}

/** The exact slice handed to the extension. */
export function toBridgeState(state: AppState): BridgeState {
  return {
    focusModeActive: state.focusMode.active,
    requiredTaskCount: state.focusMode.requiredCompletionCount,
    completedTaskCount: state.focusMode.completedCount,
    currentTaskTitle: currentTaskTitle(state),
    blockedDomains: state.settings.blockedDomains,
    allowedDomains: effectiveAllowlist(state),
    focusStartedAt: state.focusMode.startedAt,
    temporaryUnlockUntil: state.focusMode.temporaryUnlockUntil,
    blockingEnabled: state.settings.blockingEnabled,
    reminderMode: state.settings.reminderMode,
    isTest: state.focusMode.isTest,
    testExpiresAt: state.focusMode.testExpiresAt,
    appUrl: window.location.origin + '/home',
    canvasDomain: state.canvas?.connection?.domain ?? null,
    // Sent rather than recomputed extension-side: the schedule lives here, and
    // the extension has to be able to pause blocking with no LockIn tab open.
    schoolHours: blockingSchoolHours(state),
    homeworkWindow: blockingHomeworkWindow(state),
    noSchoolDates: state.settings.schoolSchedule.noSchoolDates,
  };
}

/* ------------------------------------------------------------------ */
/* Canvas views                                                        */
/* ------------------------------------------------------------------ */

/** Assignments backed by a Canvas link. */
export function canvasAssignments(state: AppState): Assignment[] {
  return state.assignments.filter((a) => !!a.canvas);
}

/**
 * Detected Canvas assignments that are neither imported nor ignored — i.e. the
 * things worth offering in the import UI.
 */
export function importCandidates(state: AppState): CanvasDetectedAssignment[] {
  const domain = state.canvas?.connection?.domain;
  if (!domain) return [];
  const linked = new Set(
    state.assignments
      .map((a) =>
        a.canvas && a.externalCourseId && a.externalAssignmentId
          ? canvasKey(a.canvas.domain, a.externalCourseId, a.externalAssignmentId)
          : null,
      )
      .filter((k): k is string => k !== null),
  );
  const ignored = new Set(state.canvas.ignoredKeys);
  return state.canvas.detected.filter((d) => {
    const key = canvasKey(domain, d.externalCourseId, d.externalAssignmentId);
    return !linked.has(key) && !ignored.has(key);
  });
}

/**
 * Splits import candidates into what a student should see first.
 * Recently overdue, due today and the next two weeks come first; a whole
 * semester of backlog is hidden behind "Show older assignments".
 */
export function partitionCandidates(
  candidates: CanvasDetectedAssignment[],
  now = new Date(),
): { priority: CanvasDetectedAssignment[]; older: CanvasDetectedAssignment[] } {
  const horizon = now.getTime() + 14 * 86_400_000;
  const overdueFloor = now.getTime() - 30 * 86_400_000;

  const priority: CanvasDetectedAssignment[] = [];
  const older: CanvasDetectedAssignment[] = [];

  for (const item of candidates) {
    if (!item.dueAt) {
      // Undated work is not noise — Canvas uses it for ongoing tasks.
      priority.push(item);
      continue;
    }
    const due = new Date(item.dueAt).getTime();
    if (Number.isNaN(due)) priority.push(item);
    else if (due >= overdueFloor && due <= horizon) priority.push(item);
    else older.push(item);
  }

  const byDue = (a: CanvasDetectedAssignment, b: CanvasDetectedAssignment) =>
    (a.dueAt ? Date.parse(a.dueAt) : Number.MAX_SAFE_INTEGER) -
    (b.dueAt ? Date.parse(b.dueAt) : Number.MAX_SAFE_INTEGER);

  return { priority: priority.sort(byDue), older: older.sort(byDue) };
}

/** True when Canvas hasn't been seen for a while and the UI should say so. */
export function isCanvasStale(state: AppState, now = Date.now(), maxAgeMs = 6 * 3600_000): boolean {
  const seen = state.canvas?.connection?.lastSeenAt;
  if (!state.canvas?.connection) return false;
  if (!seen) return true;
  const at = Date.parse(seen);
  return Number.isNaN(at) || now - at > maxAgeMs;
}

/** Course display name, falling back to whatever Canvas called it. */
export function courseDisplayName(state: AppState, externalCourseId?: string): string | null {
  if (!externalCourseId) return null;
  const course = state.canvas?.courses.find((c) => c.externalCourseId === externalCourseId);
  return course ? course.displayName || course.originalName : null;
}

/** Elapsed milliseconds on a session, safe across refresh and pause. */
export function sessionElapsedMs(
  session: { runningSince: string | null; accumulatedMs: number } | null,
  now = Date.now(),
): number {
  if (!session) return 0;
  const live = session.runningSince ? now - new Date(session.runningSince).getTime() : 0;
  return session.accumulatedMs + Math.max(0, live);
}
