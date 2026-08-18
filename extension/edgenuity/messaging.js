/**
 * Schema validation for everything crossing a trust boundary in the Edgenuity
 * feature — invariant 6, page data is untrusted.
 *
 * Rebuilt field by field, unknown keys dropped. The surface is small on
 * purpose: a course identity, a name, and three numbers. There is no field
 * here for activity titles, scores or page text, so no amount of hostile
 * markup can push those into storage or the export.
 */
import { LIMITS } from './types.js';

export const EDGENUITY_MSG = {
  /** content script → background: "here is the progress I just read" */
  DETECTION: 'EDGENUITY_DETECTION',
  /** content script → background: "Edgenuity page, nothing readable on it" */
  UNREADABLE: 'EDGENUITY_UNREADABLE',
  /** background → content script: "re-read now" */
  REPARSE: 'EDGENUITY_REPARSE',
};

function str(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function int(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const rounded = Math.round(number);
  return rounded >= 0 && rounded <= max ? rounded : undefined;
}

function validIso(value) {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getFullYear();
  if (year < 2000 || year > 2100) return undefined;
  return date.toISOString();
}

/** Rebuilds one course reading, or returns null. */
export function validateCourseProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const externalCourseId = str(raw.externalCourseId, LIMITS.MAX_ID_LENGTH);
  if (!externalCourseId) return null;

  const progressPercent = int(raw.progressPercent, 100);
  const targetPercent = int(raw.targetPercent, 100);
  const activitiesCompleted = int(raw.activitiesCompleted, LIMITS.MAX_ACTIVITIES);
  const activitiesTotal = int(raw.activitiesTotal, LIMITS.MAX_ACTIVITIES);

  // A count pair is only meaningful whole, and completed can never exceed total.
  const countsValid =
    activitiesCompleted !== undefined &&
    activitiesTotal !== undefined &&
    activitiesTotal > 0 &&
    activitiesCompleted <= activitiesTotal;

  // Nothing measurable survived validation, so there is nothing to report.
  if (progressPercent === undefined && !countsValid) return null;

  return {
    externalCourseId,
    courseName: str(raw.courseName, LIMITS.MAX_COURSE_NAME_LENGTH) || undefined,
    progressPercent,
    targetPercent,
    activitiesCompleted: countsValid ? activitiesCompleted : undefined,
    activitiesTotal: countsValid ? activitiesTotal : undefined,
    readAt: validIso(raw.readAt) || new Date().toISOString(),
  };
}

export function validateEdgenuityMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type !== EDGENUITY_MSG.DETECTION) return null;

  const courses = Array.isArray(raw.courses)
    ? raw.courses
        .slice(0, LIMITS.MAX_COURSES_PER_MESSAGE)
        .map(validateCourseProgress)
        .filter(Boolean)
    : [];
  if (courses.length === 0) return null;

  return {
    type: EDGENUITY_MSG.DETECTION,
    courses,
    readAt: validIso(raw.readAt) || new Date().toISOString(),
  };
}
