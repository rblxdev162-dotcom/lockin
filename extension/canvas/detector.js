/**
 * "Is this actually Canvas?"
 *
 * The configured domain alone is not proof — a school domain hosts plenty of
 * non-Canvas pages, and a page under the right host could be anything. So the
 * detector combines independent signals and requires more than one.
 *
 * Being wrong in the cautious direction is free: we simply don't parse.
 */
import { classifyCanvasUrl, isConfiguredCanvasUrl } from './urls.js';

/**
 * Markup fingerprints that Canvas (Instructure) emits on essentially every
 * page. Each is independently weak; together they are decisive.
 */
function markupSignals(doc) {
  const signals = [];

  // Canvas' global ENV bootstrap object appears as a script on served pages.
  if (doc.querySelector('meta[name="csrf-param"]')) signals.push('csrf-meta');

  // Long-standing Canvas layout ids/classes.
  if (doc.querySelector('#application, .ic-app, #wrapper.ic-Layout-wrapper')) {
    signals.push('ic-app');
  }
  if (doc.querySelector('#content, .ic-Layout-contentMain')) signals.push('content-region');
  if (doc.querySelector('#breadcrumbs')) signals.push('breadcrumbs');

  // Instructure-specific attribution.
  const generator = doc.querySelector('meta[name="generator"]');
  if (generator && /instructure|canvas/i.test(generator.getAttribute('content') || '')) {
    signals.push('generator-meta');
  }
  if (doc.querySelector('link[href*="instructure"], script[src*="instructure"]')) {
    signals.push('instructure-asset');
  }

  // Any link shaped like a Canvas course route.
  if (doc.querySelector('a[href*="/courses/"]')) signals.push('course-link');

  return signals;
}

/**
 * @returns {{ isCanvas: boolean, confidence: number, signals: string[],
 *             pageKind: string, reason?: string }}
 */
export function detectCanvasPage(doc, url, configuredDomain) {
  // Hard gate: must be the configured Canvas origin over https. Everything
  // else is refused before any parsing happens.
  if (!isConfiguredCanvasUrl(url, configuredDomain)) {
    return {
      isCanvas: false,
      confidence: 0,
      signals: [],
      pageKind: 'unknown',
      reason: 'origin-mismatch',
    };
  }

  const info = classifyCanvasUrl(url);
  const signals = markupSignals(doc);

  // A recognised Canvas route is itself a strong signal.
  const routeKnown = info.kind !== 'unknown';
  if (routeKnown) signals.push(`route:${info.kind}`);

  // Require at least two independent signals, or a known route plus one.
  const confidence = Math.min(1, signals.length / 4);
  const isCanvas = routeKnown ? signals.length >= 2 : signals.length >= 3;

  return {
    isCanvas,
    confidence,
    signals,
    pageKind: info.kind,
    reason: isCanvas ? undefined : 'insufficient-signals',
  };
}
