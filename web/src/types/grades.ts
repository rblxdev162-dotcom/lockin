/**
 * Class grades, exactly as they were printed on the page the student opened.
 *
 * ## What this is not
 *
 * It is not a gradebook, and LockIn never computes a grade. Every number here
 * was read off a Canvas Grades page the student navigated to themselves; if
 * Canvas didn't publish a total for a class, that is recorded as
 * `totalsHidden` and shown as "Canvas isn't publishing a total for this
 * class". Inventing a percentage from the assignments LockIn happens to know
 * about would produce a number that is wrong in exactly the situation a
 * student cares most about (invariant 26).
 *
 * `readAt` is the whole honesty mechanism: a grade is a snapshot, and the UI
 * always says how old the snapshot is rather than implying it is live.
 */

export interface CourseGrade {
  /** Canvas course id — the identity, never the name. */
  externalCourseId: string;
  /** What Canvas called the class on the page. */
  courseName?: string;
  /** Percentage, e.g. 93.75. Null when Canvas published no total. */
  currentScore: number | null;
  /** Letter or pass/fail wording, when Canvas showed one. */
  currentGrade: string | null;
  /** True when Canvas published neither a percent nor a letter. */
  totalsHidden: boolean;
  /** ISO timestamp of the page read this came from. */
  readAt: string;
  /**
   * Set when a later read found the total hidden but an earlier one had a real
   * number. The old figure is kept and dated rather than blanked — absence is
   * not news about the student (invariant 27).
   */
  totalsHiddenSince?: string;
  /** The Canvas page it was read from, for "open in Canvas". */
  url?: string;
}

export interface GradesState {
  /** One entry per class, keyed in the reducer by `externalCourseId`. */
  courses: CourseGrade[];
  /** When any Grades page was last read. Null until the first Check Canvas. */
  lastReadAt: string | null;
}

export function defaultGradesState(): GradesState {
  return { courses: [], lastReadAt: null };
}

/** A grade worth showing: something was published, however old. */
export function hasPublishedTotal(grade: CourseGrade): boolean {
  return grade.currentScore !== null || grade.currentGrade !== null;
}

/**
 * The one place a percentage becomes text.
 *
 * One decimal place, and never rounded up to a boundary that changes the
 * letter — 89.95% is shown as 89.9%, because a student reading "90%" and being
 * told otherwise by Canvas has been misled by LockIn.
 */
export function formatScore(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return '—';
  const truncated = Math.floor(score * 10) / 10;
  return `${truncated % 1 === 0 ? truncated.toFixed(0) : truncated.toFixed(1)}%`;
}

/**
 * Lowest grade first, hidden totals last, then by name so the order is stable.
 *
 * The class that needs attention belongs at the top — the same reasoning as
 * `groupByClass` in `lib/workState.ts`, where the column you need is the one
 * on the left. A leaderboard of your best subjects is not a study tool.
 */
export function sortGrades(grades: CourseGrade[]): CourseGrade[] {
  return [...grades].sort((a, b) => {
    const aHas = hasPublishedTotal(a);
    const bHas = hasPublishedTotal(b);
    if (aHas !== bHas) return aHas ? -1 : 1;
    const aScore = a.currentScore ?? -1;
    const bScore = b.currentScore ?? -1;
    if (aScore !== bScore) return aScore - bScore;
    return (a.courseName ?? '').localeCompare(b.courseName ?? '');
  });
}
