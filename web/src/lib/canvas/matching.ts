/**
 * Deciding which LockIn assignment a detected Canvas assignment belongs to.
 *
 * Two separate jobs:
 *   findLinked()     — exact identity match. Used for status updates and to
 *                      stop repeat visits creating duplicates.
 *   suggestMatches() — fuzzy *suggestions* for linking a manually created
 *                      assignment. These are only ever shown to the student;
 *                      nothing is linked without an explicit confirmation.
 */
import type { Assignment } from '../../types';
import type { CanvasDetectedAssignment } from '../../types/canvas';
import { canvasKey } from '../../types/canvas';
import { parseDueDate } from '../time';

/** The stored identity of an assignment's Canvas link, or null. */
export function assignmentCanvasKey(a: Assignment): string | null {
  if (!a.canvas || !a.externalCourseId || !a.externalAssignmentId) return null;
  return canvasKey(a.canvas.domain, a.externalCourseId, a.externalAssignmentId);
}

export function detectedCanvasKey(
  domain: string,
  detected: Pick<CanvasDetectedAssignment, 'externalCourseId' | 'externalAssignmentId'>,
): string {
  return canvasKey(domain, detected.externalCourseId, detected.externalAssignmentId);
}

/**
 * Exact identity lookup: host + course + assignment. Titles are never used —
 * this is what makes re-visiting Canvas idempotent.
 */
export function findLinked(
  assignments: Assignment[],
  domain: string,
  detected: Pick<CanvasDetectedAssignment, 'externalCourseId' | 'externalAssignmentId'>,
): Assignment | undefined {
  const key = detectedCanvasKey(domain, detected);
  return assignments.find((a) => assignmentCanvasKey(a) === key);
}

/* ------------------------------------------------------------------ */
/* Suggestions (never automatic)                                       */
/* ------------------------------------------------------------------ */

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string): Set<string> {
  // Drop filler words so "Chapter 7 Homework" still matches "Ch 7 HW".
  const stop = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'assignment']);
  return new Set(
    normalizeTitle(value)
      .split(' ')
      .filter((t) => t.length > 1 && !stop.has(t)),
  );
}

/** Jaccard overlap of title tokens, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

export interface MatchSuggestion {
  assignment: Assignment;
  /** 0..1 — how confident the heuristic is. */
  score: number;
  reasons: string[];
}

/**
 * Ranks existing unlinked assignments against one detected Canvas assignment.
 * Deterministic: same inputs always produce the same ordering.
 */
export function suggestMatches(
  assignments: Assignment[],
  detected: CanvasDetectedAssignment,
  limit = 5,
): MatchSuggestion[] {
  const detectedDue = detected.dueAt ? new Date(detected.dueAt) : null;

  const scored = assignments
    // Never suggest something already linked to a different Canvas assignment.
    .filter((a) => !a.canvas)
    .map((a) => {
      const reasons: string[] = [];
      let score = 0;

      const titleScore = titleSimilarity(a.title, detected.title);
      if (titleScore > 0) {
        score += titleScore * 0.6;
        if (titleScore >= 0.5) reasons.push('Similar title');
      }

      if (detectedDue && a.dueDate) {
        const own = parseDueDate(a.dueDate, a.dueTime);
        if (own) {
          const sameDay =
            own.getFullYear() === detectedDue.getFullYear() &&
            own.getMonth() === detectedDue.getMonth() &&
            own.getDate() === detectedDue.getDate();
          if (sameDay) {
            score += 0.3;
            reasons.push('Same due date');
          }
        }
      }

      if (
        detected.courseName &&
        a.subject &&
        titleSimilarity(a.subject, detected.courseName) >= 0.34
      ) {
        score += 0.1;
        reasons.push('Similar course');
      }

      if (a.platform === 'Canvas') {
        score += 0.05;
        reasons.push('Marked as Canvas work');
      }

      return { assignment: a, score: Math.min(1, score), reasons };
    })
    .filter((s) => s.score > 0.15)
    .sort((x, y) => y.score - x.score || x.assignment.title.localeCompare(y.assignment.title));

  return scored.slice(0, limit);
}

/** Suggestions strong enough to pre-highlight — still requires confirmation. */
export function isStrongMatch(suggestion: MatchSuggestion): boolean {
  return suggestion.score >= 0.65;
}
