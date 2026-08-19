/**
 * The local context bridge.
 *
 * Everything here is about what it refuses. This is the one component that
 * accepts a message originating in a different Chrome profile, so the tests
 * are the threat model written down: no secret, wrong secret, wrong header,
 * replayed message, stale clock, oversized body, and a payload trying to smuggle
 * a field that does not exist.
 *
 * Run: npm run test:context-bridge
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createContextBridge, CONTEXT_TTL_MS, MAX_BODY_BYTES } = await import(
  '../../scripts/context-bridge.mjs'
);
const { sanitizeContext, workingIn } = await import('../../web/src/lib/context/client.ts');
const { providerFor } = await import('../../school-companion/background.js').catch(() => ({}));

const NOW = Date.parse('2026-03-10T18:00:00Z');
const MINUTE = 60_000;

/** A bridge whose clock the test controls. */
function bridgeAt(clock) {
  return createContextBridge({ now: () => clock.now });
}

function report(patch = {}, at = NOW) {
  return {
    provider: 'edgenuity',
    activity: 'active',
    startedAt: at - 10 * MINUTE,
    lastActiveAt: at,
    sentAt: at,
    nonce: `n${Math.random().toString(36).slice(2, 12)}`,
    ...patch,
  };
}

const headers = (secret) => ({ 'x-lockin-bridge': '1', 'x-lockin-secret': secret });

/* ------------------------------------------------------------------ */
/* Authorization                                                       */
/* ------------------------------------------------------------------ */

test('nothing is accepted before a pairing code has been issued', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const result = bridge.report(report(), headers('anything'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-paired');
});

test('a wrong pairing code is refused', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  bridge.pair();
  const result = bridge.report(report(), headers('not-the-secret'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unauthorized');
  assert.equal(bridge.snapshot().context.length, 0);
});

test('the custom header is required, so a plain cross-origin post cannot reach it', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const secret = bridge.pair();
  const result = bridge.report(report(), { 'x-lockin-secret': secret });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'header');
});

test('a correct code is accepted, and the context reads back', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const secret = bridge.pair();
  assert.equal(bridge.report(report(), headers(secret)).ok, true);

  const snapshot = bridge.snapshot();
  assert.equal(snapshot.paired, true);
  assert.equal(snapshot.context.length, 1);
  assert.equal(snapshot.context[0].provider, 'edgenuity');
  assert.equal(snapshot.context[0].activity, 'active');
});

test('re-pairing invalidates the old code', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const first = bridge.pair();
  const second = bridge.pair();
  assert.notEqual(first, second);
  assert.equal(bridge.report(report(), headers(first)).ok, false);
  assert.equal(bridge.report(report(), headers(second)).ok, true);
});

test('unpairing stops everything and forgets what was held', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const secret = bridge.pair();
  bridge.report(report(), headers(secret));
  assert.equal(bridge.snapshot().context.length, 1);

  bridge.unpair();
  assert.equal(bridge.snapshot().paired, false);
  assert.equal(bridge.snapshot().context.length, 0);
  assert.equal(bridge.report(report(), headers(secret)).ok, false);
});

test('the secret comparison is length-safe and does not throw', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  bridge.pair();
  assert.equal(bridge.secretMatches(''), false);
  assert.equal(bridge.secretMatches('x'), false);
  assert.equal(bridge.secretMatches('x'.repeat(500)), false);
  assert.equal(bridge.secretMatches(null), false);
  assert.equal(bridge.secretMatches(undefined), false);
});

/* ------------------------------------------------------------------ */
/* Replay and freshness                                                */
/* ------------------------------------------------------------------ */

test('a replayed message is refused the second time', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const secret = bridge.pair();
  const message = report();

  assert.equal(bridge.report(message, headers(secret)).ok, true);
  const second = bridge.report(message, headers(secret));
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'replay');
});

test('a message from too far in the past or future is refused', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const secret = bridge.pair();

  const old = bridge.report(report({ sentAt: NOW - 10 * MINUTE }), headers(secret));
  assert.equal(old.reason, 'stale');

  const future = bridge.report(report({ sentAt: NOW + 10 * MINUTE }), headers(secret));
  assert.equal(future.reason, 'stale');

  // Inside the window is fine — clocks are never exactly in step.
  assert.equal(bridge.report(report({ sentAt: NOW - 30_000 }), headers(secret)).ok, true);
});

test('context expires rather than being served with an age attached', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const secret = bridge.pair();
  bridge.report(report(), headers(secret));
  assert.equal(bridge.snapshot().context.length, 1);

  clock.now = NOW + CONTEXT_TTL_MS + MINUTE;
  assert.equal(bridge.snapshot().context.length, 0, 'an hour ago is not context for now');
});

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

test('an unknown provider or activity is refused outright', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const secret = bridge.pair();

  assert.equal(bridge.report(report({ provider: 'khan' }), headers(secret)).reason, 'schema');
  assert.equal(bridge.report(report({ activity: 'reading' }), headers(secret)).reason, 'schema');
  assert.equal(bridge.report('a string', headers(secret)).reason, 'schema');
  assert.equal(bridge.report(null, headers(secret)).reason, 'schema');
  assert.equal(bridge.report([], headers(secret)).reason, 'schema');
});

test('there is no field for page content, and extra keys are dropped', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const secret = bridge.pair();

  const smuggled = report({
    url: 'https://edgenuity.com/lesson/42',
    pageText: 'The answer is B',
    cookie: 'session=abc',
    grade: 91,
    courseName: 'Algebra I',
  });
  assert.equal(bridge.report(smuggled, headers(secret)).ok, true);

  const stored = JSON.stringify(bridge.snapshot());
  for (const leak of ['edgenuity.com/lesson', 'The answer', 'session=abc', 'Algebra']) {
    assert.ok(!stored.includes(leak), `"${leak}" reached the bridge`);
  }
  assert.equal(bridge.snapshot().context[0].grade, undefined);
});

test('a validated report has exactly the fields the design names', () => {
  const clock = { now: NOW };
  const bridge = bridgeAt(clock);
  const clean = bridge.validate(report());
  assert.deepEqual(Object.keys(clean).sort(), [
    'activity',
    'lastActiveAt',
    'nonce',
    'provider',
    'sentAt',
    'startedAt',
  ]);
});

test('the body cap is small enough that nothing can be smuggled inside it', () => {
  // 4KB is far more than four numbers and two enums need, and far less than a
  // page of anything.
  assert.ok(MAX_BODY_BYTES <= 8192);
});

/* ------------------------------------------------------------------ */
/* The page's side                                                     */
/* ------------------------------------------------------------------ */

test('the page rebuilds a snapshot field by field', () => {
  const clean = sanitizeContext({
    paired: true,
    context: [
      { provider: 'edgenuity', activity: 'active', lastActiveAt: NOW, receivedAt: NOW, ageMs: 1000, evil: 'x' },
      { provider: 'tiktok', activity: 'active', lastActiveAt: NOW, receivedAt: NOW },
      { provider: 'canvas', activity: 'nonsense', lastActiveAt: NOW, receivedAt: NOW },
      'not an object',
    ],
  });
  assert.equal(clean.paired, true);
  assert.equal(clean.context.length, 1);
  assert.equal(clean.context[0].evil, undefined);
});

test('presence is only current presence', () => {
  const fresh = sanitizeContext({
    paired: true,
    context: [{ provider: 'edgenuity', activity: 'active', lastActiveAt: NOW, receivedAt: NOW, ageMs: 30_000 }],
  });
  assert.equal(workingIn(fresh, 'edgenuity'), true);
  assert.equal(workingIn(fresh, 'canvas'), false);

  const stale = sanitizeContext({
    paired: true,
    context: [{ provider: 'edgenuity', activity: 'active', lastActiveAt: NOW, receivedAt: NOW, ageMs: 9 * MINUTE }],
  });
  assert.equal(workingIn(stale, 'edgenuity'), false);

  const closed = sanitizeContext({
    paired: true,
    context: [{ provider: 'edgenuity', activity: 'closed', lastActiveAt: NOW, receivedAt: NOW, ageMs: 1000 }],
  });
  assert.equal(workingIn(closed, 'edgenuity'), false);
});

/* ------------------------------------------------------------------ */
/* The School Companion's own rules                                    */
/* ------------------------------------------------------------------ */

test('the School Companion recognises only the two providers', { skip: !providerFor }, () => {
  assert.equal(providerFor('https://example.instructure.com/courses/1'), 'canvas');
  assert.equal(providerFor('https://r15.core.learn.edgenuity.com/player'), 'edgenuity');
  assert.equal(providerFor('https://www.imagineedgenuity.com/x'), 'edgenuity');
  assert.equal(providerFor('https://youtube.com'), null);
  assert.equal(providerFor('chrome://extensions'), null);
  assert.equal(providerFor(undefined), null);
});

test('the School Companion asks for no permission that could read a page', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(
    readFileSync(new URL('../../school-companion/manifest.json', import.meta.url), 'utf8'),
  );

  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'storage', 'tabs']);
  assert.ok(!manifest.permissions.includes('scripting'), 'it must not be able to inject code');
  assert.equal(manifest.content_scripts, undefined, 'and it has no content script at all');
  // Its only host permission is LockIn's own loopback service.
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
});

test('the School Companion ships disabled and stays disabled until confirmed', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../../school-companion/background.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /enabled:\s*false/, 'the default must be off');
  // The tick refuses on any of the three conditions, so an enabled flag alone
  // is not enough to start reporting.
  assert.match(source, /!config\.enabled \|\| !config\.secret \|\| !config\.authorizedConfirmed/);
});
