/**
 * The bridge — the parts that can be tested without driving Chrome.
 *
 * Everything here is about what the bridge *refuses*, because that is the half
 * that matters. This is a local HTTP endpoint that can reach into a browser;
 * the interesting failure is not "it didn't read a course", it is "something
 * that should never have been able to call it, did".
 *
 * Phase 16 removed the Edgenuity reading endpoints; what remains — and what is
 * tested here — is the fence itself, which the School Companion bridge reuses.
 *
 * Run: npm run test:bridge
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { bridgeCallerAllowed } = await import('../../scripts/serve.mjs').catch(() => ({}));

/* ------------------------------------------------------------------ */
/* Who is allowed to call it                                           */
/* ------------------------------------------------------------------ */

test('the bridge header is required', { skip: !bridgeCallerAllowed }, () => {
  // Without it, a cross-origin form post or <img> could reach the route. With
  // it, the browser must preflight — and the server never answers preflights.
  assert.equal(bridgeCallerAllowed({}), false);
  assert.equal(bridgeCallerAllowed({ 'x-lockin-bridge': '0' }), false);
  assert.equal(bridgeCallerAllowed({ 'x-lockin-bridge': '1' }), true);
});

test('a foreign origin is refused even with the header', { skip: !bridgeCallerAllowed }, () => {
  assert.equal(
    bridgeCallerAllowed({ 'x-lockin-bridge': '1', origin: 'https://evil.example' }),
    false,
  );
  assert.equal(
    bridgeCallerAllowed({ 'x-lockin-bridge': '1', origin: 'http://localhost:5173' }, 5173),
    true,
  );
  assert.equal(
    bridgeCallerAllowed({ 'x-lockin-bridge': '1', origin: 'http://127.0.0.1:5173' }, 5173),
    true,
  );
  // Same host, wrong port: not this server.
  assert.equal(
    bridgeCallerAllowed({ 'x-lockin-bridge': '1', origin: 'http://localhost:9999' }, 5173),
    false,
  );
});

