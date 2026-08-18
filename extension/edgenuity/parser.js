/**
 * Reading course progress off an Edgenuity page.
 *
 * STRICTLY READ ONLY. Nothing here clicks, submits, navigates, or issues a
 * request. It reads what the student's own navigation already rendered, and
 * takes exactly three things from it: a course identity, how many activities
 * are complete, and the percentage the course itself reports.
 *
 * Why this parser looks nothing like `canvas/parser.js`:
 *
 * Canvas is open source, so its markup is knowable and stable, and that parser
 * can name real selectors. Edgenuity's markup is unpublished and behind a
 * login — any class name written here would be a guess, and a guess that
 * *happened* to match would be worse than one that failed, because it could
 * silently verify the wrong number. So this reads only contracts that hold
 * regardless of markup:
 *
 *   1. ARIA. A progress bar that is accessible at all exposes `role` and
 *      `aria-valuenow`; Edgenuity ships to US school districts under Section
 *      508 / WCAG procurement rules, so this is the likeliest stable handle.
 *   2. Rendered text. "12 of 40 activities" reads the same whatever draws it.
 *
 * Both are checked, and when they disagree the page is reported unreadable —
 * invariant 3, asymmetric safety. A missed read costs one manual capture; a
 * wrong read unlocks distractions on work nobody did.
 */
import { LIMITS } from './types.js';
import { courseIdFromUrl } from './urls.js';

/** Text within this many characters of a number can label it. */
const LABEL_WINDOW = 48;
/** innerText beyond this is not searched. Bounds work on a pathological page. */
const MAX_TEXT_LENGTH = 200000;
/** A page with more progress bars than this is not a course page. */
const MAX_PROGRESSBARS = 40;

const PROGRESS_WORDS = /progress|complete|completed|finished/i;

function clean(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function inRange(value, max) {
  return Number.isFinite(value) && value >= 0 && value <= max;
}

/**
 * The percentage from an accessible progress bar, or null.
 *
 * Requires the bar to describe itself as progress — a page can carry progress
 * bars for uploads, video playback or password strength, and none of those are
 * course completion.
 */
export function readProgressBar(doc) {
  let nodes;
  try {
    nodes = doc.querySelectorAll('[role="progressbar"], progress');
  } catch {
    return null;
  }
  if (!nodes || nodes.length === 0 || nodes.length > MAX_PROGRESSBARS) return null;

  const found = [];
  for (const node of nodes) {
    const label = clean(
      [
        node.getAttribute?.('aria-label'),
        node.getAttribute?.('title'),
        node.parentElement?.textContent,
      ]
        .filter(Boolean)
        .join(' '),
      300,
    );
    if (!PROGRESS_WORDS.test(label)) continue;

    const now = Number(node.getAttribute?.('aria-valuenow') ?? node.value);
    const max = Number(node.getAttribute?.('aria-valuemax') ?? node.max ?? 100);
    if (!inRange(now, 100000) || !(max > 0)) continue;

    const percent = Math.round((now / max) * 100);
    if (inRange(percent, 100)) found.push(percent);
  }

  // Several *different* progress bars claim to be course progress: no way to
  // tell which, so no answer.
  const distinct = [...new Set(found)];
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * "12 of 40 activities" / "12/40 activities completed" → {completed, total}.
 *
 * The activity pair is preferred over the percentage for targets, because
 * Edgenuity's own percentage is time-weighted ("completed assignments versus
 * total assignments weighted by the estimated time"), so it moves
 * non-linearly and +3% means different work in different courses.
 */
export function readActivityCounts(text) {
  const pairs = [];
  const pattern =
    /(\d{1,4})\s*(?:of|\/|out of)\s*(\d{1,4})\s*(?:activities|activity|lessons|assignments)/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const completed = Number(match[1]);
    const total = Number(match[2]);
    if (!inRange(completed, LIMITS.MAX_ACTIVITIES) || !inRange(total, LIMITS.MAX_ACTIVITIES)) {
      continue;
    }
    if (total === 0 || completed > total) continue;
    pairs.push({ completed, total });
  }

  const distinct = [...new Set(pairs.map((p) => `${p.completed}/${p.total}`))];
  return distinct.length === 1 ? pairs[0] : null;
}

/**
 * A percentage that the surrounding text labels as progress, or null.
 * Used only to corroborate `readProgressBar`, never on its own — bare "43%"
 * on a course page is at least as likely to be a grade.
 */
export function readLabelledPercent(text) {
  const found = [];
  const pattern = /(\d{1,3})\s*%/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const value = Number(match[1]);
    if (!inRange(value, 100)) continue;
    const from = Math.max(0, match.index - LABEL_WINDOW);
    const context = text.slice(from, match.index + match[0].length + LABEL_WINDOW);
    if (PROGRESS_WORDS.test(context)) found.push(value);
  }
  const distinct = [...new Set(found)];
  return distinct.length === 1 ? distinct[0] : null;
}

/** The course's own name, from the page heading or title. Never invented. */
export function readCourseName(doc) {
  const heading = doc.querySelector?.('h1, [role="heading"][aria-level="1"]');
  const fromHeading = clean(heading?.textContent, LIMITS.MAX_COURSE_NAME_LENGTH);
  if (fromHeading) return fromHeading;
  // Page titles are usually "<Course> | Imagine Edgenuity" — keep the left part.
  const title = clean(doc.title, LIMITS.MAX_COURSE_NAME_LENGTH * 2);
  const left = title.split(/[|–—]/)[0];
  return clean(left, LIMITS.MAX_COURSE_NAME_LENGTH);
}

/**
 * @returns {{ readable: boolean, pageKind: string, reason?: string,
 *             course?: { externalCourseId, courseName, progressPercent,
 *                        activitiesCompleted, activitiesTotal } }}
 */
export function parseEdgenuityPage(doc, url) {
  const text = clean(doc.body?.innerText || doc.body?.textContent || '', MAX_TEXT_LENGTH);

  const barPercent = readProgressBar(doc);
  const textPercent = readLabelledPercent(text);
  const counts = readActivityCounts(text);

  // Two independent readings that disagree mean the page was misread, not that
  // one of them is right. Refuse rather than pick.
  if (barPercent !== null && textPercent !== null && Math.abs(barPercent - textPercent) > 1) {
    return { readable: false, pageKind: 'course', reason: 'percent-conflict' };
  }

  const progressPercent = barPercent ?? textPercent;
  if (progressPercent === null && !counts) {
    return { readable: false, pageKind: 'unknown', reason: 'no-progress-found' };
  }

  const courseName = readCourseName(doc);
  const externalCourseId = courseIdFromUrl(url) || (courseName ? `name:${courseName}` : null);
  if (!externalCourseId) {
    // Progress with nothing to attach it to would get credited to the wrong
    // course the moment a student takes two.
    return { readable: false, pageKind: 'course', reason: 'no-course-identity' };
  }

  return {
    readable: true,
    pageKind: 'course',
    course: {
      externalCourseId: externalCourseId.slice(0, LIMITS.MAX_ID_LENGTH),
      courseName: courseName || undefined,
      progressPercent: progressPercent ?? undefined,
      activitiesCompleted: counts?.completed,
      activitiesTotal: counts?.total,
    },
  };
}
