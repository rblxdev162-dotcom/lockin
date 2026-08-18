/**
 * Copies the OCR engine assets out of node_modules and into `web/public/ocr/`.
 *
 * Why this exists: tesseract.js defaults to fetching its worker, its wasm core
 * and its language data from a public CDN. LockIn makes no network calls in
 * either half of the project (README: "Local only"), so every one of those
 * files is served from LockIn's own origin instead, and `lib/edgenuity/ocr.ts`
 * points workerPath / corePath / langPath at this folder.
 *
 * Run automatically by `predev` and `prebuild`. Copies are skipped when the
 * destination is already up to date, so it costs nothing on a warm tree.
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const modules = join(webRoot, 'node_modules');
const outDir = join(webRoot, 'public', 'ocr');

/**
 * Only the LSTM cores are copied, but *all three* of them.
 *
 * tesseract.js feature-detects at runtime and asks for the relaxed-SIMD build
 * on browsers that support it, plain SIMD on those that don't, and the scalar
 * build otherwise. Vendoring a subset works until it meets a browser that
 * wants the missing one, and then fails as a bare `importScripts` network
 * error from inside the worker.
 *
 * The `.wasm.js` files embed their own wasm, so this stays a flat list rather
 * than a matrix of js + wasm pairs.
 */
const ASSETS = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  [
    'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

function copyIfStale(from, to) {
  if (!existsSync(from)) {
    console.error(`[vendor-ocr] missing: ${from}`);
    console.error('[vendor-ocr] run `npm install` in web/ first.');
    process.exitCode = 1;
    return false;
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size) return true;
  copyFileSync(from, to);
  console.log(`[vendor-ocr] ${to.replace(webRoot + '/', '')}`);
  return true;
}

mkdirSync(outDir, { recursive: true });

let ok = true;
for (const [source, name] of ASSETS) {
  ok = copyIfStale(join(modules, source), join(outDir, name)) && ok;
}

if (ok) {
  writeFileSync(
    join(outDir, 'README.txt'),
    [
      'These files are copied from node_modules by web/scripts/vendor-ocr.mjs.',
      'Do not edit them by hand.',
      '',
      'They exist so LockIn can run OCR without contacting a CDN:',
      '  worker.min.js                   tesseract.js worker (Apache-2.0)',
      '  tesseract-core*-lstm.wasm.js    Tesseract wasm core (Apache-2.0)',
      '  eng.traineddata.gz              English LSTM model (Apache-2.0)',
      '',
      'No image ever leaves the device. OCR runs in a Web Worker on this origin.',
      '',
    ].join('\n'),
  );
}
