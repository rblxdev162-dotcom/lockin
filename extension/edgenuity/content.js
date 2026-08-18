/**
 * Edgenuity content-script loader.
 *
 * Same shape as `canvas/content.js`: Chrome injects content scripts as classic
 * scripts, which cannot use static `import`, so this tiny loader is the
 * injected file and it pulls the real logic in dynamically.
 *
 * Registered only after the student connects Edgenuity and Chrome grants the
 * origin — see `background/edgenuity.js`. Never present otherwise.
 */
(() => {
  if (window.__lockinEdgenuityLoaded) return;
  window.__lockinEdgenuityLoaded = true;

  const url = chrome.runtime.getURL('edgenuity/main.js');
  import(url)
    .then((module) => module.startEdgenuityContentScript())
    .catch((error) => {
      console.warn('[LockIn] Edgenuity module failed to load', error);
      window.__lockinEdgenuityLoaded = false;
    });
})();
