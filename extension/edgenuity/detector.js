/**
 * "Is this actually an Edgenuity course page, and is it safe to read?"
 *
 * Two jobs, and the second one is the reason this file is stricter than its
 * Canvas counterpart:
 *
 *   1. Confirm the page is Edgenuity — the host gate plus at least one
 *      independent markup signal. Being wrong in the cautious direction is
 *      free: we simply don't parse.
 *   2. Refuse assessments. Quizzes, tests and exams are checked twice — by URL
 *      and by page content — and either hit is disqualifying. Course progress
 *      does not change during an assessment, so this costs nothing, and it
 *      keeps LockIn from reading anything while a proctored test is running.
 */
import { isEdgenuityUrl, looksLikeAssessmentUrl } from './urls.js';

/**
 * Page content that means "an assessment is on screen".
 * Deliberately broad: a false "this is a test" costs one skipped read.
 */
const ASSESSMENT_TEXT =
  /\b(quiz|unit test|cumulative exam|final exam|proctor(?:ed|io)?|lockdown browser|begin (?:the )?(?:test|exam)|submit (?:test|exam))\b/i;

/** How much rendered text is searched for assessment wording. */
const SCAN_LENGTH = 20000;

function markupSignals(doc) {
  const signals = [];

  // Vendor attribution in assets or metadata — present on served pages
  // regardless of which framework drew the view.
  if (doc.querySelector?.('link[href*="edgenuity"], script[src*="edgenuity"], img[src*="edgenuity"]')) {
    signals.push('edgenuity-asset');
  }
  if (doc.querySelector?.('link[href*="imaginelearning"], script[src*="imaginelearning"]')) {
    signals.push('imaginelearning-asset');
  }
  if (/edgenuity|imagine learning/i.test(doc.title || '')) signals.push('title');

  // The student experience is an authenticated app shell, not a marketing page.
  if (doc.querySelector?.('[role="progressbar"], progress')) signals.push('progressbar');
  if (doc.querySelector?.('[role="main"], main, #app, #root')) signals.push('app-shell');

  return signals;
}

/**
 * @returns {{ isEdgenuity: boolean, safeToRead: boolean, confidence: number,
 *             signals: string[], reason?: string }}
 */
export function detectEdgenuityPage(doc, url) {
  const refuse = (reason) => ({
    isEdgenuity: false,
    safeToRead: false,
    confidence: 0,
    signals: [],
    reason,
  });

  // Hard gate: an Edgenuity host over https, or nothing happens at all.
  if (!isEdgenuityUrl(url)) return refuse('origin-mismatch');

  // Assessment check one: the URL.
  if (looksLikeAssessmentUrl(url)) return refuse('assessment-url');

  // Assessment check two: what is actually on screen.
  const text = (doc.body?.innerText || doc.body?.textContent || '').slice(0, SCAN_LENGTH);
  if (ASSESSMENT_TEXT.test(text)) {
    return {
      isEdgenuity: true,
      safeToRead: false,
      confidence: 0,
      signals: [],
      reason: 'assessment-content',
    };
  }

  const signals = markupSignals(doc);
  // The host gate is already strong here — Edgenuity is a single vendor and
  // nobody self-hosts it — so one corroborating signal is enough, where Canvas
  // needs two or three to distinguish Canvas from the rest of a school domain.
  const isEdgenuity = signals.length >= 1;

  return {
    isEdgenuity,
    safeToRead: isEdgenuity,
    confidence: Math.min(1, signals.length / 3),
    signals,
    reason: isEdgenuity ? undefined : 'no-signals',
  };
}
