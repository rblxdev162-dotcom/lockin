/** Automatic Canvas gradebook tab ownership and cleanup. */
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const DOMAIN = 'myschool.instructure.com';
const AFTER_SCHOOL = new Date(2026, 7, 19, 17, 0).getTime();
const store = new Map();
const tabs = new Map();
const created = [];
const removed = [];
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
      if (adoptOnRead) tabs.get(id).active = true;
      await canvas.handleCanvasContentMessage(
        {
          type: 'CANVAS_DETECTION',
          trigger: 'automatic',
          domain: DOMAIN,
          pageKind: 'grades',
          readable: true,
          assignments: [],
          courses: [],
          grades: [{ externalCourseId: '101', currentScore: 91 }],
          detectedAt: new Date().toISOString(),
        },
        { tab: tabs.get(id) },
      );
      return { ok: true, pageKind: 'grades' };
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

test('one needed class opens in the background and only its owned tab closes', async () => {
  await enableScheduledReads();
  const result = await canvas.autoReadCanvasCourses(['101', '202'], { now: AFTER_SCHOOL });
  assert.equal(result.ok, true);
  assert.equal(result.courseId, '101');
  assert.equal(result.pageKind, 'grades');
  assert.equal(created.length, 1);
  assert.equal(created[0].active, false);
  assert.equal(created[0].url, `https://${DOMAIN}/courses/101/grades`);
  assert.deepEqual(removed, [created[0].id]);
  assert.equal(result.closed, true);
  assert.equal(Object.values(await canvas.getCanvasGrades())[0].currentScore, 91);

  const tooSoon = await canvas.autoReadCanvasCourses(undefined, {
    now: AFTER_SCHOOL + 60_000,
  });
  assert.equal(tooSoon.reason, 'fresh');
  assert.equal(created.length, 1, 'the heartbeat cannot turn this into a one-minute poll');

  const nextTick = await canvas.autoReadCanvasCourses(undefined, {
    now: AFTER_SCHOOL + 15 * 60_000 + 1,
  });
  assert.equal(nextTick.ok, true);
  assert.equal(nextTick.courseId, '202', 'the stored roster rotates to the least recently read class');
  assert.equal(created[1].url, `https://${DOMAIN}/courses/202/grades`);
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
  assert.equal(created.length, 0);
  assert.equal(removed.length, 0);
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
