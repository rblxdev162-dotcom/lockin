/**
 * Watches a Canvas page for changes worth re-parsing.
 *
 * Canvas is largely a single-page app: submitting an assignment updates the DOM
 * without a navigation. So we watch both.
 *
 * Cost control, because this runs on every Canvas page the student opens:
 *   - one MutationObserver, created once, disconnected on teardown
 *   - childList/subtree only; no attribute or character-data churn
 *   - a trailing debounce, so a burst of React renders causes ONE parse
 *   - a hard floor between parses, so a page that mutates forever still can't
 *     spin the CPU
 */
import { MIN_PARSE_INTERVAL_MS, PARSE_DEBOUNCE_MS } from './types.js';

export function createCanvasObserver(onChange, options = {}) {
  const debounceMs = options.debounceMs ?? PARSE_DEBOUNCE_MS;
  const minIntervalMs = options.minIntervalMs ?? MIN_PARSE_INTERVAL_MS;

  let observer = null;
  let debounceTimer = null;
  let trailingTimer = null;
  let lastRun = 0;
  let lastUrl = typeof location !== 'undefined' ? location.href : '';
  let stopped = false;

  const run = (reason) => {
    if (stopped) return;
    lastRun = Date.now();
    try {
      onChange(reason);
    } catch (error) {
      console.warn('[LockIn] Canvas parse failed', error);
    }
  };

  /** Debounce, then rate-limit. Never drops the final change silently. */
  const schedule = (reason) => {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const since = Date.now() - lastRun;
      if (since >= minIntervalMs) {
        run(reason);
      } else if (!trailingTimer) {
        // Too soon: queue exactly one catch-up run at the earliest allowed time.
        trailingTimer = setTimeout(() => {
          trailingTimer = null;
          run(reason);
        }, minIntervalMs - since);
      }
    }, debounceMs);
  };

  const onUrlMaybeChanged = () => {
    if (stopped) return;
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    // A route change replaces the whole view; parse it as a fresh page.
    schedule('navigation');
  };

  // SPA navigations: history API + back/forward.
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const patched = { pushState: null, replaceState: null };

  function start() {
    if (observer || stopped) return;

    observer = new MutationObserver(() => schedule('mutation'));
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });

    patched.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      onUrlMaybeChanged();
      return result;
    };
    patched.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      onUrlMaybeChanged();
      return result;
    };
    history.pushState = patched.pushState;
    history.replaceState = patched.replaceState;

    window.addEventListener('popstate', onUrlMaybeChanged);
    window.addEventListener('hashchange', onUrlMaybeChanged);
    // Canvas sometimes finishes rendering after load; one extra pass catches it.
    window.addEventListener('pageshow', () => schedule('pageshow'));

    run('initial');
  }

  function stop() {
    stopped = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    if (trailingTimer) clearTimeout(trailingTimer);
    debounceTimer = null;
    trailingTimer = null;
    // Only restore our own patches — another script may have wrapped us since.
    if (history.pushState === patched.pushState) history.pushState = originalPushState;
    if (history.replaceState === patched.replaceState) history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', onUrlMaybeChanged);
    window.removeEventListener('hashchange', onUrlMaybeChanged);
  }

  return { start, stop, schedule };
}
