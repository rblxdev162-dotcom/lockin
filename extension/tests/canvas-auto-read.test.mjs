/** Automatic Canvas gradebook tab ownership and cleanup. */
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const DOMAIN = 'myschool.instructure.com';
const AFTER_SCHOOL = new Date(2026, 7, 19, 17, 0).getTime();
const store = new Map();
const tabs = new Map();
const created = [];
const removed = [];
const read = [];
let nextTabId = 10;
let adoptOnRead = false;
let canvas;

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        const keys = Array.isArray(key) ? key : [key];
        return Object.fromEntries(
          keys.filter((item) => store.has(item)).map((item) => [item, store.get(item)]),
        );
      },
      async set(entries) {
        for (const [key, value] of Object.entries(entries)) store.set(key, value);
      },
      async remove(key) {
        for (const item of Array.isArray(key) ? key : [key]) store.delete(item);
      },
    },
  },
  permissions: {
    async contains() {
      return true;
    },
    async remove() {
      return true;
    },
  },
  scripting: {
    async getRegisteredContentScripts() {
      return [];
    },
    async unregisterContentScripts() {},
    async registerContentScripts() {},
    async executeScript() {},
  },
  tabs: {
    async query() {
      return [...tabs.values()];
    },
    async create(options) {
      const tab = {
        id: nextTabId++,
        status: 'complete',
        active: options.active === true,
        url: options.url,
      };
      tabs.set(tab.id, tab);
      created.push({ ...options, id: tab.id });
      return tab;
    },
    async get(id) {
      const tab = tabs.get(id);
      if (!tab) throw new Error('missing tab');
      return tab;
    },
    async sendMessage(id, message) {
      assert.equal(message.trigger, 'automatic');
      const tab = tabs.get(id);
      if (adoptOnRead) tab.active = true;
      // Each tick reads two pages for one class; the fake answers as whichever
      // page the tab is actually on, exactly as a real content script would.
      const onAssignmentsIndex = /\/courses\/\d+\/assignments$/.test(tab.url ?? '');
      const pageKind = onAssignmentsIndex ? 'assignments_index' : 'grades';
      read.push({ id, pageKind, url: tab.url });
      await canvas.handleCanvasContentMessage(
        {
          type: 'CANVAS_DETECTION',
          trigger: 'automatic',
          domain: DOMAIN,
          pageKind,
          readable: true,
          assignments: onAssignmentsIndex
            ? [
                {
                  externalCourseId: '101',
                  externalAssignmentId: '5001',
                  title: 'Chapter 4 problems',
                  url: `https://${DOMAIN}/courses/101/assignments/5001`,
                  submissionStatus: 'submitted',
                  detectedAt: new Date().toISOString(),
                },
              ]
            : [],
          courses: [],
          grades: onAssignmentsIndex ? [] : [{ externalCourseId: '101', currentScore: 91 }],
          detectedAt: new Date().toISOString(),
        },
        { tab },
      );
      return { ok: true, pageKind };
    },
    async remove(id) {
      removed.push(id);
      tabs.delete(id);
    },
  },
};

canvas = await import('../background/canvas.js');

const enableScheduledReads = () =>
  canvas.setCheckWindow({
    mode: 'scheduled',
    schoolDays: [],
    schoolDayFrom: 0,
    schoolDayStart: 0,
    freeDayStart: 0,
    dayEnd: 1440,
  });

beforeEach(async () => {
  store.clear();
  tabs.clear();
  created.length = 0;
  removed.length = 0;
  read.length = 0;
  nextTabId = 10;
  adoptOnRead = false;
  await canvas.configureCanvas(DOMAIN);
});

test('automatic reading is refused until the scheduled window is enabled', async () => {
  const result = await canvas.autoReadCanvasCourses(['101'], { now: AFTER_SCHOOL });
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'automatic_disabled');
  assert.equal(created.length, 0);
});

test('one needed class is read on both its pages, one owned tab at a time', async () => {
  await enableScheduledReads();
  const result = await canvas.autoReadCanvasCourses(['101', '202'], { now: AFTER_SCHOOL });
  assert.equal(result.ok, true);
  assert.equal(result.courseId, '101');
  assert.equal(result.pageKind, 'grades');
  assert.equal(result.readGrades, true);
  assert.equal(
    result.readSubmissions,
    true,
    'the Assignments page is what says whether work was turned in',
  );
  assert.deepEqual(result.pageKinds, ['grades', 'assignments_index']);
  assert.equal(created.length, 2);
  assert.equal(created[0].active, false);
  assert.equal(created[1].active, false);
  assert.equal(created[0].url, `https://${DOMAIN}/courses/101/grades`);
  assert.equal(created[1].url, `https://${DOMAIN}/courses/101/assignments`);
  assert.deepEqual(
    removed,
    [created[0].id, created[1].id],
    'each owned tab is closed before the next one opens',
  );
  assert.equal(result.closed, true);
  assert.equal(Object.values(await canvas.getCanvasGrades())[0].currentScore, 91);
  const cached = Object.values(await canvas.getCanvasCache());
  assert.equal(cached.length, 1);
  assert.equal(
    cached[0].submissionStatus,
    'submitted',
    'the submitted state read off the Assignments page reaches the cache',
  );

  const tooSoon = await canvas.autoReadCanvasCourses(undefined, {
    now: AFTER_SCHOOL + 60_000,
  });
  assert.equal(tooSoon.reason, 'fresh');
  assert.equal(created.length, 2, 'the heartbeat cannot turn this into a one-minute poll');

  const nextTick = await canvas.autoReadCanvasCourses(undefined, {
    now: AFTER_SCHOOL + 15 * 60_000 + 1,
  });
  assert.equal(nextTick.ok, true);
  assert.equal(nextTick.courseId, '202', 'the stored roster rotates to the least recently read class');
  assert.equal(created[2].url, `https://${DOMAIN}/courses/202/grades`);
  assert.equal(created[3].url, `https://${DOMAIN}/courses/202/assignments`);
});

test('an existing gradebook is reused and never closed', async () => {
  await enableScheduledReads();
  tabs.set(4, {
    id: 4,
    status: 'complete',
    active: false,
    url: `https://${DOMAIN}/courses/101/grades`,
  });
  const result = await canvas.autoReadCanvasCourses(['101'], { now: AFTER_SCHOOL });
  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
  assert.equal(
    read.some((entry) => entry.id === 4),
    true,
    'the tab the student already had open is the one that was read',
  );
  assert.equal(tabs.has(4), true, "a tab LockIn did not open is never closed");
  assert.equal(removed.includes(4), false);
  // Only the second page, which was not already open, is created — and closed.
  assert.equal(created.length, 1);
  assert.equal(created[0].url, `https://${DOMAIN}/courses/101/assignments`);
  assert.deepEqual(removed, [created[0].id]);
});

test('a background tab the student activates is treated as adopted and left open', async () => {
  await enableScheduledReads();
  adoptOnRead = true;
  const result = await canvas.autoReadCanvasCourses(['101'], { now: AFTER_SCHOOL });
  assert.equal(result.ok, true);
  assert.equal(result.closed, false);
  assert.equal(removed.length, 0);
  assert.equal(tabs.has(created[0].id), true);
});

test('the heartbeat can clean up a tab after a worker interruption', async () => {
  const id = 44;
  tabs.set(id, {
    id,
    status: 'complete',
    active: false,
    url: `https://${DOMAIN}/courses/101/grades`,
  });
  store.set(canvas.CANVAS_STORAGE_KEYS.AUTO_READ_TAB_KEY, {
    id,
    domain: DOMAIN,
    path: '/courses/101/grades',
    openedAt: AFTER_SCHOOL,
  });
  const result = await canvas.closeOwnedCanvasReadTab(AFTER_SCHOOL + 26_000);
  assert.equal(result.closed, true);
  assert.deepEqual(removed, [id]);
});
