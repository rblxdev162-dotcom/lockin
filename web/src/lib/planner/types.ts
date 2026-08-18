/**
 * Engine-internal types for the Smart Study Planner.
 *
 * The persisted models live in `types/planner.ts`; these are the working
 * shapes the pure scheduler passes between its stages. Nothing here is stored.
 */
import type {
  Assignment,
  CompletedSession,
  Exam,
  PlanManualOrder,
  PlanReason,
  PlanSkip,
  PlannerSettings,
  StudyPlan,
} from '../../types';

/**
 * Everything the engine is allowed to look at.
 *
 * `now` is an input rather than something the engine reads from the clock:
 * that is what makes "same state and settings ⇒ same plan" testable, and it is
 * why every date in here is a local `YYYY-MM-DD` string rather than a UTC
 * instant that would slide across midnight.
 */
export interface PlannerInputs {
  now: Date;
  assignments: Assignment[];
  exams: Exam[];
  completedSessions: CompletedSession[];
  settings: PlannerSettings;
  skips: PlanSkip[];
  manualOrders: PlanManualOrder[];
  lockedDates: string[];
  /** Subjects whose learned speed factor the student opted into. */
  acceptedSubjectFactors: string[];
  /** Used only to fill in `originalScheduledDate`; never to constrain. */
  previousPlan: StudyPlan | null;
  reason: PlanReason;
  planVersion: number;
}

/** A contiguous stretch of free clock time on one day. */
export interface TimeWindow {
  /** Minutes since local midnight. */
  start: number;
  end: number;
}

export interface DayCapacity {
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  windows: TimeWindow[];
  /** Sum of the windows above. */
  availableMinutes: number;
  /** What the planner will actually fill: available, minus buffer, capped. */
  capacityMinutes: number;
  restDay: boolean;
  /** The capacity this day would have had if it were not a rest day. */
  restDayCapacityMinutes: number;
}

/** One thing that needs work, normalised across assignments and exams. */
export interface WorkTask {
  key: string;
  sourceType: 'assignment' | 'exam';
  sourceId: string;
  title: string;
  subject: string;
  /** Minutes of work still to do, after logged time and speed adjustment. */
  remainingMinutes: number;
  /** The raw estimate before any subject speed factor. */
  rawEstimateMinutes: number;
  /** Minutes already logged against this task. */
  loggedMinutes: number;
  /** Last local date this work may be scheduled on. */
  lastUsableDate: string;
  /** The real deadline, for explanations: due date / exam date. */
  deadlineDate: string;
  deadlineTime?: string;
  overdue: boolean;
  priority: 'Normal' | 'Important' | 'Urgent';
  createdAt: string;
  /** Exams only: the spacing ceiling per day, and the reserved review length. */
  maxMinutesPerDay?: number;
  finalReviewMinutes?: number;
}

/** Live allocation bookkeeping for one task. */
export interface TaskProgressState {
  task: WorkTask;
  remaining: number;
  chunkIndex: number;
  /** Minutes already placed on each date, keyed by `YYYY-MM-DD`. */
  perDate: Map<string, number>;
  /** Sessions already placed on each date — capped so a day stays realistic. */
  perDateCount: Map<string, number>;
}
