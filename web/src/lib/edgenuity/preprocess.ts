/**
 * Getting a phone photo of a monitor into a state Tesseract can read.
 *
 * A 12-megapixel photo of a glossy screen is close to the worst input OCR can
 * be given: it is far larger than the engine needs, it has glare, and the text
 * is low-contrast grey-on-white. Everything here is cheap, deterministic
 * canvas work — no computer-vision library, no model, no network.
 */

/**
 * Longest edge fed to OCR.
 *
 * Tesseract wants roughly 30px-tall characters; below ~1200px the progress
 * number on a full-screen photo falls under that, and above ~2200px recognition
 * stops improving while the time per pass keeps climbing.
 */
export const OCR_TARGET_MAX_DIM = 1800;

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  return ctx;
}

/** Scales down so the longest edge is at most `maxDim`. Never scales up. */
export function downscale(source: HTMLCanvasElement, maxDim = OCR_TARGET_MAX_DIM): HTMLCanvasElement {
  const longest = Math.max(source.width, source.height);
  if (longest <= maxDim) return copy(source);
  const scale = maxDim / longest;
  const out = createCanvas(source.width * scale, source.height * scale);
  const ctx = context2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

export function copy(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = createCanvas(source.width, source.height);
  context2d(out).drawImage(source, 0, 0);
  return out;
}

/**
 * Crops to a normalised rectangle (0..1) of the source.
 *
 * Used by the capture overlay so the student can box the progress area — but
 * see `MIN_CROP_FRACTION`: cropping down to just the number would strip the
 * context that proves the screen is Edgenuity at all.
 */
export const MIN_CROP_FRACTION = 0.25;

export function cropNormalized(
  source: HTMLCanvasElement,
  rect: { x: number; y: number; width: number; height: number },
): HTMLCanvasElement {
  const width = Math.max(MIN_CROP_FRACTION, Math.min(1, rect.width));
  const height = Math.max(MIN_CROP_FRACTION, Math.min(1, rect.height));
  const x = Math.max(0, Math.min(1 - width, rect.x));
  const y = Math.max(0, Math.min(1 - height, rect.y));

  const out = createCanvas(source.width * width, source.height * height);
  context2d(out).drawImage(
    source,
    source.width * x,
    source.height * y,
    source.width * width,
    source.height * height,
    0,
    0,
    out.width,
    out.height,
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* Pixel operations                                                    */
/* ------------------------------------------------------------------ */

function mapPixels(
  source: HTMLCanvasElement,
  fn: (r: number, g: number, b: number) => [number, number, number],
): HTMLCanvasElement {
  const out = createCanvas(source.width, source.height);
  const ctx = context2d(out);
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = fn(data[i], data[i + 1], data[i + 2]);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/** Rec. 601 luma — matches how the text was anti-aliased on the screen. */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function toGrayscale(source: HTMLCanvasElement): HTMLCanvasElement {
  return mapPixels(source, (r, g, b) => {
    const y = luminance(r, g, b);
    return [y, y, y];
  });
}

/** Pushes greys apart around mid-tone. `amount` of 1 leaves the image alone. */
export function boostContrast(source: HTMLCanvasElement, amount = 1.6): HTMLCanvasElement {
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  return mapPixels(source, (r, g, b) => {
    const y = luminance(r, g, b);
    const boosted = clamp((y - 128) * amount + 128);
    return [boosted, boosted, boosted];
  });
}

/** Otsu's method: picks the threshold that best splits text from background. */
export function otsuThreshold(source: HTMLCanvasElement): number {
  const ctx = context2d(source);
  const { data } = ctx.getImageData(0, 0, source.width, source.height);
  const histogram = new Array<number>(256).fill(0);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(luminance(data[i], data[i + 1], data[i + 2]))] += 1;
    total += 1;
  }

  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

export function binarize(source: HTMLCanvasElement, threshold?: number): HTMLCanvasElement {
  const cut = threshold ?? otsuThreshold(source);
  return mapPixels(source, (r, g, b) => {
    const value = luminance(r, g, b) >= cut ? 255 : 0;
    return [value, value, value];
  });
}

/* ------------------------------------------------------------------ */
/* Quality checks                                                      */
/* ------------------------------------------------------------------ */

export type ImageProblem = 'too_small' | 'too_dark' | 'too_bright' | 'too_blurry';

export interface QualityReport {
  ok: boolean;
  problem?: ImageProblem;
  meanLuminance: number;
  /** Variance of a Laplacian pass — the standard cheap blur proxy. */
  focus: number;
  width: number;
  height: number;
}

/** Below this the photo is too small for the progress number to survive OCR. */
const MIN_DIMENSION = 320;
const MIN_FOCUS = 12;

/**
 * Cheap, obvious-failure checks only. This deliberately does not try to be a
 * quality *judge* — a slightly soft photo still often reads fine, and the real
 * verdict comes from whether OCR found Edgenuity signals. It exists to catch
 * the lens-cap cases before spending seconds on a pointless OCR pass.
 */
export function assessQuality(source: HTMLCanvasElement): QualityReport {
  const width = source.width;
  const height = source.height;

  // Measure on a small copy — the statistics do not need full resolution.
  const small = downscale(source, 400);
  const ctx = context2d(small);
  const { data } = ctx.getImageData(0, 0, small.width, small.height);

  const gray = new Float32Array(small.width * small.height);
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const y = luminance(data[i], data[i + 1], data[i + 2]);
    gray[p] = y;
    sum += y;
  }
  const meanLuminance = sum / gray.length;

  // 4-neighbour Laplacian; its variance collapses on a blurred image.
  let laplacianSum = 0;
  let laplacianSquares = 0;
  let count = 0;
  for (let y = 1; y < small.height - 1; y += 1) {
    for (let x = 1; x < small.width - 1; x += 1) {
      const i = y * small.width + x;
      const value =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - small.width] - gray[i + small.width];
      laplacianSum += value;
      laplacianSquares += value * value;
      count += 1;
    }
  }
  const mean = count ? laplacianSum / count : 0;
  const focus = count ? laplacianSquares / count - mean * mean : 0;

  small.width = 0;
  small.height = 0;

  const report: QualityReport = { ok: true, meanLuminance, focus, width, height };
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return { ...report, ok: false, problem: 'too_small' };
  }

  /**
   * Brightness alone says nothing.
   *
   * An Edgenuity course page is mostly white, so a *good* photo of one has a
   * very high mean luminance — an earlier version of this check rejected every
   * real capture as "washed out". What distinguishes an unusable frame is the
   * absence of detail, so the Laplacian variance decides, and the brightness
   * only picks which advice to give.
   */
  if (focus < MIN_FOCUS) {
    if (meanLuminance < 40) return { ...report, ok: false, problem: 'too_dark' };
    if (meanLuminance > 235) return { ...report, ok: false, problem: 'too_bright' };
    return { ...report, ok: false, problem: 'too_blurry' };
  }
  return report;
}

export const QUALITY_ADVICE: Record<ImageProblem, string> = {
  too_small: 'The photo is too small to read. Move closer to the screen and try again.',
  too_dark: 'The photo is too dark. Turn up the screen brightness or move somewhere lighter.',
  too_bright: 'The photo is washed out. Move to reduce glare on the screen.',
  too_blurry: 'The photo is blurry. Hold the camera steady and let it focus before capturing.',
};

/* ------------------------------------------------------------------ */
/* OCR passes                                                          */
/* ------------------------------------------------------------------ */

export interface PreprocessVariant {
  name: 'scaled' | 'grayscale' | 'contrast' | 'binarized';
  canvas: HTMLCanvasElement;
}

/**
 * The small set of variants worth trying, cheapest and most likely first.
 *
 * Kept to four because each one costs a full OCR pass of a second or more on a
 * phone — running twenty would be both slow and no more accurate. The caller
 * stops as soon as a pass produces a confident reading, so the usual cost is
 * one or two.
 */
export function buildVariants(source: HTMLCanvasElement): PreprocessVariant[] {
  const scaled = downscale(source, OCR_TARGET_MAX_DIM);
  const gray = toGrayscale(scaled);
  return [
    { name: 'grayscale', canvas: gray },
    { name: 'contrast', canvas: boostContrast(gray, 1.7) },
    { name: 'binarized', canvas: binarize(gray) },
    { name: 'scaled', canvas: scaled },
  ];
}

/** Frees a variant list. The `scaled` canvas is shared, so release once. */
export function releaseVariants(variants: PreprocessVariant[]): void {
  for (const variant of variants) {
    variant.canvas.width = 0;
    variant.canvas.height = 0;
  }
}

/**
 * A small JPEG for the *active session only*, so the student can see which
 * photo a reading came from. Never full resolution, never persisted beyond the
 * session, never uploaded.
 */
export function toThumbnail(source: HTMLCanvasElement, maxDim = 240): string {
  const small = downscale(source, maxDim);
  const url = small.toDataURL('image/jpeg', 0.6);
  small.width = 0;
  small.height = 0;
  return url;
}
