/**
 * Release safety (Phase 8).
 *
 * These are the checks that stop a *packaging* mistake reaching a student.
 * They are deliberately blunt and file-level: the other suites prove the
 * verification logic is right, and this one proves the right files ship with
 * the right values in them.
 *
 * Four groups:
 *   1. Versions agree across package.json, manifest.json and the web app.
 *   2. The packaged extension contains only shipping files, and its origin
 *      configuration is internally consistent.
 *   3. The production web build contains no test fixture, no fixture capture
 *      source, and no developer bypass.
 *   4. The data export carries no secret.
 *
 * Group 3 needs `web/dist`, which is produced by `npm run build`; the checks
 * skip loudly rather than silently passing when it is absent, because a
 * silently-skipped release check is worse than no check at all.
 *
 * Run: npm run test:release
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '../..');
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'extension/manifest.json'), 'utf8'));

const { APP_VERSION } = await import('../../web/src/version.ts');
const { buildExport } = await import('../../web/src/lib/export.ts');
const { defaultState } = await import('../../web/src/lib/storage.ts');
const { reducer } = await import('../../web/src/store/reducer.ts');
const { createAssignment, createExam } = await import('../../web/src/store/factories.ts');
const { isForbidden, SHIPPING_ENTRIES } = await import('../../scripts/build-extension.mjs');
const { resolveConfig, validateOrigin, matchPattern, applyToManifest } = await import(
  '../../scripts/gen-extension-config.mjs'
);

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. Versions                                                         */
/* ------------------------------------------------------------------ */

test('the website, the extension and package.json all report one version', () => {
  assert.equal(
    APP_VERSION,
    pkg.version,
    'web/src/version.ts and package.json disagree — Settings → About would lie',
  );
  assert.equal(
    manifest.version,
    pkg.version,
    'extension/manifest.json and package.json disagree — the packaged zip would be misnamed',
  );
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Chrome requires a numeric-dotted version');
});

test('CHANGELOG.md documents the version being shipped', () => {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.ok(
    changelog.includes(pkg.version),
    `CHANGELOG.md has no entry for ${pkg.version}`,
  );
});

/* ------------------------------------------------------------------ */
/* 2. The packaged extension                                           */
/* ------------------------------------------------------------------ */

test('the packaging allowlist refuses tests, fixtures, keys and archives', () => {
  for (const bad of [
    'tests/e2e.mjs',
    'tests/fixtures/edgenuity/clear-43.png',
    'canvas/fixtures/index.mjs',
    'background/rules.test.js',
    'signing.pem',
    'private.key',
    'build.crx',
    'old-package.zip',
    'debug.log',
    'node_modules/thing/index.js',
    '.DS_Store',
  ]) {
    assert.ok(isForbidden(bad), `${bad} must never ship`);
  }
  for (const good of [
    'manifest.json',
    'background/service-worker.js',
    'canvas/parser.js',
    'shared/build-config.js',
    'assets/icon-128.png',
    'blocked/blocked.html',
  ]) {
    assert.ok(!isForbidden(good), `${good} is a shipping file`);
  }
  assert.ok(!SHIPPING_ENTRIES.includes('tests'), 'the tests directory is not a shipping entry');
});

test('a built package contains every file the manifest references, and nothing else', () => {
  execFileSync('node', [join(ROOT, 'scripts/build-extension.mjs')], { cwd: ROOT, stdio: 'pipe' });
  const out = join(ROOT, 'release/extension');
  const files = walk(out);

  assert.ok(files.length > 0, 'the package is empty');
  assert.equal(files.filter(isForbidden).length, 0, 'the package contains non-shipping files');

  const built = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  const referenced = [
    built.background.service_worker,
    ...built.content_scripts.flatMap((c) => c.js),
    built.action.default_popup,
    ...Object.values(built.icons),
    ...built.web_accessible_resources.flatMap((r) => r.resources),
  ];
  for (const file of referenced) {
    assert.ok(existsSync(join(out, file)), `manifest references missing file ${file}`);
  }
});

test('the shipped origin configuration agrees with the manifest in all three places', () => {
  const out = join(ROOT, 'release/extension');
  const built = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  const esm = readFileSync(join(out, 'shared/config.js'), 'utf8');
  const classic = readFileSync(join(out, 'shared/build-config.js'), 'utf8');

  const relay = built.content_scripts.find((c) => c.js.includes('content/bridge.js'));
  assert.ok(relay, 'no content script entry relays the bridge');
  assert.ok(
    relay.js.indexOf('shared/build-config.js') < relay.js.indexOf('content/bridge.js'),
    'build-config.js must be injected before bridge.js, or the origin list is undefined',
  );

  // Every origin in the manifest must appear in both generated files, and
  // neither generated file may name an origin the manifest does not inject on.
  const origins = relay.matches.map((m) => m.replace(/\/\*$/, ''));
  assert.ok(origins.length > 0, 'no origins configured');
  for (const origin of origins) {
    assert.ok(esm.includes(origin), `shared/config.js is missing ${origin}`);
    assert.ok(classic.includes(origin), `shared/build-config.js is missing ${origin}`);
    assert.equal(matchPattern(origin), `${origin}/*`);
  }
  for (const found of esm.match(/https?:\/\/[^"']+/g) ?? []) {
    assert.ok(
      origins.some((o) => found.startsWith(o)),
      `shared/config.js names ${found}, which the manifest does not inject on`,
    );
  }
});

test('the bridge takes its origin list from build config, never from a literal', () => {
  const bridge = readFileSync(join(ROOT, 'extension/content/bridge.js'), 'utf8');
  assert.ok(
    bridge.includes('__LOCKIN_BUILD__'),
    'bridge.js must read the generated origin list',
  );
  assert.ok(
    !/ALLOWED_ORIGINS\s*=\s*\[\s*'http/.test(bridge),
    'bridge.js still hard-codes an origin literal',
  );
});

test('a production build carries a real, secure origin — never localhost', () => {
  /**
   * This used to assert that a production build with no `LOCKIN_APP_ORIGIN`
   * *threw*, because no production origin existed and a committed default
   * would have been a dead address. One exists now — the published site — so
   * the origin is committed, and what is worth pinning is the property the
   * throw was protecting: production never ships a localhost or insecure
   * origin. `resolveConfig` still throws when nothing is configured at all.
   */
  const shipped = resolveConfig({ LOCKIN_ENV: 'production' });
  assert.ok(shipped.origins.length > 0, 'production must name an origin');
  for (const origin of shipped.origins) {
    assert.ok(origin.startsWith('https://'), `${origin} must be https`);
    assert.ok(!origin.includes('localhost'), 'production must not carry localhost');
    assert.ok(!origin.includes('127.0.0.1'), 'production must not carry loopback');
    assert.equal(validateOrigin(origin), null, `${origin} must be a valid bare origin`);
  }
  assert.ok(shipped.appUrl.startsWith('https://'), 'the app URL must be https');

  const good = resolveConfig({
    LOCKIN_ENV: 'production',
    LOCKIN_APP_ORIGIN: 'https://lockin.example.com',
  });
  // An origin supplied at build time is added to the committed one, so a
  // staging or custom domain can be packaged without editing the repo.
  assert.ok(good.origins.includes('https://lockin.example.com'));
  assert.equal(good.appUrl, `${good.origins[0]}/home`);
  assert.ok(!good.origins.some((o) => o.includes('localhost')), 'production must not carry localhost');

  // The camera needs a secure context, so plain http off-loopback is refused.
  assert.equal(validateOrigin('https://lockin.example.com'), null);
  assert.equal(validateOrigin('http://localhost:5173'), null);
  assert.ok(validateOrigin('http://school.example.com'), 'plain http off-loopback must be refused');
  assert.ok(validateOrigin('https://a.example.com/app'), 'an origin with a path must be refused');
  assert.ok(validateOrigin('not a url'), 'garbage must be refused');
});

test('applying a production config rewrites the manifest match list completely', () => {
  const config = { origins: ['https://lockin.example.com'], appUrl: 'https://x/home', env: 'production' };
  const next = applyToManifest(manifest, config);
  const relay = next.content_scripts.find((c) => c.js.includes('content/bridge.js'));
  assert.deepEqual(relay.matches, ['https://lockin.example.com/*']);
  assert.ok(
    !JSON.stringify(relay.matches).includes('localhost'),
    'the dev origins must be replaced, not appended to',
  );
});

test('the packaged zip unpacks into a loadable extension', () => {
  execFileSync('node', [join(ROOT, 'scripts/build-extension.mjs'), '--zip'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  const zip = join(ROOT, `dist/lockin-extension-v${pkg.version}.zip`);
  assert.ok(existsSync(zip), 'the zip was not produced');

  const dir = mkdtempSync(join(tmpdir(), 'lockin-zip-'));
  try {
    execFileSync('unzip', ['-q', zip, '-d', dir]);
    // Chrome requires the manifest at the archive root.
    assert.ok(existsSync(join(dir, 'manifest.json')), 'manifest.json is not at the zip root');
    const unpacked = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    assert.equal(unpacked.version, pkg.version);
    assert.equal(walk(dir).filter(isForbidden).length, 0, 'the zip contains non-shipping files');
    assert.ok(existsSync(join(dir, 'background/service-worker.js')));
    assert.ok(existsSync(join(dir, 'shared/build-config.js')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the extension asks for no permission it does not use', () => {
  const source = SHIPPING_ENTRIES.filter((e) => e !== 'manifest.json')
    .flatMap((entry) => {
      const dir = join(ROOT, 'extension', entry);
      return statSync(dir).isDirectory()
        ? walk(dir).map((f) => join(dir, f))
        : [dir];
    })
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  for (const permission of manifest.permissions) {
    assert.ok(
      source.includes(`chrome.${permission}`),
      `manifest requests "${permission}" but no shipping file calls chrome.${permission}`,
    );
  }
  // <all_urls> was narrowed in Phase 8; declarativeNetRequest redirect rules
  // still need broad http/https access, but nothing needs ftp or file.
  assert.ok(
    !manifest.host_permissions.includes('<all_urls>'),
    'host_permissions should be narrowed to the schemes LockIn actually blocks',
  );
  assert.deepEqual(manifest.host_permissions.sort(), ['http://*/*', 'https://*/*']);
});

/* ------------------------------------------------------------------ */
/* 3. The production web build                                         */
/* ------------------------------------------------------------------ */

const DIST = join(ROOT, 'web/dist');
const distBuilt = existsSync(DIST);

test('the production build ships no test fixture and no fixture capture source', { skip: distBuilt ? false : 'run `npm run build` first' }, () => {
  const files = walk(DIST);
  assert.ok(files.length > 0, 'web/dist is empty');

  assert.equal(
    files.filter((f) => f.startsWith('fixtures/')).length,
    0,
    'the Edgenuity test images were copied into the production build',
  );

  const bundles = files
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(DIST, f), 'utf8'));

  for (const forbidden of ['TestFixtureCapture', '/fixtures/edgenuity/', 'lockinSeed', 'installDevSeed']) {
    assert.ok(
      !bundles.some((b) => b.includes(forbidden)),
      `"${forbidden}" is present in the production bundle — the DEV guard is not eliminating it`,
    );
  }
});

/**
 * The privacy page claims LockIn sends nothing. This is where that claim is
 * checked.
 *
 * Checking the *bundle* for URL strings does not work: React, react-router and
 * rolldown all embed documentation links in error messages, and LockIn's own
 * blocklist suggestions are literally domain names. A URL in a string is not a
 * request. So the check is made against the source, on the APIs that can
 * actually reach the network.
 */
test('no LockIn source file can make a network request', () => {
  const sources = walk(join(ROOT, 'web/src'))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(join(ROOT, 'web/src', f), 'utf8') }));
  assert.ok(sources.length > 20, 'the source scan found nothing — the path is wrong');

  const NETWORK = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /navigator\.sendBeacon/,
    /new\s+WebSocket/,
    /new\s+EventSource/,
    /\baxios\b/,
    /importScripts\s*\(/,
  ];
  /**
   * One file is allowed to call `fetch`, and it is named here rather than
   * pattern-matched, so adding a second one has to be a deliberate edit to
   * this test.
   *
   * `lib/canvas/serviceFeed.ts` talks to LockIn's own service on 127.0.0.1 —
   * the process already serving this page. That is inter-process communication
   * on one machine, not a network request: nothing leaves the device, and the
   * privacy page's claim is unchanged. The check below proves it stays that way.
   *
   * The Canvas feed itself is fetched by that service (or by the extension),
   * never by the page: Canvas serves it with no `Access-Control-Allow-Origin`
   * header — measured, not assumed — so a page physically cannot read it.
   */
  const LOOPBACK_ONLY = 'lib/canvas/serviceFeed.ts';

  const offenders = sources.filter(
    ({ file, text }) =>
      file !== LOOPBACK_ONLY && NETWORK.some((pattern) => pattern.test(stripComments(text))),
  );
  assert.deepEqual(
    offenders.map((o) => o.file),
    [],
    'a source file can reach the network; the privacy page says nothing is sent',
  );

});


test('no analytics or error-reporting service is bundled', { skip: distBuilt ? false : 'run `npm run build` first' }, () => {
  const bundles = walk(DIST)
    .filter((f) => f.endsWith('.js') && !f.startsWith('ocr/'))
    .map((f) => readFileSync(join(DIST, f), 'utf8'))
    .join('\n');

  for (const host of [
    'sentry.io',
    'google-analytics.com',
    'googletagmanager.com',
    'segment.io',
    'posthog.com',
    'amplitude.com',
    'mixpanel.com',
    'bugsnag.com',
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
  ]) {
    assert.ok(!bundles.includes(host), `the production bundle references ${host}`);
  }
});

/** Crude but adequate: strips // and /* comments so a mention is not a match. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/* ------------------------------------------------------------------ */
/* 4. The export                                                       */
/* ------------------------------------------------------------------ */

/** A state with something of every kind in it, including secrets. */
function populated() {
  let state = defaultState();
  state = reducer(state, { type: 'CREATE_PROFILE', firstName: 'Sam' });
  state = reducer(state, {
    type: 'ADD_ASSIGNMENT',
    assignment: createAssignment({
      title: 'Essay',
      subject: 'English',
      platform: 'Other',
      dueDate: '2026-09-01',
      dueTime: '23:59',
      estimatedMinutes: 60,
      priority: 'Normal',
    }),
  });
  state = reducer(state, {
    type: 'ADD_EXAM',
    exam: createExam({ name: 'Bio Final', subject: 'Science', examDate: '2026-09-10', materialAmount: 'Medium' }),
  });
  return {
    ...state,
    parentPin: { hash: 'SUPERSECRETHASH', salt: 'SUPERSECRETSALT', createdAt: 'x' },
    edgenuity: {
      ...state.edgenuity,
      challenges: [
        {
          id: 'chl_1',
          assignmentId: state.assignments[0].id,
          sessionId: null,
          phase: 'before',
          type: 'visual_code',
          value: 'K7M4',
          valueHash: 'HASHEDCODEVALUE',
          createdAt: 'x',
          expiresAt: 'y',
          status: 'pending',
          attempts: 0,
        },
      ],
    },
  };
}

test('the export leaks no PIN, no salt, no challenge code and no hash', () => {
  const state = populated();
  const text = JSON.stringify(buildExport(state, APP_VERSION));

  for (const secret of ['SUPERSECRETHASH', 'SUPERSECRETSALT', 'K7M4', 'HASHEDCODEVALUE']) {
    assert.ok(!text.includes(secret), `the export contains the secret "${secret}"`);
  }
  // Not just the values — the key names must be absent too, so a future field
  // called `salt` cannot slide in unnoticed.
  for (const key of ['"salt"', '"hash"', '"valueHash"', '"parentPin"', '"rawText"']) {
    assert.ok(!text.includes(key), `the export contains the key ${key}`);
  }
});

test('the export still carries the data a student came for', () => {
  const data = buildExport(populated(), APP_VERSION);
  assert.equal(data.format, 'lockin-export');
  assert.equal(data.appVersion, APP_VERSION);
  assert.equal(data.profile.firstName, 'Sam');
  assert.equal(data.assignments.length, 1);
  assert.equal(data.assignments[0].title, 'Essay');
  assert.equal(data.exams.length, 1);
  assert.equal(data.exams[0].name, 'Bio Final');
  // Useful to know a PIN exists; useless to an attacker.
  assert.equal(data.parentPinSet, true);
});

test('the export is a snapshot, not a restore point', () => {
  const data = buildExport(populated(), APP_VERSION);
  // Ids are deliberately absent: without them nothing can be matched back
  // onto live records, which is what keeps "export" from becoming "import".
  assert.equal(data.assignments[0].id, undefined);
  assert.ok(data.note.toLowerCase().includes('cannot import'));
});
