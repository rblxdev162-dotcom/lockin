/**
 * Combining what a course report knows with what a progress email knows.
 *
 * ## The problem
 *
 * Two legitimate Edgenuity channels describe the same course, and each is
 * authoritative about different things:
 *
 *   Course name, activity schedule, start/target dates → the course report
 *   Today's completion and target percentages          → the progress email
 *
 * A course object that carried a single `source` would have to lie about one
 * of them. So each field carries its own stamp, and this file decides —
 * per field — whether an incoming value should replace what is already there.
 *
 * ## The rule
 *
 * `preferSource()` decides, and it is the same rule everywhere: live beats
 * imported, then newer beats older, then higher confidence wins. Never
 * "whichever import ran last", which would let a three-week-old report
 * overwrite this morning's percentages.
 *
 * ## What it never does
 *
 * It never creates a second course because two sources spell a name
 * differently, and it never merges two genuinely different courses because
 * their names look similar. Matching is on an external id when there is one,
 * and otherwise on a normalised name — an exact comparison after casing and
 * punctuation are removed, not a fuzzy score.
 */
import type { CourseProgress, FieldValue } from '../../types/integrations';
import type { SourceRecord } from '../../types/source';
import { preferSource } from '../sources/freshness';
import type { ParsedCourseProgress } from './progressEmail';
import type { ParsedCourseReport } from './courseReport';

/** `Algebra I - Semester A ` and `algebra i semester a` are the same course. */
export function courseKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface MergeChange {
  courseName: string;
  field: string;
  /** Rendered for the review screen: "61.7% (was 58.2%)". */
  text: string;
}

export interface MergeResult {
  courses: CourseProgress[];
  changes: MergeChange[];
  /** Courses that did not exist before this merge. */
  created: string[];
}

function setField<T>(
  current: FieldValue<T> | undefined,
  incoming: T | undefined,
  source: SourceRecord,
  now: number,
): { value: FieldValue<T> | undefined; changed: boolean; previous?: T } {
  if (incoming === undefined) return { value: current, changed: false };
  if (!current) return { value: { value: incoming, source }, changed: true };

  const winner = preferSource(current.source, source, now);
  // The incoming source lost: the existing value stays, and so does its stamp.
  // This is the branch that stops a stale re-import from undoing a fresh sync.
  if (winner !== source) return { value: current, changed: false };

  const changed = current.value !== incoming;
  return { value: { value: incoming, source }, changed, previous: current.value };
}

const pct = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;

/**
 * Folds one parsed progress report into the stored courses.
 *
 * Returns new arrays; nothing is mutated, so this is safe to call from a
 * reducer and safe to call twice.
 */
export function mergeProgressEmail(
  courses: CourseProgress[],
  parsed: ParsedCourseProgress[],
  source: SourceRecord,
  now: number,
  reportedAt?: string,
): MergeResult {
  const result: CourseProgress[] = [...courses];
  const changes: MergeChange[] = [];
  const created: string[] = [];
  const nowIso = new Date(now).toISOString();

  for (const incoming of parsed) {
    const key = courseKey(incoming.courseName);
    const index = result.findIndex((c) => courseKey(c.name) === key);

    const base: CourseProgress =
      index >= 0
        ? result[index]
        : {
            id: `course-${key.replace(/\s+/g, '-').slice(0, 48)}`,
            provider: 'edgenuity',
            product: incoming.product,
            name: incoming.courseName,
            activities: [],
            createdAt: nowIso,
            updatedAt: nowIso,
          };

    if (index < 0) created.push(incoming.courseName);

    const actual = setField(base.actualProgressPercent, incoming.actualProgressPercent, source, now);
    const target = setField(base.targetProgressPercent, incoming.targetProgressPercent, source, now);
    const overall = setField(base.overallGrade, incoming.overallGrade, source, now);
    const actualGrade = setField(base.actualGrade, incoming.actualGrade, source, now);
    const relative = setField(base.relativeGrade, incoming.relativeGrade, source, now);
    const start = setField(base.startDate, incoming.startDate, source, now);
    const end = setField(base.targetEndDate, incoming.targetEndDate, source, now);

    if (actual.changed && actual.value) {
      changes.push({
        courseName: base.name,
        field: 'Progress',
        text:
          actual.previous === undefined
            ? pct(actual.value.value)
            : `${pct(actual.value.value)} (was ${pct(actual.previous)})`,
      });
    }
    if (target.changed && target.value) {
      changes.push({ courseName: base.name, field: 'Target', text: pct(target.value.value) });
    }

    const merged: CourseProgress = {
      ...base,
      // A product that identifies itself outranks an earlier UNKNOWN, and
      // nothing ever downgrades a known product back to UNKNOWN.
      product: incoming.product !== 'UNKNOWN' ? incoming.product : base.product,
      actualProgressPercent: actual.value,
      targetProgressPercent: target.value,
      overallGrade: overall.value,
      actualGrade: actualGrade.value,
      relativeGrade: relative.value,
      startDate: start.value,
      targetEndDate: end.value,
      reportedAt: reportedAt ?? base.reportedAt,
      updatedAt: nowIso,
    };

    if (index >= 0) result[index] = merged;
    else result.push(merged);
  }

  return { courses: result, changes, created };
}

/**
 * Folds a course report in.
 *
 * The activity list is replaced wholesale rather than merged item by item: a
 * report is a complete statement of the schedule at the moment it was
 * generated, and stitching an old list into a new one produces activities that
 * exist in neither. Completion flags the new report does not state are left
 * undefined, exactly as the parser produced them.
 */
export function mergeCourseReport(
  courses: CourseProgress[],
  parsed: ParsedCourseReport,
  courseName: string,
  source: SourceRecord,
  now: number,
): MergeResult {
  const result: CourseProgress[] = [...courses];
  const changes: MergeChange[] = [];
  const created: string[] = [];
  const nowIso = new Date(now).toISOString();

  const key = courseKey(courseName);
  const index = result.findIndex((c) => courseKey(c.name) === key);

  const base: CourseProgress =
    index >= 0
      ? result[index]
      : {
          id: `course-${key.replace(/\s+/g, '-').slice(0, 48)}`,
          provider: 'edgenuity',
          product: parsed.product,
          name: courseName,
          activities: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        };
  if (index < 0) created.push(courseName);

  const previousCount = base.activities.length;
  const newNames = new Set(base.activities.map((a) => a.id));
  const added = parsed.activities.filter((a) => !newNames.has(a.id));
  const completed = parsed.activities.filter((a) => a.completed === true).length;

  if (added.length > 0) {
    changes.push({
      courseName: base.name,
      field: 'New activities',
      text: added
        .slice(0, 3)
        .map((a) => a.name)
        .join(', ') + (added.length > 3 ? ` and ${added.length - 3} more` : ''),
    });
  }
  if (previousCount > 0 && completed > 0) {
    changes.push({
      courseName: base.name,
      field: 'Completed',
      text: `${completed} of ${parsed.activities.length} activities`,
    });
  }

  const actual = setField(base.actualProgressPercent, parsed.actualProgressPercent, source, now);
  const target = setField(base.targetProgressPercent, parsed.targetProgressPercent, source, now);

  const merged: CourseProgress = {
    ...base,
    product: parsed.product !== 'UNKNOWN' ? parsed.product : base.product,
    activities: parsed.activities,
    activitySource: source,
    actualProgressPercent: actual.value,
    targetProgressPercent: target.value,
    reportedAt: parsed.reportedAt ?? base.reportedAt,
    updatedAt: nowIso,
  };

  if (index >= 0) result[index] = merged;
  else result.push(merged);

  return { courses: result, changes, created };
}

/**
 * Which source owns which field, for the UI.
 *
 * The Integrations and Progress pages both want to say "progress from this
 * morning's email, schedule from a report three days ago" without either of
 * them re-deriving it.
 */
export function fieldProvenance(course: CourseProgress): { label: string; source?: SourceRecord }[] {
  return [
    { label: 'Course name', source: course.activitySource ?? course.actualProgressPercent?.source },
    { label: 'Current progress', source: course.actualProgressPercent?.source },
    { label: 'Target progress', source: course.targetProgressPercent?.source },
    { label: 'Activity schedule', source: course.activitySource },
  ].filter((row) => row.source !== undefined);
}
