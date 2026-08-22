/**
 * Canvas content-script logic (ES module).
 *
 * Loaded by `content.js`, which is the classic script Chrome actually injects —
 * content scripts cannot use static imports, so the loader pulls this in with a
 * dynamic import. Keeping the logic here preserves the module split.
 *
 * Injected only into the Canvas origin the student configured AND granted
 * permission for (see background/canvas.js). Never present on any other site.
 *
 * Strictly READ ONLY. It never clicks, submits, or changes anything on the
 * page — it reads what the student can already see and reports a small
 * structured summary to the background worker.
 */
import { detectCanvasPage } from './detector.js';
import { parseCanvasPage } from './parser.js';
import { createCanvasObserver } from './observer.js';
import { CANVAS_MSG } from './messaging.js';

export function startCanvasContentScript() {
  // Guard against double injection (registered script + a manual re-inject).
  if (window.__lockinCanvasActive) return;
  window.__lockinCanvasActive = true;

  const domain = location.hostname.toLowerCase();
  let lastPayloadKey = '';

  let observer = null;

  function send(message) {
    try {
      chrome.runtime
        .sendMessage(message)
        .then((reply) => {
          // The background gate refused passive reads. Stop watching the page
          // rather than re-offering a reading it will keep declining: "only
          // when I press the button" should cost nothing while idle.
          if (reply && reply.ok === false && reply.reason === 'passive_disabled') {
            observer?.stop();
          }
        })
        .catch(() => {
          /* worker asleep or extension reloaded; the next parse retries */
        });
    } catch {
      /* extension context invalidated — nothing to do */
    }
  }

  function parseAndReport(reason) {
    const detection = detectCanvasPage(document, location.href, domain);
    if (!detection.isCanvas) return null;

    let result;
    try {
      result = parseCanvasPage(document, location.href);
    } catch (error) {
      console.warn('[LockIn] Canvas parse error', error);
      send({ type: CANVAS_MSG.UNREADABLE, domain, url: location.href.slice(0, 500) });
      return { pageKind: detection.pageKind, readable: false };
    }

    if (!result.readable) {
      /**
       * Recognisably Canvas, nothing usable on it.
       *
       * The fingerprint rides along, and that matters: this is the branch the
       * user's grades page took for days. It answered, produced nothing the
       * parser recognised, and was dropped here — leaving no record at all, so
       * from the outside it was indistinguishable from the page never being
       * read. An unreadable page is exactly the one worth describing.
       */
      send({
        type: CANVAS_MSG.UNREADABLE,
        domain,
        pageKind: result.pageKind,
        diagnostics: result.diagnostics,
        trigger: reason === 'automatic' ? 'automatic' : reason === 'forced' ? 'manual' : 'passive',
      });
      return {
        pageKind: result.pageKind,
        readable: false,
        diagnostics: result.diagnostics,
      };
    }

    const payload = {
      type: CANVAS_MSG.DETECTION,
      domain,
      pageKind: result.pageKind,
      readable: true,
      assignments: result.assignments,
      courses: result.courses,
      grades: result.grades || [],
      diagnostics: result.diagnostics,
      // Which half of the gate this reading has to pass: a press, or the
      // observer noticing the page changed while the student browses.
      trigger: reason === 'automatic' ? 'automatic' : reason === 'forced' ? 'manual' : 'passive',
      detectedAt: new Date().toISOString(),
    };

    // Skip identical repeats: a mutating page must not generate a message per
    // render. `detectedAt` is excluded from the comparison on purpose.
    const key = JSON.stringify({
      a: payload.assignments.map((a) => [
        a.externalCourseId,
        a.externalAssignmentId,
        a.submissionStatus,
        a.title,
        a.dueAt,
      ]),
      c: payload.courses.map((c) => [c.externalCourseId, c.originalName]),
      g: payload.grades.map((g) => [g.externalCourseId, g.currentScore, g.currentGrade]),
      k: payload.pageKind,
    });
    if (key === lastPayloadKey && reason !== 'forced') {
      return {
        pageKind: result.pageKind,
        readable: true,
        diagnostics: result.diagnostics,
      };
    }
    lastPayloadKey = key;

    send(payload);
    return {
      pageKind: result.pageKind,
      readable: true,
      diagnostics: result.diagnostics,
    };
  }

  observer = createCanvasObserver(parseAndReport);
  observer.start();

  // The background worker can ask for a fresh read (Sync Canvas / status check).
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== CANVAS_MSG.REPARSE) return false;
    lastPayloadKey = '';
    const summary = parseAndReport(message.trigger === 'automatic' ? 'automatic' : 'forced');
    sendResponse({
      ok: summary?.readable === true,
      url: location.href.slice(0, 500),
      pageKind:
        summary?.pageKind ?? detectCanvasPage(document, location.href, domain).pageKind,
      readable: summary?.readable === true,
      diagnostics: summary?.diagnostics,
    });
    return true;
  });

  window.addEventListener('pagehide', () => observer?.stop(), { once: true });

  return observer;
}
