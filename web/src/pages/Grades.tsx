/**
 * Grades — every class, and what LockIn actually knows about each one.
 *
 * ## The rule this page is built on
 *
 * **Nothing here is computed.** Every percentage was printed on a Canvas
 * Grades page the student opened; LockIn copied it down with a timestamp. When
 * Canvas publishes no total, this page says so rather than averaging the
 * assignments it happens to have — an invented grade is most wrong exactly
 * when a student most needs it to be right (invariant 26).
 *
 * ## What each card shows, in order
 *
 * 1. The class, and its current grade as Canvas gave it.
 * 2. How old that reading is. A grade is a snapshot, never a live figure.
 * 3. The marked work behind it, newest first, with score / points.
 *
 * Lowest grade first: the class that needs attention belongs at the top, the
 * same reasoning that puts the most urgent column on the left in Assignments.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/context';
import { Card, EmptyState } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { Badge } from '../components/ui/Badge';
import { SectionHeader } from '../components/ui/Status';
import { CheckCanvasButton } from '../components/features/CheckCanvasButton';
import { formatScore, hasPublishedTotal, sortGrades } from '../types/grades';
import type { CourseGrade } from '../types/grades';
import { WORK_STATE_LABEL, WORK_STATE_TONE, workStateOf } from '../lib/workState';
import { relativeTime } from '../lib/time';
import { cx } from '../lib/cx';
import type { Assignment } from '../types';

export function Grades() {
  const { state, now } = useApp();
  const grades = useMemo(() => sortGrades(state.grades.courses), [state.grades.courses]);

  /** Marked work, grouped by the Canvas course it belongs to. */
  const markedByCourse = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const assignment of state.assignments) {
      const courseId = assignment.externalCourseId;
      if (!courseId) continue;
      if (assignment.canvas?.score === undefined && assignment.canvas?.scoreText === undefined) {
        continue;
      }
      const list = map.get(courseId);
      if (list) list.push(assignment);
      else map.set(courseId, [assignment]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (b.canvas?.lastCheckedAt ?? '').localeCompare(a.canvas?.lastCheckedAt ?? ''));
    }
    return map;
  }, [state.assignments]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-extrabold lk-strong">Grades</h1>
          <p className="mt-1 text-body lk-muted">
            Read from your own Canvas Grades page. LockIn never works a grade out for itself.
          </p>
        </div>
        <CheckCanvasButton showStatus={false} />
      </header>

      {grades.length === 0 ? (
        <EmptyState
          icon={<Icon name="badge" size={28} />}
          title="No grades read yet"
          hint="Open Canvas, go to Grades — either the all-courses list or one class — and press Check Canvas. LockIn reads the page you have open and never opens Canvas itself."
          action={<CheckCanvasButton size="md" />}
        />
      ) : (
        <>
          <p className="text-caption lk-muted">
            {state.grades.lastReadAt
              ? `Last read ${relativeTime(state.grades.lastReadAt, new Date(now))}.`
              : 'Not read yet.'}{' '}
            These are snapshots, not live figures.
          </p>

          <div className="space-y-4">
            {grades.map((grade) => (
              <GradeCard
                key={grade.externalCourseId}
                grade={grade}
                assignments={markedByCourse.get(grade.externalCourseId) ?? []}
                now={now}
              />
            ))}
          </div>
        </>
      )}

      <section aria-labelledby="grades-honesty">
        <SectionHeader id="grades-honesty" title="Where these numbers come from" />
        <Card>
          <ul className="space-y-2 text-body lk-muted">
            <li>
              Every figure was printed on a Canvas page you opened yourself. LockIn makes no
              request to Canvas and never opens it for you.
            </li>
            <li>
              A class shows “Canvas isn’t publishing a total” when your teacher has totals turned
              off. LockIn will not estimate one.
            </li>
            <li>
              Checks are refused during your school hours — change that in{' '}
              <Link to="/settings" className="font-semibold lk-strong underline">
                Settings → Canvas checks
              </Link>
              .
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}

function GradeCard({
  grade,
  assignments,
  now,
}: {
  grade: CourseGrade;
  assignments: Assignment[];
  now: number;
}) {
  const published = hasPublishedTotal(grade);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-heading font-bold lk-strong">
            {grade.courseName || `Course ${grade.externalCourseId}`}
          </h2>
          <p className="mt-0.5 text-caption lk-muted">
            Read {relativeTime(grade.readAt, new Date(now))}
            {grade.totalsHiddenSince && ' · Canvas has since stopped publishing a total'}
          </p>
        </div>

        <div className="text-right">
          {published ? (
            <>
              <p className="text-display font-extrabold tabular-nums lk-strong">
                {grade.currentScore !== null ? formatScore(grade.currentScore) : grade.currentGrade}
              </p>
              {grade.currentScore !== null && grade.currentGrade && (
                <p className="text-caption font-bold lk-muted">{grade.currentGrade}</p>
              )}
            </>
          ) : (
            <p className="max-w-[16rem] text-caption lk-muted">
              Canvas isn’t publishing a total for this class.
            </p>
          )}
        </div>
      </div>

      {assignments.length > 0 && (
        <ul className="mt-4 divide-y lk-border border-t lk-border">
          {assignments.slice(0, 8).map((assignment) => {
            const workState = workStateOf(assignment, now);
            return (
              <li key={assignment.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold lk-strong">{assignment.title}</p>
                  <p className={cx('text-caption', WORK_STATE_TONE[workState])}>
                    <span className="lk-status-text">{WORK_STATE_LABEL[workState]}</span>
                  </p>
                </div>
                <p className="shrink-0 text-body font-bold tabular-nums lk-strong">
                  {assignment.canvas?.scoreText ?? assignment.canvas?.score}
                  {assignment.canvas?.pointsPossible !== undefined && (
                    <span className="lk-muted"> / {assignment.canvas.pointsPossible}</span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {assignments.length === 0 && (
        <p className="mt-3 text-caption lk-muted">
          No marked work read for this class yet. Open the class’s own Grades page and press Check
          Canvas to fill this in.
        </p>
      )}

      {grade.url && (
        <p className="mt-3">
          <Badge tone="neutral">
            <a href={grade.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
              Open in Canvas <Icon name="external" size={12} />
            </a>
          </Badge>
        </p>
      )}
    </Card>
  );
}
