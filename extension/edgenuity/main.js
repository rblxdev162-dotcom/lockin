/**
 * Edgenuity content-script logic (ES module).
 *
 * Strictly READ ONLY, and more narrowly than the Canvas script: it never
 * clicks, submits, navigates or changes anything, and it never issues a
 * request of its own. It reads what the student's own navigation already put
 * on screen, and reports at most a course id, a name and three numbers.
 *
 * It also stays completely inert on assessment pages — `detectEdgenuityPage`
 * refuses them, so nothing is parsed and nothing is sent while a test is open.
 */
import { detectEdgenuityPage } from './detector.js';
import { parseEdgenuityPage } from './parser.js';
import { EDGENUITY_MSG } from './messaging.js';
// The Canvas observer is generic — one debounced, rate-limited MutationObserver
// with a URL check for SPA navigation. Reused rather than copied so there is
// one implementation of the cost controls, not two that drift apart.
import { createCanvasObserver } from '../canvas/observer.js';

export function startEdgenuityContentScript() {
  if (window.__lockinEdgenuityActive) return;
  window.__lockinEdgenuityActive = true;

  let lastPayloadKey = '';

  function send(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {
        /* worker asleep or extension reloaded; the next read retries */
      });
    } catch {
      /* extension context invalidated — nothing to do */
    }
  }

  function readAndReport(reason) {
    const detection = detectEdgenuityPage(document, location.href);
    if (!detection.isEdgenuity || !detection.safeToRead) return;

    let result;
    try {
      result = parseEdgenuityPage(document, location.href);
    } catch (error) {
      console.warn('[LockIn] Edgenuity read error', error);
      send({ type: EDGENUITY_MSG.UNREADABLE, reason: 'parse-error' });
      return;
    }

    if (!result.readable) {
      // Recognisably Edgenuity, no progress on it. Reported so Settings can say
      // "connected, nothing readable on this page yet" instead of nothing.
      send({ type: EDGENUITY_MSG.UNREADABLE, reason: result.reason });
      return;
    }

    const payload = {
      type: EDGENUITY_MSG.DETECTION,
      courses: [result.course],
      readAt: new Date().toISOString(),
    };

    // A re-render must not produce a message per frame. `readAt` is excluded
    // from the comparison on purpose.
    const key = JSON.stringify([
      result.course.externalCourseId,
      result.course.progressPercent,
      result.course.activitiesCompleted,
      result.course.activitiesTotal,
    ]);
    if (key === lastPayloadKey && reason !== 'forced') return;
    lastPayloadKey = key;

    send(payload);
  }

  const observer = createCanvasObserver(readAndReport);
  observer.start();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== EDGENUITY_MSG.REPARSE) return false;
    lastPayloadKey = '';
    readAndReport('forced');
    sendResponse({ ok: true });
    return true;
  });

  window.addEventListener('pagehide', () => observer.stop(), { once: true });

  return observer;
}
