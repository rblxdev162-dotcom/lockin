/**
 * The web↔extension relay.
 *
 * `externally_connectable` cannot target localhost origins, so LockIn uses a
 * content script instead. It is injected only on the origins listed in
 * manifest.json's `content_scripts.matches`, and re-checks the origin here
 * before forwarding anything.
 *
 * Rules this file enforces:
 *   - only same-window messages (event.source === window)
 *   - only from an approved LockIn origin
 *   - only well-formed envelopes tagged `lockin-web`
 *   - nothing is ever eval'd; payloads are structured-clone JSON
 *
 * NOTE: this is a classic content script (no ES modules), so the small pieces
 * of shared logic it needs are inlined rather than imported. The one thing it
 * must not inline is the origin list — that is build configuration, and it
 * arrives via shared/build-config.js, which manifest.json injects immediately
 * before this file into the same isolated world.
 */
(() => {
  const WEB_SOURCE = 'lockin-web';
  const EXT_SOURCE = 'lockin-extension';
  const PROTOCOL_VERSION = 1;

  const KNOWN_TYPES = new Set([
    'PING',
    'PONG',
    'SYNC_STATE',
    'STATE_ACK',
    'GET_STATS',
    'STATS',
    'CLEAR_STATS',
    'PUSH_STATE',
    'ALLOWLIST_REQUEST',
    // Canvas Browser Connection. Note these are only *requests* from the app;
    // Canvas page data never travels through this bridge — it goes from the
    // Canvas content script straight to the worker.
    'CANVAS_CONFIGURE',
    'CANVAS_REQUEST_PERMISSION',
    'CANVAS_GET_VIEW',
    'CANVAS_SYNC',
    'CANVAS_DISCONNECT',
    'CANVAS_OPEN',
    'CANVAS_VIEW',
    'CANVAS_PUSH',
  ]);

  // Injected by shared/build-config.js. If it is missing the build is broken,
  // and the safe reading of "I don't know which origins are trusted" is none.
  const ALLOWED_ORIGINS = globalThis.__LOCKIN_BUILD__?.ALLOWED_APP_ORIGINS ?? [];

  if (!ALLOWED_ORIGINS.includes(window.location.origin)) return;

  const post = (type, requestId, payload) => {
    window.postMessage(
      { source: EXT_SOURCE, version: PROTOCOL_VERSION, type, requestId, payload },
      window.location.origin,
    );
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (!ALLOWED_ORIGINS.includes(event.origin)) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== WEB_SOURCE) return;
    if (typeof data.type !== 'string' || !KNOWN_TYPES.has(data.type)) return;

    let reply;
    try {
      reply = chrome.runtime.sendMessage({
        source: WEB_SOURCE,
        version: PROTOCOL_VERSION,
        type: data.type,
        requestId: data.requestId,
        payload: data.payload,
      });
    } catch {
      // Extension context invalidated (reloaded/updated). The page's request
      // will simply time out and it will show "Not connected".
      return;
    }

    Promise.resolve(reply)
      .then((response) => {
        if (!response || typeof response !== 'object') return;
        if (response.source !== EXT_SOURCE) return;
        post(response.type, response.requestId, response.payload);
      })
      .catch(() => {
        /* worker asleep or reloading — the page falls back to its timeout */
      });
  });

  // Push updates the page didn't ask for (temporary unlock expiring, block
  // counts changing) so multiple LockIn tabs stay in step without polling.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.lockin_block_stats) {
      post('PUSH_STATE', undefined, { stats: changes.lockin_block_stats.newValue || [] });
    }
  });

  // The worker pushes a Canvas view here when a detection changes something,
  // so a submission made on Canvas reaches the app with no refresh.
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return false;
    if (message.source !== EXT_SOURCE) return false;
    if (message.type !== 'CANVAS_PUSH') return false;
    post('CANVAS_PUSH', undefined, message.payload);
    return false;
  });

  // Announce presence so a page that loaded before the extension woke up can
  // connect without waiting for its next poll.
  post('PONG', undefined, { version: chrome.runtime.getManifest().version, protocolVersion: PROTOCOL_VERSION });
})();
