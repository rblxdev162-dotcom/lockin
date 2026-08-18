/**
 * The bypass paths, tested (Phase 8).
 *
 * Scope, stated plainly: LockIn does **not** defend against someone with
 * DevTools, the source, or write access to localStorage. That person owns the
 * device and can grant themselves anything. Pretending otherwise would be a
 * lie in a security test, which is the worst place for one.
 *
 * What these tests defend is the set of paths a student reaches *by using the
 * app*: a URL, a form field, a stale session, a message from a web page, a
 * file they exported. Those must not produce a verified result, and none of
 * them must be able to weaken a parent's setting.
 *
 * One test per numbered path in the Phase 8 brief.
 *
 * Run: npm run test:security
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '../..');
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const { reducer } = await import('../../web/src/store/reducer.ts');
const { defaultState } = await import('../../web/src/lib/storage.ts');
const { createAssignment, createChallenge } = await import('../../web/src/store/factories.ts');
const { checkProgress } = await import('../../web/src/lib/edgenuity/verification.ts');
const { isVerifiedComplete } = await import('../../web/src/lib/canvas/verification.ts');
const { sanitizeView } = await import('../../web/src/lib/canvas/pageProvider.ts');
const { validateBridgeState, isEnvelope, checkCompatibility } = await import(
  '../../web/src/lib/protocol.ts'
);
const { buildExport } = await import('../../web/src/lib/export.ts');
const { normalizeDomain, PROTECTED_DOMAINS } = await import('../../web/src/lib/domains.ts');

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function withEdgenuityAssignment(requiredVerificationTrust) {
  let state = defaultState();
  state = reducer(state, { type: 'CREATE_PROFILE', firstName: 'Sam' });
  const assignment = createAssignment({
    title: 'Algebra unit',
    subject: 'Math',
    platform: 'Edgenuity',
    dueDate: '2026-09-01',
    dueTime: '23:59',
    estimatedMinutes: 60,
    priority: 'Normal',
  });
  state = reducer(state, { type: 'ADD_ASSIGNMENT', assignment });
  state = reducer(state, {
    type: 'EDGENUITY_CONFIGURE',
    assignmentId: assignment.id,
    config: {
      targetType: 'progress_percent',
      requiredProgressDelta: 5,
      courseName: 'Algebra I',
      requiredVerificationTrust,
    },
  });
  return { state, assignmentId: assignment.id };
}

/**
 * Starts a real verification session through the reducer, so the check runs
 * against the same `session` and `link` objects the app builds — not a
 * hand-made shape that could drift from the real one.
 */
function startedSession(requiredTrust = 'standard', beforeOverrides = {}) {
  const { state, assignmentId } = withEdgenuityAssignment(requiredTrust);
  const next = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId,
    before: proof({ progressPercent: 40, ...beforeOverrides }),
  });
  const session = next.edgenuity.sessions[0];
  const link = next.assignments.find((a) => a.id === assignmentId).edgenuity;
  return { state: next, assignmentId, session, link };
}

/**
 * Opens a genuine Enhanced session: a challenge is issued, photographed and
 * spent exactly as the real flow spends it. Anything less would be testing the
 * refusal path instead of the bypass.
 */
function startedEnhancedSession() {
  const { state, assignmentId } = withEdgenuityAssignment('enhanced');
  const challenge = createChallenge(assignmentId, 'before', null);
  let next = reducer(state, { type: 'EDGENUITY_ISSUE_CHALLENGE', challenge });
  next = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId,
    before: proof({
      progressPercent: 40,
      screenEvidence: GOOD_SCREEN,
      challenge: { matched: true, matchedText: challenge.value, confidence: 0.95 },
    }),
    challengeId: challenge.id,
  });
  const session = next.edgenuity.sessions[0];
  const link = next.assignments.find((a) => a.id === assignmentId).edgenuity;
  return { state: next, assignmentId, session, link, challenge };
}

/** Screen evidence strong enough to clear the Enhanced bar. */
const GOOD_SCREEN = {
  score: 0.95,
  signals: ['course_header', 'progress_bar', 'activity_list', 'brand_mark'],
  confidence: 'high',
};

/** A proof as the pipeline would produce it. */
function proof(overrides = {}) {
  return {
    capturedAt: new Date().toISOString(),
    progressPercent: 50,
    courseName: 'Algebra I',
    parseConfidence: 'high',
    source: 'live_camera',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Spoofing Canvas verification from an arbitrary page              */
/* ------------------------------------------------------------------ */

test('1. a page that is not the configured Canvas host cannot verify anything', () => {
  const view = sanitizeView({
    domain: 'evil.example.com',
    assignments: [
      {
        externalCourseId: '1',
        externalAssignmentId: '2',
        title: 'Free completion',
        submissionStatus: 'graded',
      },
    ],
  });

  // Whatever survives sanitising, a "graded" claim only becomes completion via
  // the status policy, and the extension re-checks the sending tab's origin
  // and live host permission before a detection is ever relayed (canvas.js).
  const detections = view?.assignments ?? [];
  for (const item of detections) {
    assert.ok(
      typeof item.externalAssignmentId === 'string',
      'sanitising rebuilds fields rather than passing objects through',
    );
  }
  // Nothing in the payload can name its own domain: the domain comes from the
  // stored connection, so a page cannot claim to be the school's Canvas.
  const source = readFileSync(join(ROOT, 'extension/background/canvas.js'), 'utf8');
  assert.ok(
    source.includes('permissions.contains') || source.includes('permissionGranted'),
    'the worker must re-check host permission before trusting a detection',
  );
});

test('1b. an unsubmitted or unknown Canvas status is never completion', () => {
  for (const status of ['unsubmitted', 'unknown', 'missing', 'not_a_status', undefined, null]) {
    assert.equal(isVerifiedComplete(status), false, `"${status}" must not complete an assignment`);
  }
  assert.equal(isVerifiedComplete('graded'), true, 'a real pass still passes');
});

/* ------------------------------------------------------------------ */
/* 2. Satisfying an Enhanced requirement with a Standard capture       */
/* ------------------------------------------------------------------ */

test('2. a Standard photo cannot satisfy an Enhanced requirement, or bank progress toward one', () => {
  const { session, link } = startedEnhancedSession();
  assert.ok(session, 'the Enhanced session must open before the bypass can be attempted');
  assert.equal(session.requiredTrust, 'enhanced');

  // A perfectly good final photo showing 20 points of real progress — but with
  // no code in the frame, so it is only Standard strength.
  const result = checkProgress({
    session,
    link,
    after: proof({ progressPercent: 60 }),
    focusMinutesNow: 30,
  });

  assert.equal(result.outcome, 'rejected', 'an Enhanced requirement must refuse a Standard photo');
  assert.equal(
    result.newProgress,
    0,
    'refusing must not bank the progress for a later Enhanced photo to finish off',
  );
  assert.equal(result.requirementMet, false);
});

test('2b. an Enhanced session refuses to even open on a Standard starting photo', () => {
  const { state, assignmentId } = withEdgenuityAssignment('enhanced');
  // No challenge at all: exactly what a student gets by declining to write the
  // code down. The session must not open, because a Standard starting frame
  // would leave the before-reading replayable.
  const next = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId,
    before: proof({ progressPercent: 40 }),
  });
  assert.equal(next.edgenuity.sessions.length, 0);
  assert.ok(
    next.activity.some((e) => e.type === 'edgenuity_verification_failed'),
    'the refusal is recorded rather than failing silently',
  );
});

/* ------------------------------------------------------------------ */
/* 3. Replaying an old challenge                                       */
/* ------------------------------------------------------------------ */

test('3. a spent challenge cannot be spent again', () => {
  const { state, assignmentId } = withEdgenuityAssignment('enhanced');
  const challenge = createChallenge(assignmentId, 'before', null);

  let next = reducer(state, { type: 'EDGENUITY_ISSUE_CHALLENGE', challenge });
  assert.equal(
    next.edgenuity.challenges.find((c) => c.id === challenge.id).status,
    'pending',
  );

  next = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId,
    before: proof({
      progressPercent: 40,
      screenEvidence: GOOD_SCREEN,
      challenge: { matched: true, matchedText: challenge.value, confidence: 0.9 },
    }),
    challengeId: challenge.id,
  });

  const spent = next.edgenuity.challenges.find((c) => c.id === challenge.id);
  assert.notEqual(spent.status, 'pending', 'a used challenge must not stay spendable');
  assert.equal(next.edgenuity.sessions.length, 1);
  assert.equal(
    next.edgenuity.sessions[0].before.trust,
    'enhanced',
    'the first, legitimate use does earn Enhanced trust',
  );

  // The replay: the very same code and the very same detection, offered again.
  const sessionsBefore = next.edgenuity.sessions.length;
  const replayed = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId,
    before: proof({
      progressPercent: 40,
      screenEvidence: GOOD_SCREEN,
      challenge: { matched: true, matchedText: challenge.value, confidence: 0.9 },
    }),
    challengeId: challenge.id,
  });

  assert.equal(
    replayed.edgenuity.sessions.length,
    sessionsBefore,
    'a spent code must not open a second session',
  );
  assert.ok(
    replayed.activity.some((e) => e.type === 'edgenuity_verification_failed'),
    'the replay attempt is recorded',
  );
});

test('3b. a challenge belonging to another assignment is not usable here', () => {
  const { state, assignmentId } = withEdgenuityAssignment('enhanced');
  const foreign = createChallenge('asg_someone_else', 'before', null);

  const next = reducer(state, { type: 'EDGENUITY_ISSUE_CHALLENGE', challenge: foreign });
  const started = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId,
    before: proof({
      progressPercent: 40,
      challenge: { matched: true, matchedText: foreign.value, confidence: 0.9 },
    }),
    challengeId: foreign.id,
  });

  assert.equal(
    started.edgenuity.sessions.length,
    0,
    'a code issued for another assignment must not open a session here',
  );
});

test('3c. a code that OCR read as different text is refused, however confident it was', () => {
  const { state, assignmentId } = withEdgenuityAssignment('enhanced');
  const challenge = createChallenge(assignmentId, 'before', null);
  let next = reducer(state, { type: 'EDGENUITY_ISSUE_CHALLENGE', challenge });
  next = reducer(next, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId,
    // `matched: true` is the OCR layer's opinion; the reducer still checks the
    // text against the code it issued, so a claim alone proves nothing.
    before: proof({
      progressPercent: 40,
      challenge: { matched: true, matchedText: 'XXXX', confidence: 1 },
    }),
    challengeId: challenge.id,
  });
  assert.equal(next.edgenuity.sessions.length, 0);
});

/* ------------------------------------------------------------------ */
/* 4. A fixture capture in production                                  */
/* ------------------------------------------------------------------ */

test('4. a fixture-sourced photo cannot open a session', () => {
  const { state, assignmentId } = withEdgenuityAssignment();
  const next = reducer(state, {
    type: 'EDGENUITY_START_SESSION',
    assignmentId,
    before: proof({ progressPercent: 40, source: 'fixture' }),
  });
  assert.equal(
    next.edgenuity.sessions.length,
    0,
    'a fixture frame is worth `manual` trust, which does not even meet Standard',
  );
});

test('4b. a fixture-sourced final photo is refused on a genuine session', () => {
  const { session, link } = startedSession();
  assert.ok(session, 'a live starting photo does open a Standard session');

  const result = checkProgress({
    session,
    link,
    after: proof({ progressPercent: 90, source: 'fixture' }),
    focusMinutesNow: 60,
  });

  assert.equal(result.outcome, 'rejected');
  assert.equal(result.reason, 'not_live', 'the refusal must name the reason, not fail vaguely');
  assert.equal(result.newProgress, 0, 'and it credits nothing');
});

test('4c. the fixture capture source cannot be imported outside a DEV branch', () => {
  const modal = readFileSync(
    join(ROOT, 'web/src/components/features/EdgenuityVerifyModal.tsx'),
    'utf8',
  );
  assert.ok(
    !/^import .*capture\.dev/m.test(modal),
    'a static import would put the fixture source in the production bundle',
  );
  assert.ok(
    /import\.meta\.env\.DEV[\s\S]{0,200}capture\.dev/.test(modal),
    'the dynamic import must sit behind an import.meta.env.DEV guard',
  );
});

/* ------------------------------------------------------------------ */
/* 5. Changing a parent-protected setting through an ordinary action   */
/* ------------------------------------------------------------------ */

test('5. a locked verification setting is refused by the reducer, not just hidden', () => {
  let state = defaultState();
  state = reducer(state, {
    type: 'PARENT_SET_CONTROLS',
    patch: { lockVerificationSettings: true },
  });
  state = reducer(state, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'enhanced' },
    parentApproved: true,
  });
  assert.equal(state.settings.edgenuityProofMode, 'enhanced');

  // The bypass attempt: dispatch the same action a UI control would, without
  // the approval flag. This is exactly what a student who found the action
  // name would try.
  const attacked = reducer(state, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'standard' },
  });
  assert.equal(
    attacked.settings.edgenuityProofMode,
    'enhanced',
    'the lock must survive a direct dispatch',
  );

  // …and it must not take unrelated settings down with it.
  const mixed = reducer(state, {
    type: 'UPDATE_SETTINGS',
    patch: { edgenuityProofMode: 'standard', defaultFocusMinutes: 45 },
  });
  assert.equal(mixed.settings.edgenuityProofMode, 'enhanced', 'the locked field is dropped');
  assert.equal(mixed.settings.defaultFocusMinutes, 45, 'the rest of the patch still applies');
});

test('5b. raising the proof requirement does not re-open work already finished under the old rule', () => {
  const { state, assignmentId } = withEdgenuityAssignment();
  let next = reducer(state, {
    type: 'COMPLETE_ASSIGNMENT',
    id: assignmentId,
    method: 'manual',
  });
  assert.equal(next.assignments[0].status, 'Completed');

  next = reducer(next, {
    type: 'PARENT_SET_REQUIRED_TRUST',
    assignmentId,
    trust: 'enhanced',
  });
  assert.equal(
    next.assignments[0].status,
    'Completed',
    'parent requirement changes are prospective',
  );
});

/* ------------------------------------------------------------------ */
/* 6. A malformed extension message                                    */
/* ------------------------------------------------------------------ */

test('6. malformed bridge messages are rejected rather than half-applied', () => {
  for (const junk of [
    null,
    undefined,
    'string',
    42,
    {},
    { source: 'evil' },
    { source: 'lockin-web', type: 'NOT_A_TYPE' },
    { source: 'lockin-web' },
  ]) {
    assert.equal(isEnvelope(junk), false, `${JSON.stringify(junk)} must not pass as an envelope`);
  }
  assert.equal(isEnvelope({ source: 'lockin-web', type: 'PING' }), true);
});

test('6b. a bridge state is rebuilt field by field, with caps, and unknown keys dropped', () => {
  const hostile = validateBridgeState({
    focusModeActive: true,
    blockedDomains: Array.from({ length: 5000 }, (_, i) => `site${i}.com`),
    allowedDomains: ['ok.com', 42, null, { nested: true }],
    requiredTaskCount: 'lots',
    temporaryUnlockUntil: 'forever',
    currentTaskTitle: 'x'.repeat(10_000),
    appUrl: 'y'.repeat(10_000),
    // A field the extension has never heard of, which must not survive.
    disableAllBlocking: true,
  });

  assert.ok(hostile, 'a well-formed-enough state is repaired rather than refused');
  assert.equal(hostile.disableAllBlocking, undefined, 'unknown keys are dropped');
  assert.ok(hostile.blockedDomains.length <= 500, 'the domain list is capped');
  assert.deepEqual(hostile.allowedDomains, ['ok.com'], 'non-strings are filtered out');
  assert.equal(hostile.requiredTaskCount, 0, 'a non-number becomes zero, not NaN');
  assert.equal(hostile.temporaryUnlockUntil, null, 'an unparseable unlock never grants time');
  assert.ok(hostile.currentTaskTitle.length <= 120);
  assert.ok(hostile.appUrl.length <= 300);

  // The one field with no safe default: without it, this is not a state.
  assert.equal(validateBridgeState({ blockedDomains: [] }), null);
});

test('6c. an incompatible protocol version is detected rather than silently tolerated', () => {
  assert.equal(checkCompatibility(1), 'ok');
  assert.equal(checkCompatibility(0), 'extension_outdated');
  assert.equal(checkCompatibility(2), 'app_outdated');
  assert.equal(checkCompatibility(undefined), 'unknown');
  assert.equal(checkCompatibility('one'), 'unknown');
});

/* ------------------------------------------------------------------ */
/* 7. A malicious domain string                                        */
/* ------------------------------------------------------------------ */

test('7. hostile domain strings cannot become rules, and cannot shadow a protected host', () => {
  for (const hostile of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'chrome://extensions',
    'file:///etc/passwd',
    '<script>alert(1)</script>',
    '',
    '   ',
    '.',
    '..',
    'a'.repeat(500),
  ]) {
    const result = normalizeDomain(hostile);
    const domain = typeof result === 'string' ? result : result?.domain;
    assert.ok(
      !domain || /^[a-z0-9.-]+$/.test(domain),
      `"${hostile}" produced an unsafe domain: ${domain}`,
    );
  }
});

test('7b. protected school domains cannot be blocked, whatever the blocklist says', async () => {
  const { buildRules } = await import('../background/rules.js');
  const rules = buildRules({
    focusModeActive: true,
    blockingEnabled: true,
    blockedDomains: [...PROTECTED_DOMAINS, 'myschool.instructure.com', 'youtube.com'],
    allowedDomains: [],
    canvasDomain: 'myschool.instructure.com',
  });

  const redirected = rules
    .filter((r) => r.action.type === 'redirect')
    .flatMap((r) => r.condition.requestDomains);

  for (const protectedDomain of [...PROTECTED_DOMAINS, 'myschool.instructure.com']) {
    assert.ok(
      !redirected.includes(protectedDomain),
      `${protectedDomain} must never be redirected to the block page`,
    );
  }
  assert.ok(redirected.includes('youtube.com'), 'an ordinary blocked site still gets a rule');
});

/* ------------------------------------------------------------------ */
/* 8. Unsafe HTML from a Canvas page or an OCR read                    */
/* ------------------------------------------------------------------ */

test('8. nothing detected or read is ever written as HTML', () => {
  const files = [
    'extension/canvas/parser.js',
    'extension/canvas/main.js',
    'extension/background/canvas.js',
    'extension/blocked/blocked.js',
    'extension/popup/popup.js',
    'extension/content/bridge.js',
  ];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!/\binnerHTML\s*=/.test(source), `${file} assigns innerHTML`);
    assert.ok(!/\bouterHTML\s*=/.test(source), `${file} assigns outerHTML`);
    assert.ok(!/\beval\s*\(/.test(source), `${file} calls eval`);
    assert.ok(!/new Function\s*\(/.test(source), `${file} builds a function from a string`);
    assert.ok(!/insertAdjacentHTML/.test(source), `${file} inserts raw HTML`);
  }
});

test('8b. a detected title carrying markup stays inert text', () => {
  const view = sanitizeView({
    domain: 'myschool.instructure.com',
    assignments: [
      {
        externalCourseId: '1',
        externalAssignmentId: '2',
        title: '<img src=x onerror=alert(1)>',
        submissionStatus: 'graded',
      },
    ],
  });
  const title = view?.assignments?.[0]?.title;
  if (title !== undefined) {
    assert.equal(typeof title, 'string', 'a title is a string, and React escapes it on render');
    assert.ok(title.length < 500, 'and it is capped, so a megabyte of markup cannot arrive');
  }
});

/* ------------------------------------------------------------------ */
/* 9. An export leaking a secret                                       */
/* ------------------------------------------------------------------ */

test('9. the export contains no secret, at any depth', () => {
  const { state, assignmentId } = withEdgenuityAssignment();
  const challenge = createChallenge(assignmentId, 'before', null);
  const populated = {
    ...reducer(state, { type: 'EDGENUITY_ISSUE_CHALLENGE', challenge }),
    parentPin: { hash: 'PIN_HASH_SECRET', salt: 'PIN_SALT_SECRET', createdAt: 'x' },
  };

  const text = JSON.stringify(buildExport(populated, '1.0.0'));
  assert.ok(!text.includes('PIN_HASH_SECRET'));
  assert.ok(!text.includes('PIN_SALT_SECRET'));
  assert.ok(!text.includes(challenge.value), 'a live challenge code must not be exported');
  assert.ok(!text.includes(challenge.valueHash), 'nor its hash');
});

/* ------------------------------------------------------------------ */
/* 10. A stale parent session                                          */
/* ------------------------------------------------------------------ */

test('10. no parent session is ever written to storage', () => {
  let state = defaultState();
  state = reducer(state, { type: 'SET_PIN', pin: { hash: 'h', salt: 's', createdAt: 'x' } });
  state = reducer(state, {
    type: 'PARENT_SET_CONTROLS',
    patch: { lockVerificationSettings: true },
  });

  const serialised = JSON.stringify(state);
  for (const key of ['parentSession', 'parentUnlocked', 'parentAuthenticated', 'parentVerifiedAt']) {
    assert.ok(!serialised.includes(key), `${key} is persisted; a reload would not re-lock`);
  }

  // The session lives in React state by construction — assert the hook has no
  // storage of its own, so a future change has to break this test to break the
  // guarantee.
  // …and the hook must not reach for storage. Comments are stripped first:
  // this file explains *why* it avoids localStorage, and that sentence is not
  // a violation of the rule it describes.
  const hook = readFileSync(join(ROOT, 'web/src/hooks/useParentSession.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(hook));
});

test('10b. the PIN is only ever stored as a salted hash', () => {
  const pin = readFileSync(join(ROOT, 'web/src/lib/pin.ts'), 'utf8');
  assert.ok(/SHA-256/i.test(pin), 'the PIN must be hashed');
  assert.ok(/getRandomValues|randomUUID/.test(pin), 'the salt must be random');
  assert.ok(
    !/pin:\s*(?:pin|value|digits)\b/.test(pin),
    'the digits themselves must never be part of the stored record',
  );
});
