/**
 * Generates the synthetic Edgenuity screens the Phase 4 tests run against.
 *
 * These are drawn from scratch on a canvas inside a real Chrome — no real
 * student's screenshot is ever committed to this repo, and no Edgenuity assets
 * are copied. They only have to be *Edgenuity-shaped*: brand wordmark, course
 * title, a labelled Course Progress percentage, an activity line, and (in some
 * variants) the rival grade percentages that make picking the right number
 * hard.
 *
 * Two outputs per fixture that needs them:
 *   .png   — fed to the real-OCR suite, and to the app's developer-mode fixture
 *            picker.
 *   .y4m   — fed to Chrome's fake camera in the E2E suite, so the end-to-end
 *            run exercises the genuine getUserMedia path rather than a bypass.
 *
 * Run: npm run fixtures:edgenuity   (the OCR and E2E suites do it for you)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, killChrome, launchChrome, requirePortFree } from './chrome-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(HERE, 'fixtures', 'edgenuity');
/** The two shown in the app's developer-mode picker. */
const PUBLIC_DIR = resolve(HERE, '../../web/public/fixtures/edgenuity');
const CDP_PORT = 9391;

export const WIDTH = 1280;
export const HEIGHT = 720;

/**
 * name          — file name
 * expect        — what the OCR suite should get: a number, or null for "must
 *                 refuse", or 'any_safe' for "either read it right or refuse".
 * expectCourse  — substring the detected course should contain, when checked.
 * camera        — also emit a .y4m for the fake camera.
 */
export const FIXTURES = [
  { name: 'clear-43', expect: 43, expectCourse: 'Physical Science', camera: true },
  { name: 'clear-47', expect: 47, expectCourse: 'Physical Science', camera: true },
  { name: 'clear-46', expect: 46, expectCourse: 'Physical Science', camera: true },
  { name: 'multi-percent', expect: 43, expectCourse: 'Physical Science' },
  { name: 'zero-progress', expect: 0 },
  { name: 'full-progress', expect: 100 },
  { name: 'glare', expect: 'any_safe' },
  { name: 'rotated', expect: 'any_safe' },
  { name: 'small-text', expect: 'any_safe' },
  { name: 'different-course', expect: 65, expectCourse: 'Math', camera: true },
  { name: 'no-percentage', expect: null, problem: 'no_percentage' },
  { name: 'random-website', expect: null, problem: 'not_edgenuity' },
  { name: 'malformed', expect: null, problem: 'unreadable' },

  /* --- Phase 5: Enhanced Proof challenge codes --- */
  { name: 'enhanced-43-K7M4', expect: 43, code: 'K7M4', codeExpect: true, camera: true },
  { name: 'enhanced-47-R9C2', expect: 47, code: 'R9C2', codeExpect: true, camera: true },
  { name: 'enhanced-47-T3XW', expect: 47, code: 'T3XW', codeExpect: true, camera: true },
  { name: 'challenge-missing', expect: 43, code: 'K7M4', codeExpect: false },
  { name: 'challenge-spaced', expect: 43, code: 'K7M4', codeExpect: true },
  { name: 'challenge-low-contrast', expect: 43, code: 'K7M4', codeExpect: 'any_safe' },
  { name: 'challenge-obscured', expect: 43, code: 'K7M4', codeExpect: 'any_safe' },
  { name: 'challenge-multiple-codes', expect: 43, code: 'K7M4', codeExpect: true },
  { name: 'challenge-near-progress', expect: 43, code: 'K7M4', codeExpect: false },
  { name: 'challenge-wrong-course', expect: 65, code: 'K7M4', codeExpect: true, camera: true },
  { name: 'challenge-random-website', expect: null, problem: 'not_edgenuity', code: 'K7M4' },
];

/* ------------------------------------------------------------------ */
/* The drawing, as a string evaluated inside the page                  */
/* ------------------------------------------------------------------ */

/**
 * Runs in the browser. Kept as one self-contained function so it can be
 * stringified into `Runtime.evaluate` without a bundler.
 */
function drawFixture(name, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const INK = '#1c2430';
  const MUTED = '#5a6472';
  const BRAND = '#0b5cad';

  const fill = (color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const text = (value, x, y, size, color = INK, weight = '400') => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(value, x, y);
  };

  /** The shared chrome of an Edgenuity course page. */
  const shell = (course, options = {}) => {
    fill('#ffffff', 0, 0, width, height);
    fill('#f2f5f9', 0, 0, width, 96);
    fill(BRAND, 0, 0, width, 8);
    text('Edgenuity', 48, 30, 40, BRAND, '700');
    text('My Courses', 300, 44, 22, MUTED);
    text('Student', width - 200, 44, 22, MUTED);

    text(course, 48, 140, 44, INK, '700');
    if (options.activity !== undefined) {
      text(options.activity, 48, 205, 26, MUTED);
    }
  };

  /**
   * A sheet of paper with the code on it, propped beside the monitor.
   *
   * Printed rather than handwritten: canvas cannot fake handwriting
   * convincingly, and a fixture that pretended to would be testing the wrong
   * thing. Real handwriting is harder for OCR, which the docs say plainly.
   */
  const codeCard = (code, options = {}) => {
    const { x = width - 340, y = height - 210, ink = '#111418', angle = -3, scale = 1 } = options;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);
    fill('#fdfdfa', 0, 0, 300 * scale, 150 * scale);
    ctx.strokeStyle = '#d8d8d0';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 300 * scale, 150 * scale);
    ctx.fillStyle = ink;
    ctx.font = `700 ${72 * scale}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(code, 26 * scale, 78 * scale);
    ctx.restore();
  };

  const progressBlock = (percent, y = 300) => {
    text('Course Progress', 48, y, 30, MUTED, '700');
    text(`${percent}%`, 48, y + 46, 76, INK, '700');
    fill('#dde3ec', 48, y + 150, 700, 26);
    fill('#2f9e6b', 48, y + 150, Math.max(2, 7 * percent), 26);
  };

  switch (name) {
    case 'clear-43':
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      break;

    case 'clear-46':
      shell('Physical Science Semester A', { activity: 'Lesson 5: Energy Transfer' });
      progressBlock(46);
      break;

    case 'clear-47':
      shell('Physical Science Semester A', { activity: 'Lesson 6: Chemical Bonds' });
      progressBlock(47);
      break;

    case 'multi-percent':
      // The dangerous layout: three percentages, only one of which is progress.
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      text('Overall Grade', 820, 300, 30, MUTED, '700');
      text('92%', 820, 346, 60, INK, '700');
      text('Relative Grade', 820, 440, 30, MUTED, '700');
      text('87%', 820, 486, 60, INK, '700');
      break;

    case 'zero-progress':
      shell('Physical Science Semester A', { activity: 'Lesson 1: Getting Started' });
      progressBlock(0);
      break;

    case 'full-progress':
      shell('Physical Science Semester A', { activity: 'Course Summary' });
      progressBlock(100);
      break;

    case 'different-course':
      shell('Math Semester B', { activity: 'Lesson 12: Quadratics' });
      progressBlock(65);
      break;

    case 'no-percentage':
      // A real Edgenuity page that simply isn't showing progress.
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      text('Activity', 48, 300, 30, MUTED, '700');
      text('Warm-Up', 48, 346, 48, INK, '700');
      text('Instruction', 48, 420, 32, MUTED);
      text('Summary', 48, 470, 32, MUTED);
      break;

    case 'random-website':
      // Contains a percentage, contains nothing else that matters.
      fill('#ffffff', 0, 0, width, height);
      text('Battery Health', 48, 60, 44, INK, '700');
      text('Your battery is at 47%', 48, 160, 34, INK);
      text('Settings', 48, 230, 30, MUTED);
      text('About this device', 48, 280, 30, MUTED);
      text('Storage', 48, 330, 30, MUTED);
      break;

    case 'glare': {
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      // A blown-out highlight across the middle, the way a ceiling light lands
      // on a monitor.
      const glare = ctx.createLinearGradient(200, 120, 900, 640);
      glare.addColorStop(0, 'rgba(255,255,255,0)');
      glare.addColorStop(0.5, 'rgba(255,255,255,0.82)');
      glare.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glare;
      ctx.fillRect(0, 0, width, height);
      break;
    }

    case 'rotated': {
      const inner = drawFixture('clear-43', width, height);
      fill('#20262e', 0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate((4 * Math.PI) / 180);
      ctx.scale(0.9, 0.9);
      ctx.drawImage(inner, -width / 2, -height / 2);
      ctx.restore();
      break;
    }

    case 'small-text':
      // Photographed from too far away: the whole page shrunk into a corner.
      fill('#20262e', 0, 0, width, height);
      ctx.save();
      ctx.translate(width * 0.28, height * 0.3);
      ctx.scale(0.42, 0.42);
      ctx.drawImage(drawFixture('clear-43', width, height), 0, 0);
      ctx.restore();
      break;

    case 'malformed':
      // Lens cap / pocket photo.
      fill('#050607', 0, 0, width, height);
      break;

    /* ---------------- Phase 5 ---------------- */

    case 'enhanced-43-K7M4':
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      codeCard('K7M4');
      break;

    case 'enhanced-47-R9C2':
      shell('Physical Science Semester A', { activity: 'Lesson 6: Chemical Bonds' });
      progressBlock(47);
      codeCard('R9C2');
      break;

    case 'enhanced-47-T3XW':
      // The right screen and progress, but somebody else's code.
      shell('Physical Science Semester A', { activity: 'Lesson 6: Chemical Bonds' });
      progressBlock(47);
      codeCard('T3XW');
      break;

    case 'challenge-missing':
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      break;

    case 'challenge-spaced':
      // Written the way people actually write codes: characters far apart.
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      codeCard('K 7 M 4');
      break;

    case 'challenge-low-contrast':
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      codeCard('K7M4', { ink: '#9aa0a8' });
      break;

    case 'challenge-obscured':
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      codeCard('K7M4');
      // A thumb over the last character.
      fill('#c8a288', width - 130, height - 190, 90, 120);
      break;

    case 'challenge-multiple-codes':
      // Decoys around the real code. They gain nothing: the expected value is
      // known before the photo, so this is a confirmation, not a lucky pick.
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      codeCard('R9C2', { x: width - 700, y: height - 340, scale: 0.6, angle: 2 });
      codeCard('K7M4');
      codeCard('T3XW', { x: width - 700, y: height - 150, scale: 0.6, angle: 1 });
      break;

    case 'challenge-near-progress':
      // The card sits inside the progress region — beside the number rather
      // than on top of it, so the percentage still reads and it is the spatial
      // rule, not occlusion, that refuses the code.
      shell('Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
      progressBlock(43);
      codeCard('K7M4', { x: 215, y: 330, scale: 0.5, angle: 0 });
      break;

    case 'challenge-wrong-course':
      shell('Math Semester B', { activity: 'Lesson 12: Quadratics' });
      progressBlock(65);
      codeCard('K7M4');
      break;

    case 'challenge-random-website':
      // The code is present; nothing else about the page is Edgenuity.
      fill('#ffffff', 0, 0, width, height);
      text('Battery Health', 48, 60, 44, INK, '700');
      text('Your battery is at 47%', 48, 160, 34, INK);
      text('Settings', 48, 230, 30, MUTED);
      codeCard('K7M4');
      break;

    default: {
      /**
       * `custom:<percent>:<code>:<course>` — drawn on demand.
       *
       * The E2E needs a screen showing the code the app actually generated,
       * which is random and unknowable in advance, so it renders one at capture
       * time instead of loading a pre-baked file.
       */
      if (name.startsWith('custom:')) {
        const [, percent, code, course, variant] = name.split(':');
        shell(course || 'Physical Science Semester A', { activity: 'Lesson 4: Cell Structure' });
        progressBlock(Number(percent));
        if (code) {
          /**
           * `variant` re-frames the card slightly.
           *
           * A retake in real life is a *different* photo; re-rendering the same
           * bytes would give OCR the same failure forever. Nudging position and
           * size models a student adjusting the shot, which is exactly what the
           * app tells them to do.
           */
          const attempt = Number(variant) || 0;
          codeCard(code, {
            x: width - 340 - attempt * 18,
            y: height - 210 - attempt * 12,
            scale: 1 + attempt * 0.12,
            angle: -3 + attempt * 2,
          });
        }
        break;
      }
      throw new Error(`Unknown fixture: ${name}`);
    }
  }

  return canvas;
}

/** Runs in the browser: canvas -> { png, i420 } as base64. */
function exportFixture(name, width, height) {
  const canvas = window.__drawFixture(name, width, height);
  const png = canvas.toDataURL('image/png').split(',')[1];

  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  // Rec. 601 full-range I420, which is what Chrome's fake capture expects.
  const ySize = width * height;
  const out = new Uint8Array(ySize + ySize / 2);
  const uOffset = ySize;
  const vOffset = ySize + ySize / 4;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      out[y * width + x] = Math.max(0, Math.min(255, 0.299 * r + 0.587 * g + 0.114 * b));

      // One chroma sample per 2x2 block, taken from its top-left pixel.
      if (y % 2 === 0 && x % 2 === 0) {
        const c = (y / 2) * (width / 2) + x / 2;
        out[uOffset + c] = Math.max(0, Math.min(255, -0.169 * r - 0.331 * g + 0.5 * b + 128));
        out[vOffset + c] = Math.max(0, Math.min(255, 0.5 * r - 0.419 * g - 0.081 * b + 128));
      }
    }
  }

  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < out.length; i += chunk) {
    binary += String.fromCharCode.apply(null, out.subarray(i, i + chunk));
  }
  return { png, i420: btoa(binary) };
}

/* ------------------------------------------------------------------ */
/* Node side                                                           */
/* ------------------------------------------------------------------ */

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
      const entry = msg.id && this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 60_000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

async function fetchJSON(path, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

/** `YUV4MPEG2` header + one frame. Chrome loops a single-frame file happily. */
function toY4m(i420) {
  const header = Buffer.from(
    `YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\nFRAME\n`,
    'ascii',
  );
  return Buffer.concat([header, i420]);
}

/**
 * The drawing helpers as source, so another harness can install them in its
 * own page and render frames on demand.
 */
export const RENDERER_SOURCE = `window.__drawFixture = ${drawFixture.toString()};
window.__exportFixture = ${exportFixture.toString()};`;

/** `YUV4MPEG2` bytes for a frame rendered by `exportFixture`. */
export function y4mFromI420(base64) {
  return toY4m(Buffer.from(base64, 'base64'));
}

export async function generateFixtures({ quiet = false } = {}) {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error(
      'Chrome for Testing not found. Install it or set CHROME_BIN — see HANDOFF.md.',
    );
  }

  mkdirSync(FIXTURE_DIR, { recursive: true });
  mkdirSync(PUBLIC_DIR, { recursive: true });

  await requirePortFree(CDP_PORT, 'fixture generator debug port');
  const profile = mkdtempSync(join(tmpdir(), 'lockin-fixtures-'));
  const child = launchChrome(chrome, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ]);

  try {
    const targets = await fetchJSON('/json/list');
    const page = targets.find((t) => t.type === 'page') ?? targets[0];
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    // Install the drawing helpers once, then call them per fixture.
    await cdp.send('Runtime.evaluate', { expression: RENDERER_SOURCE });

    for (const fixture of FIXTURES) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify(window.__exportFixture(${JSON.stringify(fixture.name)}, ${WIDTH}, ${HEIGHT}))`,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(`Drawing ${fixture.name} failed: ${JSON.stringify(result.exceptionDetails)}`);
      }
      const { png, i420 } = JSON.parse(result.result.value);

      const pngBuffer = Buffer.from(png, 'base64');
      writeFileSync(join(FIXTURE_DIR, `${fixture.name}.png`), pngBuffer);
      if (fixture.camera) {
        writeFileSync(join(FIXTURE_DIR, `${fixture.name}.y4m`), toY4m(Buffer.from(i420, 'base64')));
      }
      // The app's developer-mode picker offers exactly these two.
      if (fixture.name === 'clear-43' || fixture.name === 'clear-47') {
        writeFileSync(join(PUBLIC_DIR, `${fixture.name}.png`), pngBuffer);
      }
      if (!quiet) console.log(`  · ${fixture.name}.png${fixture.camera ? ' + .y4m' : ''}`);
    }

    cdp.close();
  } finally {
    await killChrome(child, CDP_PORT, profile);
    rmSync(profile, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Generating Edgenuity test fixtures…');
  await generateFixtures();
  console.log(`Done → ${FIXTURE_DIR}`);
}
