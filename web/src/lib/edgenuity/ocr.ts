/**
 * The local OCR engine.
 *
 * Tesseract, compiled to WebAssembly, running in a Web Worker on this origin.
 * Nothing about a capture leaves the device: the engine, its wasm core and the
 * English model are all served from `/ocr/` (copied out of node_modules by
 * `web/scripts/vendor-ocr.mjs`), which is what keeps LockIn's "no network
 * calls" rule true with OCR in the product. tesseract.js would otherwise fetch
 * all three from a CDN.
 *
 * The worker is expensive to start (a few seconds, and ~3MB of model to
 * decompress) and cheap to keep, so one instance is shared for the duration of
 * a verification flow and shut down once it has been idle for a while.
 */
import type { Worker as TesseractWorker } from 'tesseract.js';
import type { OcrWord } from '../../types/edgenuity';

/** Everything the engine needs, served by us. */
const OCR_BASE = '/ocr';
const WORKER_PATH = `${OCR_BASE}/worker.min.js`;
const CORE_PATH = `${OCR_BASE}/`;
const LANG_PATH = OCR_BASE;

/** How long an idle worker is kept before it is terminated. */
const IDLE_TERMINATE_MS = 90_000;

export type OcrStage = 'loading_engine' | 'preparing_image' | 'reading' | 'finding_progress';

export interface OcrProgress {
  stage: OcrStage;
  /** 0..1 within the current stage, when the engine reports it. */
  ratio?: number;
}

export interface OcrTextResult {
  text: string;
  /** Mean character confidence, 0..100. */
  confidence: number;
  /** Word positions, used to tell a progress column from a grade column. */
  words: OcrWord[];
}

/** Flattens Tesseract's block/paragraph/line tree into positioned words. */
export function wordsFromResult(data: unknown): OcrWord[] {
  const blocks = (data as { blocks?: unknown[] } | null)?.blocks;
  if (!Array.isArray(blocks)) return [];
  const words: OcrWord[] = [];
  for (const block of blocks as { paragraphs?: unknown[] }[]) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of (paragraph as { lines?: unknown[] }).lines ?? []) {
        for (const word of (line as { words?: unknown[] }).words ?? []) {
          const w = word as { text?: string; bbox?: Record<string, number> };
          if (!w.text || !w.bbox) continue;
          words.push({
            text: w.text,
            x0: w.bbox.x0,
            y0: w.bbox.y0,
            x1: w.bbox.x1,
            y1: w.bbox.y1,
          });
        }
      }
    }
  }
  return words;
}

export const STAGE_LABEL: Record<OcrStage, string> = {
  loading_engine: 'Starting the text reader…',
  preparing_image: 'Preparing image…',
  reading: 'Reading text…',
  finding_progress: 'Finding course progress…',
};

/* ------------------------------------------------------------------ */
/* Worker lifecycle                                                    */
/* ------------------------------------------------------------------ */

let workerPromise: Promise<TesseractWorker> | null = null;
let leases = 0;
let idleTimer: number | null = null;
let everLoaded = false;

/** True once the engine has been initialised at least once this session. */
export function ocrEverLoaded(): boolean {
  return everLoaded;
}

/** True when a worker is warm and the next read will skip engine start-up. */
export function ocrReady(): boolean {
  return workerPromise !== null;
}

function cancelIdleTimer() {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
}

async function startWorker(onProgress?: (progress: OcrProgress) => void): Promise<TesseractWorker> {
  // Imported lazily so the OCR engine is not in the main bundle: a student who
  // never uses Edgenuity never downloads it.
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    workerPath: WORKER_PATH,
    corePath: CORE_PATH,
    langPath: LANG_PATH,
    // The model ships gzipped and is cached in IndexedDB after the first run.
    gzip: true,
    logger: (message) => {
      if (message.status === 'recognizing text') {
        onProgress?.({ stage: 'reading', ratio: message.progress });
      } else {
        onProgress?.({ stage: 'loading_engine', ratio: message.progress });
      }
    },
  });

  /**
   * Automatic page segmentation — Tesseract's own default, but *not*
   * tesseract.js's, which ships `SINGLE_BLOCK`.
   *
   * Single-block mode assumes the image is one uniform column of text and
   * silently drops everything outside it: sidebars, second columns, and — the
   * reason this was found — a code written on paper beside the monitor. Auto
   * mode segments the page properly and reads all of it.
   */
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });

  everLoaded = true;
  return worker;
}

/**
 * Borrows the shared worker. Every caller must `release()` — the worker is
 * terminated once the last lease is returned and the idle delay passes.
 */
export async function acquireOcr(
  onProgress?: (progress: OcrProgress) => void,
): Promise<TesseractWorker> {
  cancelIdleTimer();
  leases += 1;
  if (!workerPromise) {
    onProgress?.({ stage: 'loading_engine', ratio: 0 });
    workerPromise = startWorker(onProgress).catch((error) => {
      // A failed start must not poison every later attempt.
      workerPromise = null;
      leases = Math.max(0, leases - 1);
      throw error;
    });
  }
  return workerPromise;
}

export function releaseOcr(): void {
  leases = Math.max(0, leases - 1);
  if (leases > 0 || !workerPromise) return;
  cancelIdleTimer();
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    if (leases === 0) void terminateOcr();
  }, IDLE_TERMINATE_MS);
}

/** Stops the engine immediately — cancellation, or leaving the flow. */
export async function terminateOcr(): Promise<void> {
  cancelIdleTimer();
  const pending = workerPromise;
  workerPromise = null;
  leases = 0;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    /* Already gone. */
  }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Runs one OCR pass over an already-preprocessed canvas.
 *
 * `signal` does not interrupt the wasm engine mid-page — nothing can, short of
 * killing the worker — so cancellation is honoured on both sides of the call
 * and the caller terminates the worker if it wants the CPU back immediately.
 */
export async function recognizeCanvas(
  canvas: HTMLCanvasElement,
  options: { onProgress?: (progress: OcrProgress) => void; signal?: AbortSignal } = {},
): Promise<OcrTextResult> {
  if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

  const worker = await acquireOcr(options.onProgress);
  try {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    options.onProgress?.({ stage: 'reading', ratio: 0 });
    // `blocks` is what carries the word boxes; without it a two-column page
    // cannot be read reliably.
    const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
    return {
      text: result.data.text ?? '',
      confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : 0,
      words: wordsFromResult(result.data),
    };
  } finally {
    releaseOcr();
  }
}

/** Starts the engine ahead of time so the first capture feels instant. */
export async function warmUpOcr(onProgress?: (progress: OcrProgress) => void): Promise<boolean> {
  try {
    await acquireOcr(onProgress);
    releaseOcr();
    return true;
  } catch {
    return false;
  }
}
