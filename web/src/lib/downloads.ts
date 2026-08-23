/**
 * How to get the Companion, from wherever this page happens to be served.
 *
 * ## The bug this exists to stop
 *
 * The extension is configured for exactly one web origin at build time — its
 * content script is only injected there, and the bridge refuses anything else.
 * That is a deliberate security boundary, and it has a consequence nobody was
 * told about: **a Companion built for one address is invisible on another.**
 *
 * So a student who loaded the repo's `extension/` folder (built for
 * `localhost:5173`) and then opened the published site got a site that
 * insisted the extension was not installed, a Canvas connect that failed with
 * a toast, and advice to reload the page — which of course changed nothing.
 * Nothing was broken except the instructions.
 *
 * The install steps are therefore derived from the origin the student is
 * actually on, and both variants say which address they are for.
 */

/** Published beside the site by `scripts/deploy-site.mjs`. */
export const EXTENSION_DOWNLOAD_URL = '/lockin-extension.zip';

export interface CompanionStep {
  title: string;
  /** Plain text; the pages that render this add their own emphasis. */
  body: string;
}

export interface CompanionGuide {
  /** True when this page can hand over a packaged build to download. */
  download: boolean;
  host: string;
  steps: CompanionStep[];
}

function isLocalHost(host: string): boolean {
  const name = host.split(':')[0];
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

/**
 * `host` defaults to wherever this page is. Pass one explicitly in tests.
 */
export function companionInstallGuide(
  host: string = typeof window === 'undefined' ? '' : window.location.host,
): CompanionGuide {
  const local = isLocalHost(host);

  const chromeSteps: CompanionStep[] = [
    {
      title: 'Open Chrome’s extensions page',
      body: 'Type chrome://extensions into the address bar. Chrome does not allow a link to open it.',
    },
    {
      title: 'Turn on Developer mode',
      body: 'The switch is in the top-right corner of that page.',
    },
  ];

  if (local) {
    return {
      download: false,
      host,
      steps: [
        ...chromeSteps,
        {
          title: 'Click “Load unpacked” and pick the extension folder',
          body: 'Choose lockin/extension — the folder with manifest.json directly inside it. Picking the outer lockin folder gives “Manifest file is missing or unreadable”.',
        },
        {
          title: 'Reload this tab',
          body: `This copy is built for ${host}, which is where you are now. LockIn will say the Companion is connected within a few seconds.`,
        },
      ],
    };
  }

  return {
    download: true,
    host,
    steps: [
      {
        title: 'Download the companion from this page',
        body: `It is built for ${host}. A copy built for a different address — the one in the code folder, for instance — cannot see this site at all.`,
      },
      ...chromeSteps,
      {
        title: 'Click “Load unpacked” and pick the unzipped folder',
        body: 'Keep the folder somewhere you will not delete it; Chrome loads it from where it sits. Then reload this tab.',
      },
    ],
  };
}
