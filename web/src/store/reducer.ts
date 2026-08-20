/**
 * Pure state transitions. Every mutation in LockIn goes through here so that
 * persistence, cross-tab sync and extension sync all observe one state object.
 */
import type {
  ActivityEvent,
  ActivityType,
  AppState,
  Assignment,
  CanvasDetectedAssignment,
  CompletionMethod,
  Exam,
  ParentPin,
  Settings,
  ParentControls,
  PlanReason,
  PlanVersionEntry,
  PlannerSettings,
  StudyPlan,
} from '../types';
import { MAX_PLAN_HISTORY, MAX_PLAN_SKIPS } from '../types/planner';
import { buildPlan, statusContext, unfinishedBefore } from '../lib/planner';
import { orderItems } from '../lib/planner/engine';
import { canvasKey, defaultCanvasState } from '../types/canvas';
import type { FeedDiff } from '../lib/canvas/calendarReconcile';
import type { IntegrationId, IntegrationStatus } from '../types/integrations';
import { MAX_FOCUS_RUNS, PROTECTED_SETTING_KEYS } from '../types/parent';
import type { FocusRun } from '../types/parent';
import { todayISO, uid } from '../lib/time';
import { defaultState } from '../lib/storage';
import { isVerifiedComplete, mergeStatus } from '../lib/canvas/verification';
import { assignmentCanvasKey } from '../lib/canvas/matching';
import { createAssignmentFromCanvas, createAssignmentFromFeed } from './factories';
import { MAX_ACTIVITY, MAX_COMPLETED_SESSIONS, trimActivity } from '../lib/retention';
import { AWAY_GRACE_MS } from '../lib/focusGuard';

export { MAX_ACTIVITY };

export type Action =
  | { type: 'REPLACE'; state: AppState }
  | { type: 'RESET' }
  | { type: 'TICK'; now: number }
  | { type: 'CREATE_PROFILE'; firstName: string }
  | { type: 'SET_PROFILE_NAME'; firstName: string }
  | { type: 'FINISH_ONBOARDING' }
  | { type: 'ADD_ASSIGNMENT'; assignment: Assignment }
  | { type: 'UPDATE_ASSIGNMENT'; id: string; patch: Partial<Assignment> }
  | { type: 'DELETE_ASSIGNMENT'; id: string }
  | { type: 'COMPLETE_ASSIGNMENT'; id: string; method: CompletionMethod }
  | { type: 'UNCOMPLETE_ASSIGNMENT'; id: string }
  | { type: 'MARK_REMINDER_FIRED'; id: string; stage: string }
  | { type: 'ADD_EXAM'; exam: Exam }
  | { type: 'UPDATE_EXAM'; id: string; patch: Partial<Exam> }
  | { type: 'DELETE_EXAM'; id: string }
  /**
   * `parentApproved` is required to change a setting the parent has locked.
   * Guarding it in the reducer (rather than only hiding the control) means a
   * second UI path cannot quietly become a bypass.
   */
  | { type: 'UPDATE_SETTINGS'; patch: Partial<Settings>; parentApproved?: boolean }
  | { type: 'SET_PIN'; pin: ParentPin | null }
  | {
      type: 'START_SESSION';
      assignmentId: string | null;
      minutes: number;
      /** Exam revision, when the session came from a planned exam chunk. */
      examId?: string | null;
      /** The planned item this session was started from, for progress. */
      plannedItemId?: string;
    }
  | { type: 'PAUSE_SESSION' }
  | { type: 'RESUME_SESSION' }
  | { type: 'END_SESSION' }
  | {
      type: 'START_FOCUS_MODE';
      requiredTaskIds: string[];
      requiredCompletionCount: number;
      isTest?: boolean;
      testMinutes?: number;
    }
  | { type: 'END_FOCUS_MODE'; reason: 'normal' | 'override' | 'emergency'; note?: string }
  | { type: 'TEMPORARY_UNLOCK'; minutes: number; byParent?: boolean }
  | { type: 'CANCEL_TEMPORARY_UNLOCK' }
  | { type: 'LOG'; eventType: ActivityType; message: string; meta?: ActivityEvent['meta'] }
  | { type: 'SET_BLOCK_STATS'; stats: AppState['blockStats'] }
  /**
   * Focus Guard noticed a completed trip away from the LockIn tab (Phase 9).
   *
   * Reported as a finished period rather than as two events, so a missed
   * `visible` — a crashed tab, a closed laptop — can never leave an open
   * period that inflates the tally forever. See `lib/focusGuard.ts`.
   */
  | { type: 'FOCUS_GUARD_AWAY'; ms: number }
  /* ---- Canvas Browser Connection (Phase 3) ---- */
  | { type: 'CANVAS_CONNECT'; domain: string; permissionGranted: boolean }
  | {
      type: 'CANVAS_SET_CONNECTION';
      permissionGranted?: boolean;
      lastSeenAt?: string | null;
      lastError?: string | null;
      lastSyncAt?: string | null;
    }
  | { type: 'CANVAS_DISCONNECT'; keepAssignments: boolean }
  /** Fold a batch of detections in. Idempotent — safe to replay. */
  | { type: 'CANVAS_DETECTED'; detected: CanvasDetectedAssignment[]; seenAt: string }
  | { type: 'CANVAS_IMPORT'; items: CanvasDetectedAssignment[] }
  | { type: 'CANVAS_IGNORE'; key: string }
  | { type: 'CANVAS_LINK'; assignmentId: string; detected: CanvasDetectedAssignment }
  | { type: 'CANVAS_UNLINK'; assignmentId: string }
  | { type: 'CANVAS_SET_COURSE_NAME'; externalCourseId: string; displayName: string }
  /* ---- Canvas Calendar Feed (Phase 16) ---- */
  /**
   * Apply a reconciled feed diff.
   *
   * The diff is computed by `reconcileFeed()`, which is pure and tested on its
   * own. This case does exactly what the diff says and decides nothing — in
   * particular it never marks anything complete, because a calendar feed does
   * not know.
   */
  | { type: 'FEED_APPLY'; diff: FeedDiff; sourceId: string; syncedAt: string; live: boolean }
  /** Record the outcome of a sync attempt against one integration. */
  | {
      type: 'INTEGRATION_STATUS';
      id: IntegrationId;
      status: IntegrationStatus;
      account?: string;
      error?: string;
      itemCount?: number;
      syncedAt?: string;
    }
  /* ---- Parent accountability (Phase 6) ---- */
  | { type: 'PARENT_SET_CONTROLS'; patch: Partial<ParentControls> }
  /** Clear accountability history without touching schoolwork. */
  | { type: 'PARENT_CLEAR_HISTORY'; scope: 'verification' | 'activity' | 'focus' }
  /* ---- Smart Study Planner (Phase 7) ---- */
  /**
   * Availability, limits, chunk sizes. Any change rebuilds the plan, because a
   * plan that does not match the availability it was built from is worse than
   * no plan at all.
   */
  | { type: 'PLANNER_UPDATE_SETTINGS'; patch: Partial<PlannerSettings> }
  /** "Rebuild plan" — and the only place a plan is created from nothing. */
  | { type: 'PLANNER_REBUILD'; reason?: PlanReason }
  /**
   * "I can't do this today." Deliberately not PIN-gated: this is planning, not
   * a way around Focus Mode, and treating it as an escape hatch would teach
   * students to lie to the planner.
   */
  | { type: 'PLANNER_SKIP_ITEM'; sourceType: 'assignment' | 'exam'; sourceId: string; date: string }
  | { type: 'PLANNER_UNSKIP_ITEM'; sourceType: 'assignment' | 'exam'; sourceId: string; date: string }
  /** Manual reordering of one day. Survives until the plan is rebuilt. */
  | { type: 'PLANNER_SET_ORDER'; date: string; order: string[] }
  | { type: 'PLANNER_SET_LOCK'; date: string; locked: boolean }
  /** Opt in to a learned subject speed factor. */
  | { type: 'PLANNER_ACCEPT_FACTOR'; subject: string }
  | { type: 'PLANNER_REJECT_FACTOR'; subject: string };

function log(
  state: AppState,
  type: ActivityType,
  message: string,
  meta?: ActivityEvent['meta'],
): AppState {
  const event: ActivityEvent = {
    id: uid('evt'),
    type,
    timestamp: new Date().toISOString(),
    message,
    meta,
  };
  // `trimActivity` rather than a plain slice: an accountability event must not
  // be evicted by a run of ordinary ones. See lib/retention.ts.
  return { ...state, activity: trimActivity([event, ...state.activity]) };
}

/**
 * Recomputes everything that is a function of assignments, and closes out
 * Focus Mode once its required work is done. Called at the end of every case
 * so the invariant can't drift.
 */
function recompute(state: AppState): AppState {
  const fm = state.focusMode;
  if (!fm.active) return state;

  const completedCount = fm.requiredTaskIds.filter((id) => {
    const a = state.assignments.find((x) => x.id === id);
    return a?.status === 'Completed';
  }).length;

  let next: AppState = { ...state, focusMode: { ...fm, completedCount } };

  const goalMet =
    fm.requiredCompletionCount > 0 && completedCount >= fm.requiredCompletionCount;
  if (goalMet) {
    next = {
      ...next,
      focusMode: {
        ...next.focusMode,
        active: false,
        temporaryUnlockUntil: null,
        isTest: false,
        testExpiresAt: null,
      },
    };
    next = closeFocusRun(next, 'completed');
    next = log(
      next,
      'focus_mode_completed',
      `Focus Mode completed — ${completedCount}/${fm.requiredCompletionCount} required tasks done`,
      { requiredCount: fm.requiredCompletionCount, completedCount },
    );
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Smart Study Planner (Phase 7)                                       */
/* ------------------------------------------------------------------ */

/**
 * Two plans are "the same" when they schedule the same work at the same
 * length on the same days with the same warnings.
 *
 * This comparison is what stops the plan rebuilding continuously. Every
 * assignment edit calls the planner, and without it each call would produce a
 * fresh `generatedAt`, a new version number and a new object identity — which
 * means a write to localStorage, a re-render, and a "your plan changed" story
 * for a plan that is character-for-character identical.
 */
function samePlan(a: StudyPlan | null, b: StudyPlan): boolean {
  if (!a) return false;
  const shape = (p: StudyPlan) =>
    JSON.stringify({
      days: p.days.map((d) => ({
        date: d.date,
        capacity: d.capacityMinutes,
        items: d.items.map((i) => [i.id, i.scheduledDate, i.plannedMinutes, i.startTime ?? '']),
      })),
      warnings: p.warnings.map((w) => [w.kind, w.sourceId ?? '', w.date ?? '', w.facts]),
      unscheduled: p.unscheduledMinutes,
    });
  return shape(a) === shape(b);
}

/**
 * Recalculates the plan after something it depends on changed.
 *
 * Silent by design for ordinary changes — finishing a task should just quietly
 * remove its remaining sessions. Nothing here decides *whether* work is done;
 * it reads the same assignment status everything else does, which is why a
 * Canvas completion needs no planner-specific path.
 */
function maybeReplan(state: AppState, reason: PlanReason): AppState {
  // No plan exists until the student has set their availability. Building one
  // from defaults they never saw would be a schedule nobody asked for.
  if (!state.planner.settings.configured) return state;

  const plan = buildPlan(state, reason);
  if (samePlan(state.planner.plan, plan)) return state;

  const entry: PlanVersionEntry = {
    planVersion: plan.planVersion,
    generatedAt: plan.generatedAt,
    reason: plan.reason,
    plannedMinutes: plan.days.reduce((sum, d) => sum + d.plannedMinutes, 0),
    itemCount: plan.days.reduce((sum, d) => sum + d.items.length, 0),
    warningCount: plan.warnings.length,
  };

  return {
    ...state,
    planner: {
      ...state.planner,
      plan,
      // Only enough history to explain a change and debug a complaint. Old
      // plans themselves are never kept.
      history: [entry, ...state.planner.history].slice(0, MAX_PLAN_HISTORY),
    },
  };
}

/** `recompute()` (the completion engine) followed by a planner refresh. */
function settle(state: AppState, reason: PlanReason): AppState {
  return maybeReplan(recompute(state), reason);
}

/** Drops skips for dates that have passed, so they cannot pile up forever. */
function pruneSkips(state: AppState, today: string): AppState {
  const skips = state.planner.skips.filter((s) => s.date >= today);
  if (skips.length === state.planner.skips.length) return state;
  return { ...state, planner: { ...state.planner, skips } };
}

/* ------------------------------------------------------------------ */
/* Focus Mode run history (Phase 6)                                    */
/* ------------------------------------------------------------------ */

/** The run currently open, if any. */
function openFocusRun(state: AppState): FocusRun | undefined {
  return state.focusRuns.find((run) => run.outcome === 'active');
}

function replaceFocusRun(state: AppState, run: FocusRun): AppState {
  return {
    ...state,
    focusRuns: state.focusRuns.map((r) => (r.id === run.id ? run : r)),
  };
}

/**
 * Blocked attempts *during* a run.
 *
 * The extension only ever reports running totals per domain, so the run stores
 * a baseline at the start and subtracts it at the end. Counts only: LockIn has
 * never recorded which pages were visited and this does not start.
 */
function blockedSince(
  baseline: { domain: string; count: number }[],
  current: AppState['blockStats'],
): { domain: string; count: number }[] {
  const before = new Map(baseline.map((b) => [b.domain, b.count]));
  return current
    .map((stat) => ({
      domain: stat.domain,
      count: Math.max(0, stat.count - (before.get(stat.domain) ?? 0)),
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Closes the open run.
 *
 * Every way Focus Mode can stop routes through here — finishing the work, the
 * student ending it, a parent override, an emergency exit, a test expiring —
 * so the history can never end up with two open runs or a run that silently
 * never closed.
 */
function closeFocusRun(
  state: AppState,
  outcome: FocusRun['outcome'],
  extra: { note?: string; at?: string } = {},
): AppState {
  const run = openFocusRun(state);
  if (!run) return state;
  const endedAt = extra.at ?? new Date().toISOString();

  return replaceFocusRun(state, {
    ...run,
    outcome,
    endedAt,
    completedCount: state.focusMode.completedCount,
    note: extra.note ? extra.note.slice(0, 200) : run.note,
    blocked: blockedSince(run.blockBaseline, state.blockStats),
    unlocks: run.unlocks.map((unlock) =>
      unlock.endedAt ? unlock : { ...unlock, endedAt },
    ),
  });
}

const CONTROL_LABEL: Record<keyof ParentControls, string> = {
  lockVerificationSettings: 'blocking locked on',
  protectBlocklistInStrictMode: 'blocked-site protection',
  protectAllowlistInStrictMode: 'school allowlist protection',
};

function describeControl(key: keyof ParentControls): string {
  return CONTROL_LABEL[key] ?? key;
}

/** Stamps the end time on the run's most recent open unlock. */
function closeOpenUnlock(state: AppState, at = new Date().toISOString()): AppState {
  const run = openFocusRun(state);
  if (!run) return state;
  const index = run.unlocks.findLastIndex((unlock) => !unlock.endedAt);
  if (index === -1) return state;
  return replaceFocusRun(state, {
    ...run,
    unlocks: run.unlocks.map((unlock, i) => (i === index ? { ...unlock, endedAt: at } : unlock)),
  });
}

/** Patches one assignment and stamps `updatedAt`. */
function updateAssignment(
  state: AppState,
  id: string,
  patch: Partial<Assignment>,
): AppState {
  return {
    ...state,
    assignments: state.assignments.map((a) =>
      a.id === id ? { ...a, ...patch, id: a.id, updatedAt: new Date().toISOString() } : a,
    ),
  };
}





export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'REPLACE':
      return action.state;

    case 'RESET':
      return defaultState();

    /* ---- time-driven expiry (temporary unlock, test mode) ---- */
    case 'TICK': {
      let next = state;
      const fm = state.focusMode;
      if (fm.temporaryUnlockUntil && fm.temporaryUnlockUntil <= action.now) {
        next = {
          ...next,
          focusMode: { ...next.focusMode, temporaryUnlockUntil: null },
        };
        next = closeOpenUnlock(next, new Date(action.now).toISOString());
        next = log(next, 'temporary_unlock_ended', 'Temporary unlock expired — blocking resumed');
      }
      if (fm.active && fm.isTest && fm.testExpiresAt && fm.testExpiresAt <= action.now) {
        next = {
          ...next,
          focusMode: {
            ...next.focusMode,
            active: false,
            isTest: false,
            testExpiresAt: null,
            temporaryUnlockUntil: null,
          },
        };
        next = closeFocusRun(next, 'test_expired');
        next = log(next, 'focus_mode_ended', 'Blocking test finished automatically');
      }
      /**
       * Day rollover.
       *
       * A plan whose horizon still starts yesterday is stale: the work nobody
       * did is still sitting on a day that has passed. Rebuilding here — and
       * only here — is what carries it forward. The comparison is against the
       * plan's own start date, so this fires once when the date changes and
       * not on any of the thousands of ticks in between.
       */
      const today = todayISO(new Date(action.now));
      if (next.planner.plan && next.planner.plan.planningHorizonStart !== today) {
        // Measure what was left unfinished *before* rebuilding: the new plan
        // has no past days, so this is the last moment the fact exists.
        const recovery = unfinishedBefore(next.planner.plan, today, statusContext(next, new Date(action.now)));
        next = maybeReplan(pruneSkips(next, today), 'day_rollover');
        next = {
          ...next,
          planner: {
            ...next.planner,
            lastRecovery: recovery
              ? { ...recovery, recordedAt: new Date(action.now).toISOString() }
              : null,
          },
        };
      } else if (!next.planner.plan && next.planner.settings.configured) {
        // A configured planner with no plan means the stored one was
        // unreadable and got dropped on load. Rebuilding is always safe: a
        // plan is derived, so nothing is recovered by leaving the student
        // staring at an empty planner.
        next = maybeReplan(next, 'initial');
      }
      return next === state ? state : next;
    }

    /* ---- profile ---- */
    case 'CREATE_PROFILE':
      return {
        ...state,
        profile: {
          firstName: action.firstName,
          onboarded: false,
          createdAt: new Date().toISOString(),
        },
      };

    case 'SET_PROFILE_NAME':
      return state.profile
        ? { ...state, profile: { ...state.profile, firstName: action.firstName } }
        : state;

    case 'FINISH_ONBOARDING':
      return state.profile
        ? { ...state, profile: { ...state.profile, onboarded: true } }
        : state;

    /* ---- assignments ---- */
    case 'ADD_ASSIGNMENT':
      return settle(
        log(
          { ...state, assignments: [...state.assignments, action.assignment] },
          'assignment_created',
          `Added “${action.assignment.title}”`,
          { subject: action.assignment.subject },
        ),
        'assignment_added',
      );

    case 'UPDATE_ASSIGNMENT':
      return settle(
        {
          ...state,
          assignments: state.assignments.map((a) =>
            a.id === action.id
              ? { ...a, ...action.patch, id: a.id, updatedAt: new Date().toISOString() }
              : a,
          ),
        },
        'assignment_changed',
      );

    case 'DELETE_ASSIGNMENT': {
      const target = state.assignments.find((a) => a.id === action.id);
      let next: AppState = {
        ...state,
        assignments: state.assignments.filter((a) => a.id !== action.id),
        activeSession:
          state.activeSession?.assignmentId === action.id ? null : state.activeSession,
        focusMode: {
          ...state.focusMode,
          requiredTaskIds: state.focusMode.requiredTaskIds.filter((id) => id !== action.id),
          // Deleting a required task must not make the goal unreachable.
          requiredCompletionCount: state.focusMode.requiredTaskIds.includes(action.id)
            ? Math.max(0, state.focusMode.requiredCompletionCount - 1)
            : state.focusMode.requiredCompletionCount,
        },
      };
      if (target) next = log(next, 'assignment_deleted', `Deleted “${target.title}”`);
      // Skips and manual ordering that referred to this assignment are dead
      // weight now; the rebuild drops its items, and these would otherwise
      // linger and reorder something else later.
      next = {
        ...next,
        planner: {
          ...next.planner,
          skips: next.planner.skips.filter(
            (s) => !(s.sourceType === 'assignment' && s.sourceId === action.id),
          ),
        },
      };
      return settle(next, 'assignment_deleted');
    }

    case 'COMPLETE_ASSIGNMENT': {
      const target = state.assignments.find((a) => a.id === action.id);
      if (!target || target.status === 'Completed') return state;
      const now = new Date().toISOString();
      let next: AppState = {
        ...state,
        assignments: state.assignments.map((a) =>
          a.id === action.id
            ? {
                ...a,
                status: 'Completed',
                completionMethod: action.method,
                completedAt: now,
                updatedAt: now,
                verificationStatus: 'verified',
                verificationRecords: [
                  ...a.verificationRecords,
                  {
                    id: uid('ver'),
                    type: action.method,
                    timestamp: now,
                    status: 'verified',
                    note:
                      action.method === 'timer'
                        ? 'Completed at the end of a focus session'
                        : 'Marked complete by the student',
                  },
                ],
              }
            : a,
        ),
      };
      next = log(next, 'assignment_completed', `Completed “${target.title}”`, {
        method: action.method,
      });
      // Finishing early removes the chunks that were still planned for it —
      // quietly, because that is not a change the student needs to approve.
      return settle(next, 'assignment_completed');
    }

    case 'UNCOMPLETE_ASSIGNMENT':
      return settle({
        ...state,
        assignments: state.assignments.map((a) =>
          a.id === action.id
            ? {
                ...a,
                status: 'In Progress',
                completedAt: undefined,
                verificationStatus: 'not_required',
                updatedAt: new Date().toISOString(),
              }
            : a,
        ),
      }, 'assignment_changed');

    case 'MARK_REMINDER_FIRED':
      return {
        ...state,
        assignments: state.assignments.map((a) =>
          a.id === action.id && !a.remindersFired.includes(action.stage)
            ? { ...a, remindersFired: [...a.remindersFired, action.stage] }
            : a,
        ),
      };

    /* ---- exams ---- */
    case 'ADD_EXAM':
      return maybeReplan({ ...state, exams: [...state.exams, action.exam] }, 'exam_added');

    case 'UPDATE_EXAM':
      return maybeReplan(
        {
          ...state,
          exams: state.exams.map((e) =>
            e.id === action.id
              ? { ...e, ...action.patch, id: e.id, updatedAt: new Date().toISOString() }
              : e,
          ),
        },
        'exam_changed',
      );

    case 'DELETE_EXAM':
      return maybeReplan(
        {
          ...state,
          exams: state.exams.filter((e) => e.id !== action.id),
          activeSession:
            state.activeSession?.examId === action.id ? null : state.activeSession,
          planner: {
            ...state.planner,
            skips: state.planner.skips.filter(
              (s) => !(s.sourceType === 'exam' && s.sourceId === action.id),
            ),
          },
        },
        'exam_deleted',
      );

    /* ---- settings ---- */
    case 'UPDATE_SETTINGS': {
      /**
       * When a parent locks verification settings, the *reducer* refuses the
       * change — not just the control that renders it. Hiding a button is a
       * suggestion; refusing the action is the rule, and it is what makes the
       * "Managed by Parent Controls" label true rather than decorative.
       *
       * Everything else in settings stays the student's to change.
       */
      const patch = action.patch;
      /**
       * A locked setting is refused here, not merely hidden in the UI. A
       * student who found the action name is exactly who this is for.
       */
      const locked = state.parentControls.lockVerificationSettings
        ? (PROTECTED_SETTING_KEYS as readonly string[]).filter((key) => key in patch)
        : [];
      if (locked.length > 0 && !action.parentApproved) {
        const guarded = { ...patch };
        for (const key of locked) delete (guarded as Record<string, unknown>)[key];
        return { ...state, settings: { ...state.settings, ...guarded } };
      }
      return { ...state, settings: { ...state.settings, ...patch } };
    }

    case 'SET_PIN':
      return log(
        { ...state, parentPin: action.pin },
        'pin_changed',
        action.pin ? 'Parent PIN set' : 'Parent PIN removed',
      );

    /* ---- focus sessions ---- */
    case 'START_SESSION': {
      const now = new Date().toISOString();
      return {
        ...state,
        activeSession: {
          id: uid('ses'),
          assignmentId: action.assignmentId,
          // Exam revision uses the same timer as everything else — Phase 7 adds
          // a second kind of subject, not a second timer.
          examId: action.examId ?? null,
          plannedItemId: action.plannedItemId,
          plannedMinutes: action.minutes,
          state: 'running',
          startedAt: now,
          runningSince: now,
          accumulatedMs: 0,
        },
        assignments: action.assignmentId
          ? state.assignments.map((a) =>
              a.id === action.assignmentId && a.status === 'Not Started'
                ? { ...a, status: 'In Progress', updatedAt: now }
                : a,
            )
          : state.assignments,
      };
    }

    case 'PAUSE_SESSION': {
      const s = state.activeSession;
      if (!s || s.state !== 'running') return state;
      const extra = s.runningSince ? Date.now() - new Date(s.runningSince).getTime() : 0;
      return {
        ...state,
        activeSession: {
          ...s,
          state: 'paused',
          runningSince: null,
          accumulatedMs: s.accumulatedMs + Math.max(0, extra),
        },
      };
    }

    case 'RESUME_SESSION': {
      const s = state.activeSession;
      if (!s || s.state !== 'paused') return state;
      return {
        ...state,
        activeSession: { ...s, state: 'running', runningSince: new Date().toISOString() },
      };
    }

    case 'END_SESSION': {
      const s = state.activeSession;
      if (!s) return state;
      const extra = s.runningSince ? Date.now() - new Date(s.runningSince).getTime() : 0;
      const totalMs = s.accumulatedMs + Math.max(0, extra);
      const minutes = Math.round(totalMs / 60_000);
      const assignment = s.assignmentId
        ? state.assignments.find((a) => a.id === s.assignmentId)
        : null;
      const exam = s.examId ? state.exams.find((e) => e.id === s.examId) : null;
      const endedAt = new Date().toISOString();

      let next: AppState = {
        ...state,
        activeSession: null,
        completedSessions: [
          {
            id: s.id,
            assignmentId: s.assignmentId,
            examId: s.examId ?? null,
            assignmentTitle: assignment?.title ?? exam?.name ?? null,
            plannedMinutes: s.plannedMinutes,
            actualMinutes: minutes,
            startedAt: s.startedAt,
            endedAt,
          },
          ...state.completedSessions,
        ].slice(0, MAX_COMPLETED_SESSIONS),
        assignments: s.assignmentId
          ? state.assignments.map((a) =>
              a.id === s.assignmentId
                ? { ...a, loggedMinutes: a.loggedMinutes + minutes, updatedAt: endedAt }
                : a,
            )
          : state.assignments,
        // Exam revision is credited to the exam the same way assignment work is
        // credited to the assignment, so the planner sees one kind of fact.
        exams: s.examId
          ? state.exams.map((e) =>
              e.id === s.examId
                ? {
                    ...e,
                    loggedMinutes: Math.round((e.loggedMinutes ?? 0) + minutes),
                    updatedAt: endedAt,
                  }
                : e,
            )
          : state.exams,
      };
      next = log(
        next,
        'focus_session_completed',
        assignment
          ? `Studied ${minutes} min on “${assignment.title}”`
          : exam
            ? `Studied ${minutes} min for “${exam.name}”`
            : `Studied ${minutes} min`,
        { minutes },
      );
      // Partial work is not a special case: the minutes just landed on the
      // source, so whatever is left is still remaining and gets rescheduled.
      return maybeReplan(next, 'session_logged');
    }

    /* ---- focus mode ---- */
    case 'START_FOCUS_MODE': {
      const now = Date.now();
      const next: AppState = {
        ...state,
        focusMode: {
          active: true,
          startedAt: new Date(now).toISOString(),
          requiredTaskIds: action.requiredTaskIds,
          requiredCompletionCount: action.requiredCompletionCount,
          completedCount: 0,
          temporaryUnlockUntil: null,
          overrideUsed: false,
          emergencyExitUsed: false,
          isTest: !!action.isTest,
          testExpiresAt: action.isTest ? now + (action.testMinutes ?? 5) * 60_000 : null,
        },
      };
      const run: FocusRun = {
        id: uid('run'),
        startedAt: new Date(now).toISOString(),
        requiredTaskIds: action.requiredTaskIds,
        requiredCount: action.requiredCompletionCount,
        completedCount: 0,
        outcome: 'active',
        isTest: !!action.isTest,
        unlocks: [],
        blocked: [],
        // Snapshot the running totals so this run's blocked attempts can be
        // worked out as a delta when it ends.
        blockBaseline: state.blockStats.map((s) => ({ domain: s.domain, count: s.count })),
        awayCount: 0,
        awayMs: 0,
      };
      // Any previously open run is closed rather than abandoned — two active
      // runs would make every later summary ambiguous.
      const withRun: AppState = {
        ...closeFocusRun(next, 'ended'),
        focusRuns: [run, ...closeFocusRun(next, 'ended').focusRuns].slice(0, MAX_FOCUS_RUNS),
      };

      return recompute(
        log(
          withRun,
          action.isTest ? 'blocking_test_started' : 'focus_mode_started',
          action.isTest
            ? `Started a ${action.testMinutes ?? 5}-minute blocking test`
            : `Focus Mode started — ${action.requiredCompletionCount} required task${
                action.requiredCompletionCount === 1 ? '' : 's'
              }`,
          { requiredCount: action.requiredCompletionCount, isTest: !!action.isTest },
        ),
      );
    }

    case 'END_FOCUS_MODE': {
      const messages = {
        normal: 'Focus Mode ended',
        override: 'Parent override used',
        emergency: 'Emergency exit used',
      } as const;
      const types = {
        normal: 'focus_mode_ended',
        override: 'parent_override',
        emergency: 'emergency_exit',
      } as const;
      const outcomes = {
        normal: 'ended',
        override: 'override',
        emergency: 'emergency',
      } as const;

      const next: AppState = {
        ...state,
        focusMode: {
          ...state.focusMode,
          active: false,
          temporaryUnlockUntil: null,
          isTest: false,
          testExpiresAt: null,
          overrideUsed: action.reason === 'override' || state.focusMode.overrideUsed,
          emergencyExitUsed:
            action.reason === 'emergency' || state.focusMode.emergencyExitUsed,
        },
      };
      return log(
        closeFocusRun(next, outcomes[action.reason], { note: action.note }),
        types[action.reason],
        action.note ? `${messages[action.reason]} — ${action.note}` : messages[action.reason],
        { completedCount: state.focusMode.completedCount, requiredCount: state.focusMode.requiredCompletionCount },
      );
    }

    case 'TEMPORARY_UNLOCK': {
      const until = Date.now() + action.minutes * 60_000;
      const startedAt = new Date().toISOString();
      let next: AppState = {
        ...state,
        focusMode: { ...state.focusMode, temporaryUnlockUntil: until, overrideUsed: true },
      };

      const run = openFocusRun(next);
      if (run) {
        next = replaceFocusRun(next, {
          ...run,
          unlocks: [
            ...run.unlocks,
            { minutes: action.minutes, startedAt, byParent: !!action.byParent },
          ].slice(-40),
        });
      }

      return log(
        next,
        'temporary_unlock_started',
        `Temporary unlock for ${action.minutes} minutes${action.byParent ? ' (approved by parent)' : ''}`,
        { minutes: action.minutes, byParent: !!action.byParent },
      );
    }

    case 'CANCEL_TEMPORARY_UNLOCK':
      return log(
        closeOpenUnlock({
          ...state,
          focusMode: { ...state.focusMode, temporaryUnlockUntil: null },
        }),
        'temporary_unlock_ended',
        'Temporary unlock ended early',
      );

    case 'LOG':
      return log(state, action.eventType, action.message, action.meta);

    /**
     * Recorded against the *current* run only. There is nothing to attribute a
     * trip to outside a Focus Mode session, and counting tab switches during
     * ordinary use would be exactly the ambient monitoring LockIn refuses to
     * do.
     */
    case 'FOCUS_GUARD_AWAY': {
      if (!state.focusMode.active || !state.settings.focusGuard) return state;
      const ms = Math.max(0, Math.min(86_400_000, Math.round(action.ms)));
      if (ms < AWAY_GRACE_MS) return state;
      const [current, ...rest] = state.focusRuns;
      if (!current || current.outcome !== 'active') return state;
      return {
        ...state,
        focusRuns: [
          { ...current, awayCount: current.awayCount + 1, awayMs: current.awayMs + ms },
          ...rest,
        ],
      };
    }

    case 'SET_BLOCK_STATS':
      return { ...state, blockStats: action.stats };

    /* ------------------------------------------------------------------ */
    /* Canvas Browser Connection                                           */
    /* ------------------------------------------------------------------ */

    case 'CANVAS_CONNECT': {
      const existing = state.canvas.connection;
      const sameDomain = existing?.domain === action.domain;
      const next: AppState = {
        ...state,
        canvas: {
          ...state.canvas,
          connection: {
            domain: action.domain,
            mode: 'browser',
            connectedAt: sameDomain ? existing.connectedAt : new Date().toISOString(),
            lastSeenAt: sameDomain ? existing.lastSeenAt : null,
            permissionGranted: action.permissionGranted,
          },
          lastError: null,
        },
      };
      // Only announce a genuinely new connection, not every permission refresh.
      if (sameDomain && existing.permissionGranted === action.permissionGranted) return next;
      return log(next, 'canvas_connected', `Canvas connected — ${action.domain}`, {
        domain: action.domain,
        permissionGranted: action.permissionGranted,
      });
    }

    case 'CANVAS_SET_CONNECTION': {
      if (!state.canvas.connection) {
        return action.lastError !== undefined
          ? { ...state, canvas: { ...state.canvas, lastError: action.lastError } }
          : state;
      }
      const connection = {
        ...state.canvas.connection,
        permissionGranted:
          action.permissionGranted ?? state.canvas.connection.permissionGranted,
        lastSeenAt:
          action.lastSeenAt !== undefined ? action.lastSeenAt : state.canvas.connection.lastSeenAt,
      };
      return {
        ...state,
        canvas: {
          ...state.canvas,
          connection,
          lastSyncAt: action.lastSyncAt !== undefined ? action.lastSyncAt : state.canvas.lastSyncAt,
          lastError: action.lastError !== undefined ? action.lastError : state.canvas.lastError,
        },
      };
    }

    case 'CANVAS_DISCONNECT': {
      const domain = state.canvas.connection?.domain ?? 'Canvas';
      // Imported schoolwork is never silently deleted. When the student does
      // ask to remove it, only Canvas-linked assignments go.
      const assignments = action.keepAssignments
        ? state.assignments.map((a) =>
            a.canvas
              ? {
                  ...a,
                  // Keep the work, drop the dead link and stop offering a
                  // Canvas-only completion path.
                  canvas: undefined,
                  completionMethod: a.completionMethod === 'canvas' ? 'manual' : a.completionMethod,
                  verificationMethod: undefined,
                }
              : a,
          )
        : state.assignments.filter((a) => !a.canvas);

      const next: AppState = {
        ...state,
        assignments,
        canvas: defaultCanvasState(),
      };
      return settle(
        log(next, 'canvas_disconnected', `Canvas disconnected — ${domain}`, {
          keptAssignments: action.keepAssignments,
        }),
        'assignment_deleted',
      );
    }

    /**
     * The heart of Phase 3.
     *
     * Folds detections into linked assignments and, when Canvas gives strong
     * evidence, completes them — which flows straight into the existing
     * `recompute()` and therefore into Focus Mode auto-unlock. There is
     * deliberately no Canvas-specific unblocking path.
     *
     * Idempotent: replaying the same detection changes nothing beyond
     * `lastCheckedAt`, so Canvas reporting "submitted" ten times produces one
     * completion and one activity entry.
     */
    case 'CANVAS_DETECTED': {
      const connection = state.canvas.connection;
      if (!connection) return state;
      const domain = connection.domain;
      const seenAt = action.seenAt;

      let assignments = state.assignments;
      const events: { type: ActivityType; message: string; meta: ActivityEvent['meta'] }[] = [];

      for (const detected of action.detected) {
        const key = canvasKey(domain, detected.externalCourseId, detected.externalAssignmentId);
        const index = assignments.findIndex((a) => assignmentCanvasKey(a) === key);
        if (index === -1) continue;

        const assignment = assignments[index];
        const previousStatus = assignment.canvas?.submissionStatus ?? 'unknown';
        const status = mergeStatus(previousStatus, detected.submissionStatus);
        const statusChanged = status !== previousStatus;
        const shouldComplete = isVerifiedComplete(status) && assignment.status !== 'Completed';

        // Nothing new: only refresh when we actually learned something, so a
        // noisy page cannot churn state (and persistence) on every mutation.
        if (!statusChanged && !shouldComplete && assignment.canvas?.lastCheckedAt === seenAt) {
          continue;
        }

        let updated: Assignment = {
          ...assignment,
          canvas: {
            domain,
            url: detected.url || assignment.canvas?.url || '',
            submissionStatus: status,
            lastCheckedAt: seenAt,
            lastStatusChangeAt: statusChanged
              ? seenAt
              : (assignment.canvas?.lastStatusChangeAt ?? seenAt),
            courseName: detected.courseName ?? assignment.canvas?.courseName,
            kind: detected.kind ?? assignment.canvas?.kind,
          },
          updatedAt: seenAt,
        };

        if (shouldComplete) {
          updated = {
            ...updated,
            status: 'Completed',
            completionMethod: 'canvas',
            verificationMethod: 'canvas',
            verificationStatus: 'verified',
            completedAt: seenAt,
            verificationRecords: [
              ...assignment.verificationRecords,
              {
                id: uid('ver'),
                type: 'canvas_submission',
                timestamp: seenAt,
                status: 'verified',
                sourceDomain: domain,
                externalCourseId: detected.externalCourseId,
                externalAssignmentId: detected.externalAssignmentId,
                // Small structured evidence only — never page HTML or cookies.
                evidence: { canvasStatus: status },
              },
            ],
          };
          events.push({
            type: 'canvas_submission_verified',
            message: `${assignment.title} verified through Canvas`,
            meta: { canvasStatus: status, domain },
          });
        } else if (statusChanged && status === 'missing') {
          updated = { ...updated, verificationStatus: 'pending' };
          events.push({
            type: 'canvas_assignment_missing',
            message: `Canvas marked “${assignment.title}” missing`,
            meta: { domain },
          });
        }

        assignments = [
          ...assignments.slice(0, index),
          updated,
          ...assignments.slice(index + 1),
        ];
      }

      // Detections that are not linked to anything are kept as import
      // candidates, replacing any earlier sighting of the same assignment.
      const linkedKeys = new Set(
        assignments.map(assignmentCanvasKey).filter((k): k is string => k !== null),
      );
      const candidates = new Map(
        state.canvas.detected.map((d) => [
          canvasKey(domain, d.externalCourseId, d.externalAssignmentId),
          d,
        ]),
      );
      for (const detected of action.detected) {
        const key = canvasKey(domain, detected.externalCourseId, detected.externalAssignmentId);
        if (linkedKeys.has(key)) {
          candidates.delete(key);
          continue;
        }
        const previous = candidates.get(key);
        candidates.set(key, {
          ...detected,
          submissionStatus: previous
            ? mergeStatus(previous.submissionStatus, detected.submissionStatus)
            : detected.submissionStatus,
        });
      }

      let next: AppState = {
        ...state,
        assignments,
        canvas: {
          ...state.canvas,
          connection: { ...connection, lastSeenAt: seenAt },
          detected: [...candidates.values()].slice(0, 300),
          lastError: null,
        },
      };
      for (const event of events) next = log(next, event.type, event.message, event.meta);

      // Existing Phase 2 engine: recounts required work and, when the goal is
      // met, ends Focus Mode — which removes the blocking rules. The planner
      // reacts to the resulting assignment status, not to Canvas itself.
      return settle(next, 'assignment_completed');
    }

    case 'CANVAS_IMPORT': {
      const connection = state.canvas.connection;
      if (!connection) return state;
      const domain = connection.domain;

      const existingKeys = new Set(
        state.assignments.map(assignmentCanvasKey).filter((k): k is string => k !== null),
      );

      let next = state;
      let imported = 0;
      const importedKeys = new Set<string>();

      for (const detected of action.items) {
        const key = canvasKey(domain, detected.externalCourseId, detected.externalAssignmentId);
        // Re-importing the same Canvas assignment must never duplicate it.
        if (existingKeys.has(key) || importedKeys.has(key)) continue;
        importedKeys.add(key);
        existingKeys.add(key);
        imported += 1;
        next = {
          ...next,
          assignments: [...next.assignments, createAssignmentFromCanvas(detected, domain)],
        };
      }

      if (imported === 0) return state;

      next = {
        ...next,
        canvas: {
          ...next.canvas,
          detected: next.canvas.detected.filter(
            (d) => !importedKeys.has(canvasKey(domain, d.externalCourseId, d.externalAssignmentId)),
          ),
        },
      };

      next = log(
        next,
        'canvas_assignment_imported',
        imported === 1
          ? `Imported “${action.items[0].title}” from Canvas`
          : `Imported ${imported} assignments from Canvas`,
        { count: imported, domain },
      );
      return settle(next, 'assignment_added');
    }

    /* ---- Canvas Calendar Feed (Phase 16) ---- */

    /**
     * Applies a reconciled diff.
     *
     * Three separate things happen and each is deliberately narrow:
     *
     *  - **create** builds assignments from feed items. Nothing else.
     *  - **update** applies only the fields the feed owns — title, due date,
     *    subject when it was blank, and the provenance stamp. Status, logged
     *    minutes, the estimate and the priority are the student's, and a sync
     *    must never touch them.
     *  - **cancel** flags withdrawn work by dropping its reminders and saying
     *    so in the activity log. It never deletes and never completes: the
     *    student decides what to do with work their teacher pulled.
     */
    case 'FEED_APPLY': {
      const { diff } = action;
      let next = state;
      let touched = false;

      if (diff.create.length > 0) {
        const created = diff.create.map((item) =>
          createAssignmentFromFeed(item, {
            sourceId: action.sourceId,
            syncedAt: action.syncedAt,
            live: action.live,
          }),
        );
        next = { ...next, assignments: [...next.assignments, ...created] };
        next = log(
          next,
          'feed_assignments_imported',
          created.length === 1
            ? `Imported “${created[0].title}” from your Canvas calendar`
            : `Imported ${created.length} assignments from your Canvas calendar`,
          { count: created.length },
        );
        touched = true;
      }

      for (const update of diff.update) {
        const before = next.assignments.find((a) => a.id === update.assignmentId);
        if (!before) continue;
        next = updateAssignment(next, update.assignmentId, update.patch);
        if (update.changes.length > 0) {
          touched = true;
          next = log(
            next,
            'feed_assignment_updated',
            `Canvas updated “${before.title}” — ${update.changes.join('; ')}`,
            { assignmentId: before.id },
          );
        }
      }

      for (const cancellation of diff.cancel) {
        const target = next.assignments.find((a) => a.id === cancellation.assignmentId);
        if (!target || target.status === 'Completed') continue;
        touched = true;
        next = updateAssignment(next, cancellation.assignmentId, {
          // Reminders stop, because nagging about withdrawn work is the
          // fastest way to teach someone to ignore reminders. The assignment
          // itself stays, with its logged time intact.
          reminders: { ...target.reminders, enabled: false },
        });
        next = log(
          next,
          'feed_assignment_cancelled',
          `Canvas says “${target.title}” was cancelled. It is still here if you want it.`,
          { assignmentId: target.id },
        );
      }

      if (!touched) return next === state ? state : next;
      return settle(next, 'assignment_added');
    }

    /**
     * The state of one connection, after an attempt.
     *
     * Stored separately from the data the connection produced, on purpose: a
     * feed can be erroring while the assignments it imported last week are
     * still perfectly good, and both facts have to be sayable at once.
     */
    case 'INTEGRATION_STATUS': {
      const now = new Date().toISOString();
      const records = state.integrations.records.map((record) =>
        record.id !== action.id
          ? record
          : {
              ...record,
              status: action.status,
              account: action.account ?? record.account,
              lastAttemptAt: now,
              lastSyncedAt: action.syncedAt ?? (action.error ? record.lastSyncedAt : now),
              // Cleared on success rather than left to linger: a stale error
              // beside a fresh timestamp is the most confusing thing this card
              // could show.
              lastError: action.error ?? undefined,
              lastItemCount: action.itemCount ?? record.lastItemCount,
            },
      );
      return { ...state, integrations: { ...state.integrations, records } };
    }

    case 'CANVAS_IGNORE':
      return {
        ...state,
        canvas: {
          ...state.canvas,
          ignoredKeys: state.canvas.ignoredKeys.includes(action.key)
            ? state.canvas.ignoredKeys
            : [...state.canvas.ignoredKeys, action.key],
          detected: state.canvas.detected.filter((d) => {
            const domain = state.canvas.connection?.domain ?? '';
            return canvasKey(domain, d.externalCourseId, d.externalAssignmentId) !== action.key;
          }),
        },
      };

    /** Attaching an existing manually created assignment to Canvas. */
    case 'CANVAS_LINK': {
      const connection = state.canvas.connection;
      if (!connection) return state;
      const domain = connection.domain;
      const target = state.assignments.find((a) => a.id === action.assignmentId);
      if (!target) return state;

      const key = canvasKey(
        domain,
        action.detected.externalCourseId,
        action.detected.externalAssignmentId,
      );
      // One Canvas assignment can back only one LockIn assignment.
      if (state.assignments.some((a) => a.id !== target.id && assignmentCanvasKey(a) === key)) {
        return state;
      }

      const now = new Date().toISOString();
      let next: AppState = {
        ...state,
        assignments: state.assignments.map((a) =>
          a.id === target.id
            ? {
                ...a,
                platform: 'Canvas',
                completionMethod: 'canvas',
                verificationMethod: 'canvas',
                externalCourseId: action.detected.externalCourseId,
                externalAssignmentId: action.detected.externalAssignmentId,
                verificationStatus: a.status === 'Completed' ? a.verificationStatus : 'pending',
                updatedAt: now,
                canvas: {
                  domain,
                  url: action.detected.url,
                  submissionStatus: action.detected.submissionStatus,
                  lastCheckedAt: action.detected.detectedAt,
                  lastStatusChangeAt: action.detected.detectedAt,
                  courseName: action.detected.courseName,
                  kind: action.detected.kind,
                },
              }
            : a,
        ),
        canvas: {
          ...state.canvas,
          detected: state.canvas.detected.filter(
            (d) => canvasKey(domain, d.externalCourseId, d.externalAssignmentId) !== key,
          ),
        },
      };

      next = log(
        next,
        'canvas_assignment_linked',
        `Linked “${target.title}” to Canvas assignment “${action.detected.title}”`,
        { domain },
      );

      // Linking to something already submitted should verify it immediately,
      // through the same path a live detection would take.
      return reducer(next, {
        type: 'CANVAS_DETECTED',
        detected: [action.detected],
        seenAt: now,
      });
    }

    case 'CANVAS_UNLINK':
      return recompute({
        ...state,
        assignments: state.assignments.map((a) =>
          a.id === action.assignmentId
            ? {
                ...a,
                canvas: undefined,
                completionMethod: a.completionMethod === 'canvas' ? 'manual' : a.completionMethod,
                verificationMethod: undefined,
                externalCourseId: undefined,
                externalAssignmentId: undefined,
                updatedAt: new Date().toISOString(),
              }
            : a,
        ),
      });

    case 'CANVAS_SET_COURSE_NAME': {
      const displayName = action.displayName.trim().slice(0, 120);
      const exists = state.canvas.courses.some(
        (c) => c.externalCourseId === action.externalCourseId,
      );
      const courses = exists
        ? state.canvas.courses.map((c) =>
            c.externalCourseId === action.externalCourseId
              ? { ...c, displayName: displayName || c.originalName }
              : c,
          )
        : [
            ...state.canvas.courses,
            {
              externalCourseId: action.externalCourseId,
              originalName: displayName,
              displayName,
            },
          ];
      return { ...state, canvas: { ...state.canvas, courses } };
    }

    /* ------------------------------------------------------------------ */
    /* Parent accountability                                               */
    /* ------------------------------------------------------------------ */

    case 'PARENT_SET_CONTROLS': {
      const controls = { ...state.parentControls, ...action.patch };
      const changed = (Object.keys(action.patch) as (keyof ParentControls)[]).filter(
        (key) => state.parentControls[key] !== controls[key],
      );
      if (changed.length === 0) return state;

      return log(
        { ...state, parentControls: controls },
        'parent_controls_changed',
        `Parent controls updated — ${changed.map(describeControl).join(', ')}`,
        Object.fromEntries(changed.map((key) => [key, controls[key]])),
      );
    }


    /**
     * Clearing history. Deliberately three separate scopes, and none of them
     * touches assignments, exams, the PIN or the blocklists.
     */
    case 'PARENT_CLEAR_HISTORY': {
      if (action.scope === 'activity') {
        return log(
          { ...state, activity: [] },
          'parent_controls_changed',
          'Parent cleared the activity history',
        );
      }
      if (action.scope === 'focus') {
        return log(
          { ...state, focusRuns: [], completedSessions: [] },
          'parent_controls_changed',
          'Parent cleared the focus history',
        );
      }
      /* Verification history: the records go, the assignments and their
         completion status stay. */
      return log(
        {
          ...state,
          assignments: state.assignments.map((a) => ({ ...a, verificationRecords: [] })),
        },
        'parent_controls_changed',
        'Parent cleared the verification history',
      );
    }

    /* ------------------------------------------------------------------ */
    /* Smart Study Planner                                                 */
    /* ------------------------------------------------------------------ */

    case 'PLANNER_UPDATE_SETTINGS': {
      const settings: PlannerSettings = { ...state.planner.settings, ...action.patch };
      // Crossed chunk sizes would make every chunk unsatisfiable, so the pair
      // is repaired here rather than trusted from a form.
      settings.maxChunkMinutes = Math.max(settings.minChunkMinutes, settings.maxChunkMinutes);
      const availabilityChanged =
        action.patch.availability !== undefined ||
        action.patch.fixedBlocks !== undefined ||
        action.patch.weekdayMaxMinutes !== undefined ||
        action.patch.weekendMaxMinutes !== undefined;

      const next: AppState = {
        ...state,
        planner: { ...state.planner, settings },
      };
      /**
       * Deliberately not logged.
       *
       * Every keystroke in a number field dispatches this, so an activity
       * entry per change would flush real history (Focus Mode runs, overrides,
       * verifications) out of a 300-entry log within a minute of editing. The
       * plan's own version history records that settings changed, which is the
       * part worth keeping.
       */
      return maybeReplan(next, availabilityChanged ? 'availability_changed' : 'settings_changed');
    }

    /**
     * The one action that creates a plan out of nothing.
     *
     * It also sets `configured`, which is the flag every other trigger checks:
     * until the student has asked for a plan once, LockIn does not invent one.
     */
    case 'PLANNER_REBUILD': {
      const configured: AppState = {
        ...state,
        planner: {
          ...state.planner,
          settings: { ...state.planner.settings, configured: true },
        },
      };
      const reason: PlanReason = action.reason ?? (state.planner.plan ? 'manual_rebuild' : 'initial');
      const withPlan = maybeReplan(pruneSkips(configured, todayISO()), reason);
      // `maybeReplan` returns the same state when the plan is unchanged; only
      // announce a plan that actually differs.
      return withPlan === configured
        ? configured
        : log(withPlan, 'plan_generated', 'Study plan updated', {
            reason,
            planVersion: withPlan.planner.plan?.planVersion ?? 0,
          });
    }

    case 'PLANNER_SKIP_ITEM': {
      const exists = state.planner.skips.some(
        (s) =>
          s.sourceType === action.sourceType &&
          s.sourceId === action.sourceId &&
          s.date === action.date,
      );
      if (exists) return state;
      const next: AppState = {
        ...state,
        planner: {
          ...state.planner,
          skips: [
            {
              sourceType: action.sourceType,
              sourceId: action.sourceId,
              date: action.date,
              createdAt: new Date().toISOString(),
            },
            ...state.planner.skips,
          ].slice(0, MAX_PLAN_SKIPS),
        },
      };
      return maybeReplan(
        log(next, 'plan_item_skipped', 'Moved planned work off today', {
          sourceType: action.sourceType,
          date: action.date,
        }),
        'missed_work',
      );
    }

    case 'PLANNER_UNSKIP_ITEM': {
      const skips = state.planner.skips.filter(
        (s) =>
          !(
            s.sourceType === action.sourceType &&
            s.sourceId === action.sourceId &&
            s.date === action.date
          ),
      );
      if (skips.length === state.planner.skips.length) return state;
      return maybeReplan({ ...state, planner: { ...state.planner, skips } }, 'manual_rebuild');
    }

    /**
     * Manual ordering.
     *
     * Applied to the stored plan straight away rather than through a rebuild:
     * reordering is the student's decision about their own evening, and
     * re-running the scheduler could undo it in the same breath.
     */
    case 'PLANNER_SET_ORDER': {
      const order = action.order.slice(0, 40);
      const manualOrders = [
        { date: action.date, order, updatedAt: new Date().toISOString() },
        ...state.planner.manualOrders.filter((m) => m.date !== action.date),
      ].slice(0, 30);

      const plan = state.planner.plan;
      const nextPlan = plan
        ? {
            ...plan,
            days: plan.days.map((d) =>
              d.date === action.date ? { ...d, items: orderItems(d.items, order) } : d,
            ),
          }
        : null;

      return log(
        { ...state, planner: { ...state.planner, manualOrders, plan: nextPlan } },
        'plan_item_moved',
        'Reordered today’s plan',
        { date: action.date },
      );
    }

    case 'PLANNER_SET_LOCK': {
      const lockedDates = action.locked
        ? [...new Set([action.date, ...state.planner.lockedDates])].slice(0, 30)
        : state.planner.lockedDates.filter((d) => d !== action.date);
      return { ...state, planner: { ...state.planner, lockedDates } };
    }

    case 'PLANNER_ACCEPT_FACTOR': {
      const subject = action.subject.trim().slice(0, 120);
      if (!subject || state.planner.acceptedSubjectFactors.includes(subject)) return state;
      return maybeReplan(
        {
          ...state,
          planner: {
            ...state.planner,
            acceptedSubjectFactors: [...state.planner.acceptedSubjectFactors, subject].slice(0, 60),
          },
        },
        'settings_changed',
      );
    }

    case 'PLANNER_REJECT_FACTOR':
      return maybeReplan(
        {
          ...state,
          planner: {
            ...state.planner,
            acceptedSubjectFactors: state.planner.acceptedSubjectFactors.filter(
              (s) => s !== action.subject,
            ),
          },
        },
        'settings_changed',
      );

    default:
      return state;
  }
}
