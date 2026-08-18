/**
 * Canvas content-script loader.
 *
 * Chrome injects content scripts as *classic* scripts, which cannot use static
 * `import`. This tiny loader is therefore the injected file, and it pulls in
 * the real logic (`main.js`) with a dynamic import of an extension URL. That
 * keeps the Canvas module split into small, testable files instead of forcing
 * one bundled blob.
 *
 * The Canvas modules are listed in `web_accessible_resources` so this import
 * is permitted. They are inert parsing code containing no secrets. They are
 * deliberately NOT served under `use_dynamic_url`, because that alias breaks
 * relative resolution of the modules' own sibling imports.
 *
 * Nothing here touches the page beyond reading it.
 */
(() => {
  if (window.__lockinCanvasLoaded) return;
  window.__lockinCanvasLoaded = true;

  const url = chrome.runtime.getURL('canvas/main.js');
  import(url)
    .then((module) => module.startCanvasContentScript())
    .catch((error) => {
      // Extension reloaded mid-navigation, or resources not yet available.
      console.warn('[LockIn] Canvas module failed to load', error);
      window.__lockinCanvasLoaded = false;
    });
})();
