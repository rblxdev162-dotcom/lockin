/**
 * Edgenuity URL understanding — pure functions, no DOM, no Chrome APIs.
 *
 * The Canvas equivalent leans hard on URL structure because Canvas routes are
 * far more stable than Canvas markup. Edgenuity's routes are *not* published,
 * so this file claims much less: it decides whether a URL belongs to Edgenuity
 * at all, and whether it smells like an assessment. Identity and progress come
 * from the page (`parser.js`), gated on the signals in `detector.js`.
 */
import { EDGENUITY_DOMAINS, ASSESSMENT_URL_HINTS, LIMITS } from './types.js';

/** The `https://*.domain/*` patterns used for the optional host permission. */
export function originPatterns() {
  return EDGENUITY_DOMAINS.flatMap((domain) => [`https://*.${domain}/*`, `https://${domain}/*`]);
}

/**
 * True when `url` is served by Edgenuity over https.
 *
 * Suffix matching is done label-wise — `notedgenuity.com` must not match
 * `edgenuity.com`, and a plain-http look-alike is never trusted.
 */
export function isEdgenuityUrl(url) {
  if (typeof url !== 'string' || url.length > LIMITS.MAX_URL_LENGTH) return false;
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return EDGENUITY_DOMAINS.some((domain) => host === domain || host.endsWith('.' + domain));
}

/**
 * True when the URL suggests an assessment.
 *
 * Keyword matching on the path and query only — never the hostname, or every
 * page on a host containing "test" would be refused. This is one of two
 * independent assessment checks; `detector.js` also reads the page itself,
 * because a URL is not required to say what it is.
 */
export function looksLikeAssessmentUrl(url) {
  if (typeof url !== 'string') return false;
  let haystack;
  try {
    const parsed = new URL(url);
    haystack = (parsed.pathname + ' ' + parsed.search).toLowerCase();
  } catch {
    return false;
  }
  return ASSESSMENT_URL_HINTS.some((hint) => haystack.includes(hint));
}

/**
 * A stable-ish course identifier taken from the URL, or null.
 *
 * Prefers an explicit query parameter, then a long digit run in the path.
 * Returning null is normal and fine — the parser falls back to the course name
 * when the URL says nothing, and a course with neither is simply not reported.
 */
export function courseIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const key of ['courseId', 'courseid', 'CourseID', 'cid', 'courseSectionId']) {
    const value = parsed.searchParams.get(key);
    if (value && /^[a-z0-9_-]{1,64}$/i.test(value)) return value.slice(0, LIMITS.MAX_ID_LENGTH);
  }
  const digits = parsed.pathname.match(/\/(\d{4,})(?:\/|$)/);
  return digits ? digits[1].slice(0, LIMITS.MAX_ID_LENGTH) : null;
}
