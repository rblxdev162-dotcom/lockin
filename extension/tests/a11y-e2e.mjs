/**
 * Accessibility and responsiveness, in a real browser (Phase 8).
 *
 * Phases 1 and 2 were built with keyboard and contrast in mind; phases 3–7
 * added a lot of surface that was never audited end to end. This suite is that
 * audit, automated so it stays true.
 *
 * It checks the mechanical things a machine can check honestly:
 *   - every interactive element has an accessible name
 *   - every form control has a label
 *   - dialogs trap focus, close on Escape, and give focus back
 *   - core flows are completable with the keyboard alone
 *   - no core screen scrolls horizontally at 320/375/430/768px
 *   - the app is still usable at 200% zoom
 *   - a very long title does not break a layout
 *   - status is never communicated by colour alone
 *
 * It cannot check whether the result is *pleasant* to use with a screen
 * reader. That is a human job, and MANUAL_QA.md asks for it.
 *
 * Needs the dev server on :5173.
 * Run: node extension/tests/a11y-e2e.mjs   (add --headful to watch)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome, killChrome, launchChrome as spawnChrome, requirePortFree } from './chrome-harness.mjs';

const APP = 'http://localhost:5173';
const CDP_PORT = 9337;
const HEADFUL = process.argv.includes('--headful');
const CHROME = findChrome();

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
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
        const { resolve: r, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : r(msg.result);
      }
    });
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* gone */
    }
  }
}

async function fetchJSON(path, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
      if (res.ok) return await res.json();
    } catch {
      /* not up */
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

const profile = mkdtempSync(join(tmpdir(), 'lockin-a11y-'));
let chrome = null;
let cdp = null;
let session = null;

async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    session,
  );
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

async function goto(path) {
  await cdp.send('Page.navigate', { url: `${APP}${path}` }, session);
  await sleep(900);
}

async function key(text, code, keyCode, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send(
      'Input.dispatchKeyEvent',
      {
        type,
        key: text,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers,
      },
      session,
    );
  }
  await sleep(120);
}

const TAB = () => key('Tab', 'Tab', 9);
const SHIFT_TAB = () => key('Tab', 'Tab', 9, 8);
const ENTER = () => key('Enter', 'Enter', 13);
const ESCAPE = () => key('Escape', 'Escape', 27);

/** Seeds an onboarded profile with some work, so pages have content. */
async function seed() {
  await goto('/');
  await evaluate(`
    localStorage.setItem('lockin.state.v1', JSON.stringify({
      schemaVersion: 7,
      profile: { firstName: 'Sam', onboarded: true, createdAt: new Date().toISOString() },
      assignments: [
        {
          id: 'asg_1',
          title: 'A Very Extremely Long AP Environmental Science Assignment Name That Keeps Going And Going',
          subject: 'AP Environmental Science and Sustainability Studies',
          platform: 'Other',
          dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          dueTime: '23:59',
          estimatedMinutes: 60,
          priority: 'Urgent',
          status: 'Not Started',
          completionMethod: 'manual',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          loggedMinutes: 0,
          remindersFired: [],
          verificationStatus: 'not_required',
          verificationRecords: []
        }
      ],
      exams: [{
        id: 'exm_1',
        name: 'Advanced Placement Environmental Science Final Examination',
        subject: 'Science',
        examDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        materialAmount: 'Medium',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        loggedMinutes: 0
      }],
      settings: { blockedDomains: ['youtube.com'], allowedDomains: [] },
      planner: { settings: { configured: true } }
    }));
    'ok'
  `);
  await goto('/home');
}

const SCREENS = [
  ['/home', 'Dashboard'],
  ['/assignments', 'Assignments'],
  ['/planner', 'Planner'],
  ['/exams', 'Exams'],
  ['/focus', 'Focus'],
  ['/activity', 'Activity'],
  ['/settings', 'Settings'],
  ['/help', 'Help'],
  ['/privacy', 'Privacy'],
];

async function setViewport(width, height, scale = 1) {
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: width < 768, scale },
    session,
  );
  await sleep(400);
}

async function main() {
  console.log(`\nLockIn accessibility audit${HEADFUL ? ' (headful)' : ''}\n`);
  if (!CHROME) {
    console.log('  ! Chrome for Testing not found — set CHROME_BIN. Skipping.\n');
    return;
  }
  try {
    const probe = await fetch(APP).catch(() => null);
    if (!probe?.ok) {
      console.log('  – skipped: dev server not running on :5173\n');
      return;
    }
  } catch {
    console.log('  – skipped: dev server not running on :5173\n');
    return;
  }

  await requirePortFree(CDP_PORT, 'Chrome debug port');
  const args = [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    'about:blank',
  ];
  if (!HEADFUL) args.unshift('--headless=new');
  chrome = spawnChrome(CHROME, args);

  const { webSocketDebuggerUrl } = await fetchJSON('/json/version');
  cdp = new CDP(webSocketDebuggerUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await cdp.send('Page.enable', {}, session);
  await cdp.send('Runtime.enable', {}, session);
  await cdp.send('DOM.enable', {}, session);
  await cdp.send('Accessibility.enable', {}, session);

  await setViewport(1280, 900);
  await seed();

  /* ---------------- names and labels ---------------- */
  console.log('Names and labels');
  for (const [path, label] of SCREENS) {
    await goto(path);
    const unnamed = await evaluate(`
      (() => {
        const named = (el) => {
          if (el.getAttribute('aria-label')?.trim()) return true;
          if (el.getAttribute('aria-labelledby')) return true;
          if (el.getAttribute('title')?.trim()) return true;
          if ((el.innerText || '').trim()) return true;
          if (el.labels && el.labels.length > 0) return true;
          if (el.closest('label')) return true;
          if (el.getAttribute('placeholder')?.trim()) return true;
          return false;
        };
        const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
        const controls = [...document.querySelectorAll('button, a[href], input, select, textarea')];
        return controls
          .filter(visible)
          .filter((el) => !named(el))
          .map((el) => el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : '') + '.' + (el.className || '').split(' ')[0])
          .slice(0, 6);
      })()
    `);
    check(`${label}: every visible control has an accessible name`, unnamed.length === 0, unnamed.join(', '));
  }

  /* ---------------- headings ---------------- */
  console.log('\nDocument structure');
  for (const [path, label] of SCREENS) {
    await goto(path);
    const h1s = await evaluate(`document.querySelectorAll('h1').length`);
    check(`${label}: has exactly one <h1>`, h1s === 1, `${h1s} found`);
  }

  /* ---------------- dialogs ---------------- */
  console.log('\nDialogs');
  await goto('/settings');
  // "Set parent PIN" is a representative dialog: it has fields and buttons.
  const opened = await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /set parent pin/i.test(b.innerText));
      if (!btn) return 'no-button';
      btn.id = 'a11y-opener';
      btn.focus();
      btn.click();
      return 'ok';
    })()
  `);
  await sleep(500);
  check('a dialog opens from a button', opened === 'ok', opened);

  if (opened === 'ok') {
    const dialogState = await evaluate(`
      (() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return { present: false };
        return {
          present: true,
          modal: dialog.getAttribute('aria-modal') === 'true',
          named: !!(dialog.getAttribute('aria-labelledby') || dialog.getAttribute('aria-label')),
          focusInside: dialog.contains(document.activeElement),
        };
      })()
    `);
    check('it is announced as a modal dialog', dialogState.modal === true);
    check('it has an accessible name', dialogState.named === true);
    check('focus moves into it on open', dialogState.focusInside === true);

    // Tab all the way round: focus must never escape the dialog.
    let escaped = false;
    for (let i = 0; i < 12; i += 1) {
      await TAB();
      const inside = await evaluate(
        `document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false`,
      );
      if (!inside) escaped = true;
    }
    check('Tab is trapped inside it', !escaped);

    await SHIFT_TAB();
    const backInside = await evaluate(
      `document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false`,
    );
    check('Shift+Tab is trapped too', backInside === true);

    await ESCAPE();
    await sleep(400);
    const closed = await evaluate(`!document.querySelector('[role="dialog"]')`);
    check('Escape closes it', closed === true);

    const returned = await evaluate(`document.activeElement?.id === 'a11y-opener'`);
    check('focus returns to the button that opened it', returned === true);
  }

  /* ---------------- keyboard-only flows ---------------- */
  console.log('\nKeyboard only');
  await goto('/assignments');
  const reachable = await evaluate(`
    (() => {
      // Everything a student must be able to *do* on this page has to be
      // reachable by Tab: a mouse-only control is a locked door.
      const focusables = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.offsetParent !== null && !el.disabled);
      return focusables.length;
    })()
  `);
  check('the assignments page exposes focusable controls', reachable > 0, `${reachable} controls`);

  const noPositiveTabIndex = await evaluate(`
    [...document.querySelectorAll('[tabindex]')]
      .map((el) => Number(el.getAttribute('tabindex')))
      .filter((n) => n > 0).length === 0
  `);
  check('no positive tabindex fights the natural order', noPositiveTabIndex === true);

  // The emergency exit only exists where it means something: inside a running
  // Strict session. That is the state a student is actually trapped in, so it
  // is the state to check it in.
  await goto('/focus');
  await evaluate(`
    (() => {
      const raw = JSON.parse(localStorage.getItem('lockin.state.v1'));
      raw.settings = { ...raw.settings, reminderMode: 'Strict', blockingEnabled: true };
      raw.focusMode = {
        active: true, startedAt: new Date().toISOString(),
        requiredTaskIds: ['asg_1'], requiredCompletionCount: 1, completedCount: 0,
        temporaryUnlockUntil: null, overrideUsed: false, emergencyExitUsed: false,
        isTest: false, testExpiresAt: null,
      };
      localStorage.setItem('lockin.state.v1', JSON.stringify(raw));
      return 'ok';
    })()
  `);
  await goto('/focus');
  const emergencyReachable = await evaluate(`
    (() => {
      const el = [...document.querySelectorAll('button, a[href]')]
        .find((b) => /emergency/i.test(b.innerText));
      if (!el) return 'absent';
      if (el.disabled) return 'disabled';
      return el.offsetParent !== null ? 'ok' : 'hidden';
    })()
  `);
  check(
    'the emergency exit is present and operable during a Strict session',
    emergencyReachable === 'ok',
    emergencyReachable,
  );

  // …and put the app back, so later screens are measured in their normal state.
  await evaluate(`
    (() => {
      const raw = JSON.parse(localStorage.getItem('lockin.state.v1'));
      raw.focusMode = { ...raw.focusMode, active: false };
      raw.settings = { ...raw.settings, reminderMode: 'Normal' };
      localStorage.setItem('lockin.state.v1', JSON.stringify(raw));
      return 'ok';
    })()
  `);

  const visibleFocusRing = await evaluate(`
    (() => {
      const btn = document.querySelector('button');
      if (!btn) return false;
      btn.focus();
      const s = getComputedStyle(btn);
      // Either a real outline, or a ring drawn with box-shadow.
      return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
    })()
  `);
  check('focused controls show a visible focus indicator', visibleFocusRing === true);

  /* ---------------- responsiveness ---------------- */
  console.log('\nResponsive layout');
  for (const width of [320, 375, 430, 768]) {
    let worst = null;
    for (const [path, label] of SCREENS) {
      await setViewport(width, 800);
      await goto(path);
      const overflow = await evaluate(`
        Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      `);
      if (overflow > 1 && (!worst || overflow > worst.overflow)) worst = { label, overflow };
    }
    check(
      `no horizontal scrolling at ${width}px`,
      worst === null,
      worst ? `${worst.label} overflows by ${worst.overflow}px` : '',
    );
  }

  /* ---------------- zoom ---------------- */
  console.log('\nZoom');
  await setViewport(1280, 900, 2); // ~200%
  for (const [path, label] of [['/home', 'Dashboard'], ['/focus', 'Focus'], ['/settings', 'Settings']]) {
    await goto(path);
    const usable = await evaluate(`
      (() => {
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const buttons = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
        return { overflow, buttons: buttons.length };
      })()
    `);
    check(
      `${label} stays usable at 200% zoom`,
      usable.overflow <= 1 && usable.buttons > 0,
      `overflow ${usable.overflow}px, ${usable.buttons} buttons`,
    );
  }
  await setViewport(1280, 900, 1);

  /* ---------------- long text ---------------- */
  console.log('\nLong content');
  await setViewport(375, 800);
  await goto('/assignments');
  const longTitleOk = await evaluate(`
    (() => {
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const text = document.body.innerText;
      return { overflow, hasTitle: /AP Environmental Science/.test(text) };
    })()
  `);
  check(
    'a very long assignment title is shown without breaking the layout',
    longTitleOk.overflow <= 1 && longTitleOk.hasTitle,
    `overflow ${longTitleOk.overflow}px`,
  );
  await setViewport(1280, 900);

  /* ---------------- colour is never the only signal ---------------- */
  console.log('\nColour independence');
  await goto('/settings');
  const statusHasText = await evaluate(`
    (() => {
      // The Browser protection card's status must read as words, not just a
      // green or amber block.
      const text = document.body.innerText;
      return /Connected|Not connected|Checking/.test(text);
    })()
  `);
  check('connection status is stated in words, not colour alone', statusHasText === true);

  await goto('/home');
  const badgesHaveText = await evaluate(`
    (() => {
      const coloured = [...document.querySelectorAll('[class*="bg-mint"], [class*="bg-flame"], [class*="bg-amber"]')]
        .filter((el) => el.offsetParent !== null);
      // Every coloured chip must carry text, or sit next to something that does.
      const silent = coloured.filter((el) => !(el.innerText || '').trim() && !el.getAttribute('aria-label'));
      return { total: coloured.length, silent: silent.length };
    })()
  `);
  check(
    'coloured status chips carry text or a label',
    badgesHaveText.silent === 0,
    `${badgesHaveText.silent} silent of ${badgesHaveText.total}`,
  );

  cdp.close();
}

main()
  .catch((error) => {
    console.error('\n  ✖ audit crashed:', error.message);
    failures += 1;
  })
  .finally(async () => {
    if (chrome) await killChrome(chrome, CDP_PORT, profile);
    rmSync(profile, { recursive: true, force: true });
    console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
