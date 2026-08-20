/**
 * Folding a freshly-read feed into the assignments LockIn already has.
 *
 * Pure. It decides *what should change* and returns a diff; the reducer is the
 * only thing that changes anything. That split is what makes this testable
 * against a hundred fixtures without a store, and it is why a re-sync is
 * idempotent — running the same feed twice produces an empty diff.
 *
 * ## The four rules
 *
 * 1. **Identity is the UID.** Same UID, same assignment, forever. A changed
 *    title is a rename, not a new assignment.
 * 2. **A moved date updates; it never duplicates.** This is the single most
 *    common feed change and the easiest to get wrong.
 * 3. **The student's own work is never overwritten.** Status, logged minutes,
 *    the estimate, the priority and any manual edits survive every sync. The
 *    feed owns the title, the due date and the link. Nothing else.
 * 4. **Absence means nothing.** An item that stops appearing is left exactly
 *    as it was. Only an explicit `STATUS:CANCELLED` marks anything, and even
 *    that never marks it complete.
 */
import type { Assignment } from '../../types';
import type { FeedItem } from './calendarFeed';
import { feedSource, prettyCourseName } from './calendarFeed';

export interface FeedUpdate {
  assignmentId: string;
  patch: Partial<Assignment>;
  /** Human-readable, for the review screen: "Due date moved to Friday". */
  changes: string[];
}

export interface FeedCancellation {
  assignmentId: string;
  title: string;
}

export interface FeedDiff {
  /** Items with no counterpart in LockIn yet. */
  create: FeedItem[];
  update: FeedUpdate[];
  cancel: FeedCancellation[];
  /** Items already correct. Counted, not listed — nobody reads that list. */
  unchanged: number;
}

/**
 * Finds the assignment an item already belongs to.
 *
 * Two keys, in strict order of reliability, and no fuzzy fallback:
 *
 *  1. the feed UID recorded on a previous import;
 *  2. Canvas's own assignment id, which is how an item imported from a *page*
 *     detection (Phase 3) or a future OAuth sync is recognised as the same
 *     work rather than imported a second time.
 *
 * Title matching is deliberately absent. Two assignments called "Quiz 3" in
 * different courses are not the same assignment, and silently merging them
 * loses one.
 */
export function findExisting(item: FeedItem, assignments: Assignment[]): Assignment | undefined {
  const byUid = assignments.find((a) => a.source?.externalId === item.externalId);
  if (byUid) return byUid;

  if (item.externalAssignmentId) {
    // `externalAssignmentId` is where both the page detector (Phase 3) and
    // this feed record Canvas's own id, which is what stops a page-detected
    // assignment and its feed twin from becoming two rows.
    return assignments.find((a) => a.externalAssignmentId === item.externalAssignmentId);
  }
  return undefined;
}

/** A friendly day name for the review screen: "Fri 13 Mar". */
function prettyDate(date: string, time: string): string {
  const parsed = new Date(`${date}T${time || '23:59'}`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export interface ReconcileOptions {
  /** Which feed produced these items — part of the provenance stamp. */
  sourceId: string;
  /** ISO of this sync. */
  syncedAt: string;
  /** Whether the feed was fetched live (versus imported from a file). */
  live: boolean;
  /**
   * Include non-assignment calendar events. Off by default: a class period
   * that repeats every day is not homework, and importing it as homework is
   * how a planner fills with things nobody has to do.
   */
  includeEvents?: boolean;
}

export function reconcileFeed(
  items: FeedItem[],
  assignments: Assignment[],
  options: ReconcileOptions,
): FeedDiff {
  const diff: FeedDiff = { create: [], update: [], cancel: [], unchanged: 0 };

  for (const item of items) {
    if (item.kind === 'event' && !options.includeEvents) continue;

    const existing = findExisting(item, assignments);

    if (!existing) {
      // A cancelled item LockIn never had is simply not news.
      if (!item.cancelled) diff.create.push(item);
      continue;
    }

    if (item.cancelled) {
      // Cancelled means the teacher withdrew it. It is flagged for the student
      // to decide about — never deleted, because work already logged against
      // it is real, and never completed, because nobody did it.
      diff.cancel.push({ assignmentId: existing.id, title: existing.title });
      continue;
    }

    const patch: Partial<Assignment> = {};
    const changes: string[] = [];

    if (existing.dueDate !== item.dueDate || existing.dueTime !== item.dueTime) {
      patch.dueDate = item.dueDate;
      patch.dueTime = item.dueTime;
      changes.push(`Due date moved to ${prettyDate(item.dueDate, item.dueTime)}`);
    }

    // A renamed assignment keeps its identity and its logged time. The title
    // is the feed's to own; everything the student did against it is not.
    if (existing.title !== item.title) {
      patch.title = item.title;
      changes.push(`Renamed to “${item.title}”`);
    }

    // The subject is filled in when LockIn does not have a real one. `General`
    // counts as not having one: it is the placeholder `createAssignment` uses,
    // and work imported before the feed parser understood a course name is
    // sitting under it. Anything the student typed themselves is left alone.
    const placeholder = !existing.subject || existing.subject === 'General';
    // Also healed: a subject that is the *raw* form of the same course name,
    // stored before the feed parser learned to tidy section codes. Comparing
    // through `prettyCourseName` makes that precise — it can only ever match
    // the un-tidied version of this exact course, never a name the student
    // chose.
    const staleRawName =
      !!existing.subject && prettyCourseName(existing.subject) === item.courseName;
    if (item.courseName && (placeholder || staleRawName) && existing.subject !== item.courseName) {
      patch.subject = item.courseName;
      changes.push(`Class set to ${item.courseName}`);
    }

    // The provenance stamp is refreshed on every sync even when nothing else
    // changed — that is what stops perfectly good data from ageing into STALE
    // while the feed is answering fine. It is not counted as a change, because
    // "your assignment changed" would be a lie.
    const source = feedSource(options.sourceId, item.externalId, options.syncedAt, options.live);
    if (changes.length === 0) {
      diff.unchanged += 1;
      diff.update.push({ assignmentId: existing.id, patch: { source }, changes: [] });
      continue;
    }

    patch.source = source;
    // Canvas's numeric id is worth recording the first time it is seen: it is
    // the key a future authorized sync would use to recognise this same work.
    if (item.externalAssignmentId && !existing.externalAssignmentId) {
      patch.externalAssignmentId = item.externalAssignmentId;
    }
    diff.update.push({ assignmentId: existing.id, patch, changes });
  }

  return diff;
}

/** True when a diff would actually do something worth showing a screen for. */
export function diffIsInteresting(diff: FeedDiff): boolean {
  return diff.create.length > 0 || diff.cancel.length > 0 || diff.update.some((u) => u.changes.length > 0);
}

/** One line summarising a diff, for a toast or a callout. */
export function describeDiff(diff: FeedDiff): string {
  const parts: string[] = [];
  if (diff.create.length > 0) parts.push(`${diff.create.length} new`);
  const changed = diff.update.filter((u) => u.changes.length > 0).length;
  if (changed > 0) parts.push(`${changed} updated`);
  if (diff.cancel.length > 0) parts.push(`${diff.cancel.length} cancelled`);
  if (parts.length === 0) return 'Everything is already up to date.';
  return parts.join(' · ');
}
