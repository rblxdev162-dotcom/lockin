/**
 * Development-only capture source.
 *
 * Loads a bundled image instead of opening a camera, so the E2E suite can run
 * the whole verification flow on a machine with no camera.
 *
 * Two independent things keep this out of a student's hands:
 *
 *  1. **It cannot verify anything.** Every frame it produces is stamped
 *     `source: 'fixture'`, and `checkProgress()` refuses those with `not_live`
 *     (see verification.ts, gate 1). Storage re-stamps anything that is not
 *     exactly `live_camera` back to `fixture` on load, so a hand-edited save
 *     file cannot promote one either.
 *  2. **It is not in the production bundle.** This module is only ever reached
 *     through `await import()` inside an `import.meta.env.DEV` branch, which
 *     Rollup evaluates to `false` at build time and eliminates — see
 *     `extension/tests/release.test.mjs`, which fails the build if the string
 *     `TestFixtureCapture` appears in `web/dist`.
 */
import { toCapturedImage } from './capture';
import type { CapturedImage, ProofCaptureSource } from './capture';

export class TestFixtureCapture implements ProofCaptureSource {
  readonly kind = 'fixture' as const;

  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  async capture(): Promise<CapturedImage> {
    const image = await loadImage(this.src);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable');
    ctx.drawImage(image, 0, 0);
    return toCapturedImage(canvas, 'fixture');
  }

  stop(): void {
    /* Nothing to release — no stream is ever opened. */
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load fixture image: ${src}`));
    image.src = src;
  });
}
