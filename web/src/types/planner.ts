/**
 * Smart Study Planner models (Phase 7).
 *
 * Everything here is data, not behaviour: the planning engine in
 * `lib/planner/` is a pure function of this state plus assignments, exams and
 * completed sessions. Nothing in a plan is random, and nothing in a plan is
 * prose — items carry reason *codes* and numeric facts, and
 * `lib/planner/explanations.ts` turns those into the sentences a student reads.
 * That split is what makes "Why this?" honest instead of decorative.
 */

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

/** 0 = Sunday … 6 = Saturday, matching `Date.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const WEEKDAY_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** One row of "when could you study?". Times are local 24h `HH:MM`. */
export interface AvailabilityDay {
  weekday: Weekday;
  available: boolean;
  startTime: string;
  endTime: string;
  /**
   * Hard ceiling on planned minutes for this day, before the buffer.
   * Separate from start/end because "I'm free 4–9 but I'm not doing five hours
   * of homework" is the normal case, not the exception.
   */
  maxMinutes: number;
  /**
   * A rest day is still schedulable in principle, but the planner leaves it
   * empty unless work genuinely cannot fit anywhere else — and says so.
   */
  restDay: boolean;
}

/** A recurring commitment that eats into an available window. */
export interface FixedBlock {
  id: string;
  weekday: Weekday;
  label: string;
  startTime: string;
  endTime: string;
}

export const WORKLOAD_PREFERENCES = ['Light', 'Balanced', 'Intensive'] as const;
export type WorkloadPreference = (typeof WORKLOAD_PREFERENCES)[number];

/**
 * How much of the theoretically available time the planner is willing to fill.
 * This is the "school night workload preference" — a multiplier on capacity,
 * not a personality.
 */
export const WORKLOAD_UTILISATION: Record<WorkloadPreference, number> = {
  Light: 0.6,
  Balanced: 0.8,
  Intensive: 1,
};

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface PlannerSettings {
  /** True once the student has been through planner setup at least once. */
  configured: boolean;
  availability: AvailabilityDay[];
  fixedBlocks: FixedBlock[];
  /** Ceiling for Mon–Fri, applied on top of each day's own `maxMinutes`. */
  weekdayMaxMinutes: number;
  /** Ceiling for Sat/Sun. */
  weekendMaxMinutes: number;
  /** Percentage of available time deliberately left unplanned (0–50). */
  bufferPercent: number;
  focusBlockMinutes: number;
  breakMinutes: number;
  minChunkMinutes: number;
  maxChunkMinutes: number;
  /** Finish assignments this many hours before they are actually due. */
  deadlineBufferHours: number;
  workloadPreference: WorkloadPreference;
  /** How many days ahead the planner looks. */
  horizonDays: number;
  /**
   * Opt-in. When on, subject speed factors learned from finished work adjust
   * the estimates the planner schedules against. Off by default — LockIn does
   * not quietly rewrite the student's own numbers.
   */
  useAdjustedEstimates: boolean;
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export const PLAN_ITEM_STATUSES = [
  'planned',
  'in_progress',
  'completed',
  'missed',
  'rescheduled',
] as const;
export type PlanItemStatus = (typeof PLAN_ITEM_STATUSES)[number];

/**
 * Why an item is where it is. Codes only — the wording lives in
 * `lib/planner/explanations.ts`, so an explanation can never drift from the
 * calculation that produced it.
 */
export const PLANNING_REASON_CODES = [
  'overdue',
  'due_today',
  'due_tomorrow',
  'due_in_days',
  'priority_urgent',
  'priority_important',
  'large_task_needs_early_start',
  'few_opportunities',
  'later_days_full',
  'exam_approaching',
  'exam_spaced_study',
  'exam_final_review',
  'exam_tomorrow',
  'moved_from_missed',
  'moved_from_partial',
  'work_ahead',
  'student_skipped',
  'manual_order',
] as const;
export type PlanningReasonCode = (typeof PLANNING_REASON_CODES)[number];

export interface PlanningReason {
  codes: PlanningReasonCode[];
  /** Numbers the explanation needs. Never prose, never page content. */
  facts: Record<string, number | string | boolean>;
}

export interface PlannedWorkItem {
  /** Deterministic: same inputs produce the same id. */
  id: string;
  sourceType: 'assignment' | 'exam';
  sourceId: string;
  subject: string;
  title: string;
  /** Which chunk of this task it is, 1-based. */
  chunkIndex: number;
  chunkCount: number;
  plannedMinutes: number;
  reason: PlanningReason;
  status: PlanItemStatus;
  /** Local `YYYY-MM-DD`. */
  scheduledDate: string;
  /** Set when a previous plan had this work on a different day. */
  originalScheduledDate?: string;
  priorityScore: number;
  /** Local `HH:MM`, when the day could be laid out on the clock. */
  startTime?: string;
  endTime?: string;
  /** True for the reserved pre-exam review session. */
  finalReview?: boolean;
}

export interface PlannedDay {
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** Minutes the student said they are free, after fixed blocks. */
  availableMinutes: number;
  /** Available minutes minus buffer, capped by the daily maximum. */
  capacityMinutes: number;
  plannedMinutes: number;
  restDay: boolean;
  items: PlannedWorkItem[];
}

export const PLAN_WARNING_KINDS = [
  'day_overloaded',
  'assignment_cannot_fit',
  'exam_under_scheduled',
  'exam_impossible',
  'rest_day_used',
  'no_availability',
  'past_deadline',
] as const;
export type PlanWarningKind = (typeof PLAN_WARNING_KINDS)[number];

/** A calculated problem with the plan. Every field is a number or an id. */
export interface PlanWarning {
  id: string;
  kind: PlanWarningKind;
  severity: 'info' | 'warning' | 'critical';
  sourceType?: 'assignment' | 'exam';
  sourceId?: string;
  title: string;
  date?: string;
  facts: Record<string, number | string | boolean>;
}

export const PLAN_REASONS = [
  'initial',
  'assignment_added',
  'assignment_changed',
  'assignment_completed',
  'assignment_deleted',
  'exam_added',
  'exam_changed',
  'exam_deleted',
  'missed_work',
  'session_logged',
  'availability_changed',
  'settings_changed',
  'manual_rebuild',
  'day_rollover',
] as const;
export type PlanReason = (typeof PLAN_REASONS)[number];

export interface StudyPlan {
  id: string;
  planVersion: number;
  generatedAt: string;
  reason: PlanReason;
  /** Local `YYYY-MM-DD`. */
  planningHorizonStart: string;
  planningHorizonEnd: string;
  days: PlannedDay[];
  warnings: PlanWarning[];
  /** Minutes of real work the planner could not place anywhere. */
  unscheduledMinutes: number;
}

/** One line of plan history. Deliberately tiny — no old plans are kept. */
export interface PlanVersionEntry {
  planVersion: number;
  generatedAt: string;
  reason: PlanReason;
  plannedMinutes: number;
  itemCount: number;
  warningCount: number;
}

export const MAX_PLAN_HISTORY = 20;

/** "I can't do this today" — one source, one date. */
export interface PlanSkip {
  sourceType: 'assignment' | 'exam';
  sourceId: string;
  /** Local `YYYY-MM-DD` the student pushed this off. */
  date: string;
  createdAt: string;
}

/** A day the student reordered by hand. */
export interface PlanManualOrder {
  date: string;
  /** Source keys (`assignment:<id>`) in the order the student chose. */
  order: string[];
  updatedAt: string;
}

export interface PlannerState {
  settings: PlannerSettings;
  plan: StudyPlan | null;
  history: PlanVersionEntry[];
  skips: PlanSkip[];
  manualOrders: PlanManualOrder[];
  /** Dates whose ordering the planner must not rearrange. */
  lockedDates: string[];
  /**
   * Subject speed factors the student explicitly accepted. Learned factors are
   * only ever *suggested* until a subject appears here.
   */
  acceptedSubjectFactors: string[];
  /**
   * What the last day-rollover carried forward.
   *
   * Recorded at the moment of the rollover because it cannot be recovered
   * afterwards: the new plan has no days in the past, so by the time the
   * dashboard renders, the evidence that 75 minutes went unfinished yesterday
   * is gone. This is the only reason the fact is stored rather than derived.
   */
  lastRecovery: PlanRecovery | null;
}

export interface PlanRecovery {
  /** The most recent past date that had unfinished work. */
  date: string;
  unfinishedMinutes: number;
  itemCount: number;
  recordedAt: string;
}

export const MAX_PLAN_SKIPS = 60;

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

/** Weekdays 4:00–8:00 PM, weekends 10:00 AM–6:00 PM. Nothing is a rest day. */
export function defaultAvailability(): AvailabilityDay[] {
  return ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((weekday) => {
    const weekend = weekday === 0 || weekday === 6;
    return {
      weekday,
      available: true,
      startTime: weekend ? '10:00' : '16:00',
      endTime: weekend ? '18:00' : '20:00',
      maxMinutes: weekend ? 180 : 120,
      restDay: false,
    };
  });
}

export function defaultPlannerSettings(): PlannerSettings {
  return {
    configured: false,
    availability: defaultAvailability(),
    fixedBlocks: [],
    weekdayMaxMinutes: 120,
    weekendMaxMinutes: 180,
    // 15% held back for the school day running long, dinner, and the fact that
    // nobody starts the second a timer says so.
    bufferPercent: 15,
    focusBlockMinutes: 25,
    breakMinutes: 5,
    minChunkMinutes: 15,
    maxChunkMinutes: 45,
    deadlineBufferHours: 3,
    workloadPreference: 'Balanced',
    horizonDays: 14,
    useAdjustedEstimates: false,
  };
}

export function defaultPlannerState(): PlannerState {
  return {
    settings: defaultPlannerSettings(),
    plan: null,
    history: [],
    skips: [],
    manualOrders: [],
    lockedDates: [],
    acceptedSubjectFactors: [],
    lastRecovery: null,
  };
}

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

/** Stable key for a planned source, used by manual ordering and skips. */
export function sourceKey(sourceType: 'assignment' | 'exam', sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

export function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}
