/**
 * Which Canvas classes need a rendered-page refresh.
 *
 * Pure and intentionally small: this module chooses numeric course ids. The
 * extension owns every browser action and re-checks configuration, permission,
 * and the automatic school-hours gate before it opens anything.
 */
import type { Assignment } from '../../types';
import type { FeedItem } from './calendarFeed';

function courseIdFromCanvasUrl(url: string | undefined, expectedDomain: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!expectedDomain || parsed.protocol !== 'https:' || parsed.hostname !== expectedDomain) {
      return null;
    }
    const match = parsed.pathname.match(/^\/courses\/(\d+)(?:\/|$)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Completed work is out. Feed-only work can still contribute its course id
 * from its Canvas link before the first rendered-page detection attaches that
 * id to the local assignment. The extension retains this stable active roster
 * and chooses the least recently read class once per fifteen-minute tick,
 * reading that class's gradebook and its Assignments page (the one carrying
 * submitted / missing / late per row).
 */
export function canvasCourseIdsNeedingRead(
  assignments: Assignment[],
  feedItems: FeedItem[],
  expectedDomain: string | null = null,
): string[] {
  const ids = new Set<string>();
  const byExternalId = new Map(
    assignments
      .filter((assignment) => assignment.externalAssignmentId)
      .map((assignment) => [assignment.externalAssignmentId!, assignment]),
  );
  const needsRead = (assignment: Assignment | undefined) => {
    if (!assignment) return true;
    return assignment.status !== 'Completed';
  };

  for (const assignment of assignments) {
    if (!needsRead(assignment)) continue;
    if (/^\d{1,32}$/.test(assignment.externalCourseId ?? '')) {
      ids.add(assignment.externalCourseId!);
    }
  }
  for (const item of feedItems) {
    if (item.kind !== 'assignment' || item.cancelled) continue;
    if (
      !needsRead(item.externalAssignmentId ? byExternalId.get(item.externalAssignmentId) : undefined)
    ) {
      continue;
    }
    const courseId = courseIdFromCanvasUrl(item.url, expectedDomain);
    if (courseId) ids.add(courseId);
  }
  return [...ids].slice(0, 20);
}
