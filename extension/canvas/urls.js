/**
 * Canvas URL understanding — pure functions, no DOM, no Chrome APIs.
 *
 * Canvas URL structure is far more stable than Canvas markup, so identifiers
 * come from here whenever possible. Everything is unit-tested directly in Node.
 *
 * Canvas is NOT assumed to live at canvas.instructure.com: schools self-host at
 * arbitrary domains (`canvas.district.org`), so the configured domain is always
 * supplied by the caller.
 */
import { LIMITS } from './types.js';

/** `https://My.School.edu:443/x` → `my.school.edu`. Returns null if unusable. */
export function normalizeCanvasDomain(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.replace(/^[^/@]*@/, '');
  value = value.split('/')[0].split('?')[0].split('#')[0];
  value = value.split(':')[0];
  value = value.replace(/\.+$/, '');
  if (!value || value.length > LIMITS.MAX_DOMAIN_LENGTH) return null;
  // Bare IPs and single labels are rejected — Canvas is always a real hostname.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
  const labels = value.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!label || label.length > 63 || !/^[a-z0-9-]+$/.test(label)) return null;
    if (label.startsWith('-') || label.endsWith('-')) return null;
  }
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return null;
  return value;
}

/** The `https://domain/*` match pattern used for the optional host permission. */
export function originPattern(domain) {
  const clean = normalizeCanvasDomain(domain);
  return clean ? `https://${clean}/*` : null;
}

export function originOf(domain) {
  const clean = normalizeCanvasDomain(domain);
  return clean ? `https://${clean}` : null;
}

/** True when `url` is served by the configured Canvas host (or a subdomain). */
export function isConfiguredCanvasUrl(url, configuredDomain) {
  const domain = normalizeCanvasDomain(configuredDomain);
  if (!domain || typeof url !== 'string') return false;
  let host;
  try {
    const parsed = new URL(url);
    // Only https — a plain-http lookalike must not be trusted as Canvas.
    if (parsed.protocol !== 'https:') return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === domain || host.endsWith('.' + domain);
}

/**
 * Which kind of Canvas page a URL points at. Canvas' route shapes are a
 * documented, long-stable part of the product — far safer than CSS selectors.
 */
export function classifyCanvasUrl(url) {
  let path;
  try {
    path = new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return { kind: 'unknown', courseId: null, assignmentId: null };
  }

  const courseMatch = path.match(/^\/courses\/(\d+)/);
  const courseId = courseMatch ? courseMatch[1] : null;

  // /courses/123/assignments/456
  const assignmentMatch = path.match(/^\/courses\/(\d+)\/assignments\/(\d+)/);
  if (assignmentMatch) {
    return { kind: 'assignment', courseId: assignmentMatch[1], assignmentId: assignmentMatch[2] };
  }

  // /courses/123/quizzes/456 — quizzes carry their own id space.
  const quizMatch = path.match(/^\/courses\/(\d+)\/quizzes\/(\d+)/);
  if (quizMatch) {
    return { kind: 'quiz', courseId: quizMatch[1], assignmentId: `quiz_${quizMatch[2]}` };
  }

  if (/^\/courses\/\d+\/assignments$/.test(path)) {
    return { kind: 'assignments_index', courseId, assignmentId: null };
  }
  if (/^\/courses\/\d+\/grades/.test(path)) {
    return { kind: 'grades', courseId, assignmentId: null };
  }
  if (/^\/courses\/\d+$/.test(path)) {
    return { kind: 'course', courseId, assignmentId: null };
  }
  if (path === '/' || path === '/dashboard') {
    return { kind: 'dashboard', courseId: null, assignmentId: null };
  }
  if (path.startsWith('/users/') && path.includes('/todo')) {
    return { kind: 'todo', courseId: null, assignmentId: null };
  }

  return { kind: 'unknown', courseId, assignmentId: null };
}

/**
 * Pulls course + assignment ids out of an href, which is how list pages are
 * read: every row links to the assignment, and that link carries the ids.
 * Relative hrefs are resolved against `base`.
 */
export function idsFromHref(href, base) {
  if (typeof href !== 'string' || !href) return null;
  let absolute;
  try {
    absolute = new URL(href, base).toString();
  } catch {
    return null;
  }
  const info = classifyCanvasUrl(absolute);
  if (!info.courseId || !info.assignmentId) return null;
  if (
    info.courseId.length > LIMITS.MAX_ID_LENGTH ||
    info.assignmentId.length > LIMITS.MAX_ID_LENGTH
  ) {
    return null;
  }
  return {
    externalCourseId: info.courseId,
    externalAssignmentId: info.assignmentId,
    url: absolute.slice(0, LIMITS.MAX_URL_LENGTH),
    kind: info.kind === 'quiz' ? 'quiz' : 'assignment',
  };
}

/** Canonical assignment URL, used for "Open in Canvas" and re-checks. */
export function assignmentUrl(domain, courseId, assignmentId) {
  const origin = originOf(domain);
  if (!origin || !courseId || !assignmentId) return null;
  if (String(assignmentId).startsWith('quiz_')) {
    return `${origin}/courses/${courseId}/quizzes/${String(assignmentId).slice(5)}`;
  }
  return `${origin}/courses/${courseId}/assignments/${assignmentId}`;
}
