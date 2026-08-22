/**
 * Canvas parser tests — real DOM, real fixture pages.
 *
 * The parser works on documents, so it is tested in an actual browser rather
 * than against a simulated DOM. Each fixture is served over HTTPS from a fake
 * Canvas hostname mapped to localhost, then the extension's own parser modules
 * are imported into that page and run against it.
 *
 * Run: node extension/tests/canvas-parser.test.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvasFixtureServer } from './canvas-server.mjs';
import { findChrome, killChrome, launchChrome, requirePortFree } from './chrome-harness.mjs';

const CHROME = findChrome();

const CANVAS_HOST = 'myschool.instructure.com';
const CUSTOM_HOST = 'canvas.schooldistrict.org';
const TLS_PORT = 8453;
const CDP_PORT = 9380;

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✖ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ---------------- CDP plumbing ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res);
      this.ws.addEventListener('error', rej);
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve(msg);
      }
    });
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
    });
  }
  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

async function fetchJSON(path) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

/* ---------------- runner ---------------- */

const profile = mkdtempSync(join(tmpdir(), 'lockin-parser-'));
let chrome = null;
let fixtures = null;

/**
 * Loads a fixture page and runs an expression against it with the parser
 * modules imported. `expr` receives `{ parser, urls, status, detector }`.
 */
async function inPage(browser, url, expr) {
  const { targetId } = (await browser.send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (
    await browser.send('Target.attachToTarget', { targetId, flatten: true })
  ).result;
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(700);

  const wrapped = `(async () => {
    // Same-origin import: the fixture server answers /module/* on every host
    // it serves, so this also works on the custom-domain fixture.
    const base = location.origin + '/module/';
    const [parser, urls, status, detector] = await Promise.all([
      import(base + 'parser.js'),
      import(base + 'urls.js'),
      import(base + 'status.js'),
      import(base + 'detector.js'),
    ]);
    const modules = { parser, urls, status, detector };
    return JSON.stringify(await (${expr})(modules));
  })()`;

  const result = await browser.send(
    'Runtime.evaluate',
    { expression: wrapped, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  await browser.send('Target.closeTarget', { targetId });

  if (result.result?.exceptionDetails) {
    throw new Error(
      result.result.exceptionDetails.text +
        ' ' +
        (result.result.exceptionDetails.exception?.description || ''),
    );
  }
  return JSON.parse(result.result.result.value);
}

async function main() {
  if (!CHROME) {
    console.error('\nNo Chrome for Testing found. Set CHROME_BIN.\n');
    process.exit(1);
  }

  await requirePortFree(CDP_PORT, 'Chrome debug port');
  fixtures = createCanvasFixtureServer({ certDir: profile });
  await fixtures.listen(TLS_PORT);

  chrome = launchChrome(
    CHROME,
    [
      '--headless=new',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      `--host-resolver-rules=MAP ${CANVAS_HOST} 127.0.0.1:${TLS_PORT},MAP ${CUSTOM_HOST} 127.0.0.1:${TLS_PORT}`,
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
  );

  const version = await fetchJSON('/json/version');
  const browser = new CDP(version.webSocketDebuggerUrl);

  console.log('\nCanvas parser tests (real DOM, local fixtures)\n');

  /* ---- 1. Detect a Canvas page ---- */
  console.log('Detection');
  const detectDash = await inPage(
    browser,
    `https://${CANVAS_HOST}/`,
    `({ detector }) => detector.detectCanvasPage(document, location.href, '${CANVAS_HOST}')`,
  );
  check('detects a Canvas dashboard', detectDash.isCanvas === true, JSON.stringify(detectDash.signals));

  /* ---- 2. Reject a non-Canvas page ---- */
  const detectNews = await inPage(
    browser,
    `https://${CANVAS_HOST}/news`,
    `({ detector }) => detector.detectCanvasPage(document, location.href, '${CANVAS_HOST}')`,
  );
  check('rejects a non-Canvas page on the same host', detectNews.isCanvas === false, detectNews.reason);

  const detectWrongHost = await inPage(
    browser,
    `https://${CANVAS_HOST}/`,
    `({ detector }) => detector.detectCanvasPage(document, location.href, 'someone-else.instructure.com')`,
  );
  check(
    'rejects a page that is not on the configured domain',
    detectWrongHost.isCanvas === false && detectWrongHost.reason === 'origin-mismatch',
  );

  /* ---- 3/4/5/6. Ids, titles, due dates from a list page ---- */
  console.log('\nList parsing');
  const index = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/101/assignments`,
    `({ parser }) => parser.parseCanvasAssignmentsPage(document, location.href)`,
  );
  const ch7 = index.find((a) => a.title === 'Chapter 7 Homework');
  check('parses the course id', ch7?.externalCourseId === '101');
  check('parses the assignment id', ch7?.externalAssignmentId === '5001');
  check('parses the assignment title', ch7?.title === 'Chapter 7 Homework');
  check('parses the due date', typeof ch7?.dueAt === 'string' && ch7.dueAt.startsWith('2026-08-15'));
  check('parses points possible', ch7?.pointsPossible === 20);
  check('finds every assignment in the list', index.length === 3, `got ${index.length}`);

  const noDue = index.find((a) => a.externalAssignmentId === '5003');
  check('an assignment with no due date parses with no dueAt', noDue && noDue.dueAt === undefined);

  const listSubmitted = index.find((a) => a.externalAssignmentId === '5002');
  check('reads a submitted pill on a list row', listSubmitted?.submissionStatus === 'submitted');

  /* ---- The class Assignments page in Canvas' pill-free markup ---- */
  const classic = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/303/assignments`,
    `({ parser }) => parser.parseCanvasPage(document, location.href)`,
  );
  const classicBy = (id) =>
    classic.assignments.find((a) => a.externalAssignmentId === id)?.submissionStatus;
  check('the class Assignments page is recognised as such', classic.pageKind === 'assignments_index');
  check(
    'reads "was submitted" wording with no pill present',
    classicBy('8001') === 'submitted',
    classicBy('8001'),
  );
  check(
    'reads submitted-late wording as late_submitted',
    classicBy('8002') === 'late_submitted',
    classicBy('8002'),
  );
  check(
    'reads "was not submitted" as not submitted, never as done',
    classicBy('8003') === 'not_submitted',
    classicBy('8003'),
  );
  check(
    'the word "submitted" in a description never marks a row done',
    classicBy('8004') === 'unknown',
    classicBy('8004'),
  );
  check(
    'the Assignments page reports how many rows answered',
    classic.diagnostics?.rowsRead === 3 && classic.diagnostics?.rowsConsidered === 4,
    JSON.stringify(classic.diagnostics),
  );

  /* ---- 7-11. Submission states on detail pages ---- */
  console.log('\nSubmission states');
  const states = [
    ['not submitted', '/courses/101/assignments/5001', 'not_submitted'],
    ['submitted', '/courses/101/assignments/5001/submitted', 'submitted'],
    ['graded', '/courses/202/assignments/6001', 'graded'],
    ['missing', '/courses/101/assignments/5004', 'missing'],
    ['late + submitted', '/courses/202/assignments/6002', 'late_submitted'],
  ];
  for (const [label, path, expected] of states) {
    const parsed = await inPage(
      browser,
      `https://${CANVAS_HOST}${path}`,
      `({ parser }) => parser.parseCanvasAssignmentPage(document, location.href)`,
    );
    check(
      `parses ${label}`,
      parsed[0]?.submissionStatus === expected,
      `got ${parsed[0]?.submissionStatus}`,
    );
  }

  /* ---- How the work is handed in at all ---- */
  console.log('\nSubmission types');
  const typeOf = async (path) =>
    inPage(
      browser,
      `https://${CANVAS_HOST}${path}`,
      `({ parser }) => {
         const parsed = parser.parseCanvasAssignmentPage(document, location.href);
         return { type: parsed[0]?.submissionType, status: parsed[0]?.submissionStatus };
       }`,
    );

  const paper = await typeOf('/courses/101/assignments/5006');
  check('reads "Submitting: on paper" as paper homework', paper.type === 'on_paper', paper.type);
  check(
    'and still reports what Canvas said about the submission, unchanged',
    paper.status === 'missing',
    paper.status,
  );

  const none = await typeOf('/courses/101/assignments/5007');
  check('reads "no submission" as nothing to hand in', none.type === 'none', none.type);

  const online = await typeOf('/courses/202/assignments/6003');
  check('reads a file upload as online work', online.type === 'online', online.type);

  const silent = await typeOf('/courses/101/assignments/5001');
  check(
    'a page that never says stays undefined, never a guess',
    silent.type === undefined,
    String(silent.type),
  );

  /* ---- Quizzes ---- */
  console.log('\nQuizzes and external tools');
  const quizOk = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/202/quizzes/7001`,
    `({ parser }) => parser.parseCanvasAssignmentPage(document, location.href)`,
  );
  check('a quiz with a reliable status verifies', quizOk[0]?.submissionStatus === 'submitted');
  check('a quiz gets a quiz-scoped id', quizOk[0]?.externalAssignmentId === 'quiz_7001');

  const quizAmbiguous = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/202/quizzes/7002`,
    `({ parser, status }) => {
       const parsed = parser.parseCanvasAssignmentPage(document, location.href);
       return { s: parsed[0]?.submissionStatus, complete: status.isVerifiedComplete(parsed[0]?.submissionStatus) };
     }`,
  );
  check(
    'an ambiguous quiz reports verification_unavailable',
    quizAmbiguous.s === 'verification_unavailable',
    quizAmbiguous.s,
  );
  check('an ambiguous quiz never counts as complete', quizAmbiguous.complete === false);

  const external = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/101/assignments/5005`,
    `({ parser, status }) => {
       const parsed = parser.parseCanvasAssignmentPage(document, location.href);
       return { s: parsed[0]?.submissionStatus, complete: status.isVerifiedComplete(parsed[0]?.submissionStatus) };
     }`,
  );
  check(
    'an external-tool assignment reports verification_unavailable',
    external.s === 'verification_unavailable',
    external.s,
  );
  check('an external-tool assignment never counts as complete', external.complete === false);

  /* ---- Malformed page ---- */
  console.log('\nSafety');
  const malformed = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/101/assignments/9999`,
    `({ parser, status }) => {
       const page = parser.parseCanvasPage(document, location.href);
       const first = page.assignments[0];
       return {
         readable: page.readable,
         count: page.assignments.length,
         anyComplete: page.assignments.some((a) => status.isVerifiedComplete(a.submissionStatus)),
         firstStatus: first ? first.submissionStatus : null,
       };
     }`,
  );
  check(
    'a malformed Canvas-like page never yields a completed assignment',
    malformed.anyComplete === false,
    JSON.stringify(malformed),
  );

  /* ---- Unsafe HTML must be text, never markup ---- */
  const xss = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/101/assignments`,
    `({ parser }) => {
       // Inject a hostile title into the live DOM, exactly as a compromised or
       // mischievous Canvas page could.
       const row = document.querySelector('#assignment_5001 .ig-title');
       row.textContent = '<img src=x onerror=alert(1)>Chapter 7';
       const parsed = parser.parseCanvasAssignmentsPage(document, location.href);
       const hit = parsed.find((a) => a.externalAssignmentId === '5001');
       return { title: hit.title, isString: typeof hit.title === 'string' };
     }`,
  );
  check(
    'hostile markup in a title is carried as inert text',
    xss.isString && xss.title.includes('<img') && !xss.title.includes(' '),
    xss.title,
  );

  /* ---- Custom Canvas domain ---- */
  console.log('\nCustom domain');
  const custom = await inPage(
    browser,
    `https://${CUSTOM_HOST}/courses/777/assignments`,
    `({ parser, detector }) => ({
       detected: detector.detectCanvasPage(document, location.href, '${CUSTOM_HOST}').isCanvas,
       parsed: parser.parseCanvasAssignmentsPage(document, location.href),
     })`,
  );
  check('a self-hosted Canvas domain is detected', custom.detected === true);
  check(
    'assignments parse on a custom domain',
    custom.parsed[0]?.externalAssignmentId === '9001',
    JSON.stringify(custom.parsed.map((p) => p.externalAssignmentId)),
  );

  /* ---- Dashboard courses ---- */
  const courses = await inPage(
    browser,
    `https://${CANVAS_HOST}/`,
    `({ parser }) => parser.parseCanvasCourses(document, location.href)`,
  );
  check('course names are read from the dashboard', courses.length >= 2, JSON.stringify(courses));
  check(
    'the raw Canvas course code is preserved',
    courses.some((c) => c.originalName === 'MATH-7-P3-26-27-SMITH'),
  );

  /* ---- Grades pages (Phase 18) ---- */
  console.log('\nGrades pages');
  const gradebook = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/101/grades`,
    `({ parser }) => parser.parseCanvasPage(document, location.href)`,
  );
  const row = (title) => gradebook.assignments.find((a) => a.title === title);

  check('the gradebook is recognised as its own page kind', gradebook.pageKind === 'grades');
  check(
    'every row is identified from its href, not its text',
    gradebook.assignments.every((a) => /^\d+$/.test(a.externalAssignmentId)),
    JSON.stringify(gradebook.assignments.map((a) => a.externalAssignmentId)),
  );
  check(
    'a marked row reads as graded, with its score and points',
    row('Chapter 7 Homework')?.submissionStatus === 'graded' &&
      row('Chapter 7 Homework')?.score === 18 &&
      row('Chapter 7 Homework')?.pointsPossible === 20,
    JSON.stringify(row('Chapter 7 Homework')),
  );
  check(
    '"Score unavailable" is submitted, NOT graded',
    row('Unit 3 Practice')?.submissionStatus === 'submitted' &&
      row('Unit 3 Practice')?.score === undefined,
    JSON.stringify(row('Unit 3 Practice')),
  );
  check(
    'a missing row stays missing even with a dash in the score cell',
    row('Graphing Worksheet')?.submissionStatus === 'missing',
    JSON.stringify(row('Graphing Worksheet')),
  );
  check(
    'an excused row is settled and says so in words',
    row('Field Trip Reflection')?.submissionStatus === 'graded' &&
      row('Field Trip Reflection')?.scoreText === 'Excused',
    JSON.stringify(row('Field Trip Reflection')),
  );
  check(
    'a row with nothing on it stays unknown rather than guessing',
    row('Quiz Corrections')?.submissionStatus === 'unknown',
    JSON.stringify(row('Quiz Corrections')),
  );
  check(
    'the course total is read from the sidebar',
    gradebook.grades[0]?.currentScore === 93.75 && gradebook.grades[0]?.totalsHidden === false,
    JSON.stringify(gradebook.grades),
  );

  const hidden = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/202/grades`,
    `({ parser }) => parser.parseCanvasPage(document, location.href)`,
  );
  check(
    'a hidden total is recorded as hidden, never as a number',
    hidden.grades[0]?.totalsHidden === true && hidden.grades[0]?.currentScore === null,
    JSON.stringify(hidden.grades),
  );

  const modern = await inPage(
    browser,
    `https://${CANVAS_HOST}/courses/303/grades`,
    `({ parser }) => parser.parseCanvasPage(document, location.href)`,
  );
  const museum = modern.assignments.find((a) => a.title === 'Museum Project');
  check(
    'a gradebook with none of the classic markup is still read',
    modern.assignments.length === 2,
    JSON.stringify(modern.assignments.map((a) => a.title)),
  );
  check(
    'a graded row reads as graded, with score and points, from "100/100"',
    museum?.submissionStatus === 'graded' &&
      museum?.score === 100 &&
      museum?.pointsPossible === 100,
    JSON.stringify(museum),
  );
  check(
    'an unscored row on that page is still not graded',
    modern.assignments.find((a) => a.title === 'Reading Response')?.submissionStatus === 'submitted',
    JSON.stringify(modern.assignments.find((a) => a.title === 'Reading Response')),
  );
  check(
    'and its course total is read',
    modern.grades[0]?.currentScore === 97,
    JSON.stringify(modern.grades),
  );

  const all = await inPage(
    browser,
    `https://${CANVAS_HOST}/grades`,
    `({ parser }) => parser.parseCanvasPage(document, location.href)`,
  );
  check('the all-courses grades page is its own kind', all.pageKind === 'grades_all');
  const math = all.grades.find((g) => g.externalCourseId === '101');
  const english = all.grades.find((g) => g.externalCourseId === '202');
  check(
    'each class row yields its course id and published grade',
    math?.currentScore === 93.75 && math?.currentGrade === 'A',
    JSON.stringify(all.grades),
  );
  check(
    'a class with no published grade is hidden, not zero',
    english?.totalsHidden === true && english?.currentScore === null,
    JSON.stringify(english),
  );

  /* ---- The all-courses page in a modern, table-free layout ---- */
  /**
   * This is the shape that actually failed on the user's Canvas: div cards,
   * no table, no `tr`, no `li`. The row-driven parser found nothing, the page
   * was reported unreadable, and the whole read was discarded — which looked
   * from the outside exactly like "LockIn cannot see my grades".
   */
  const modernAll = await inPage(
    browser,
    `https://${CANVAS_HOST}/grades-modern`,
    `({ parser }) => parser.parseCanvasAllGradesPage(document, location.href)`,
  );
  const byId = (id) => modernAll.grades.find((g) => g.externalCourseId === id);
  check(
    'a table-free grades page still yields one entry per class',
    modernAll.grades.length === 3,
    JSON.stringify(modernAll.grades.map((g) => [g.externalCourseId, g.currentScore])),
  );
  check(
    'each class keeps its own grade rather than the first one found',
    byId('101')?.currentScore === 93.75 && byId('303')?.currentScore === 88.2,
    JSON.stringify(modernAll.grades),
  );
  check(
    'a class with no published grade is still hidden, not borrowed',
    byId('202')?.totalsHidden === true && byId('202')?.currentScore === null,
    JSON.stringify(byId('202')),
  );
  check(
    'the course name comes from the link',
    byId('303')?.courseName === 'Museum Studies',
    JSON.stringify(byId('303')),
  );

  browser.close();
}

main()
  .catch((error) => {
    console.error('\nHARNESS ERROR:', error.message);
    failed += 1;
  })
  .finally(async () => {
    await killChrome(chrome, CDP_PORT, profile);
    if (fixtures) fixtures.close();
    await sleep(400);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    console.log(`\n${failed === 0 ? 'ALL PARSER TESTS PASSED' : `${failed} FAILED`} — ${passed} passed\n`);
    process.exit(failed === 0 ? 0 : 1);
  });
