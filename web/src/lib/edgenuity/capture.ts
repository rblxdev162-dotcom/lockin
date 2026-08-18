/**
 * Where a proof image comes from.
 *
 * Strict Edgenuity verification accepts exactly one source: a frame grabbed
 * from a window the student shared with this tab. There is no "upload a
 * photo", no drag-and-drop and no file picker anywhere in the flow — not
 * because a screen image cannot be faked, but because removing the file picker
 * removes the easiest way to fake it. `getDisplayMedia` hands back a stream the
 * browser opened, never a file the student chose.
 *
 * The camera source this file used to carry is gone (it was Phase 4; removed
 * in Phase 15). It assumed two machines — a school computer showing Edgenuity,
 * and the student's own device holding the camera. On one Mac the camera faces
 * the student, so it could never photograph the screen beside it, and pointing
 * a webcam at schoolwork was never a thing this app should have asked for.
 *
 * The fixture capture source the E2E suite uses lives in its own module,
 * `capture.dev.ts`, which is only ever reached through a dynamic import behind
 * `import.meta.env.DEV`. That keeps it out of the production bundle entirely
 * rather than relying on the UI never offering it.
 */

export interface CapturedImage {
  /** The frame itself. Callers must call `release()` when finished with it. */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  capturedAt: string;
  source: 'live_screen' | 'fixture';
  /** Frees the backing canvas so repeated captures don't accumulate memory. */
  release(): void;
}

export interface ProofCaptureSource {
  readonly kind: 'live_screen' | 'fixture';
  capture(): Promise<CapturedImage>;
  stop(): void;
}

/** Wraps a canvas as a CapturedImage with a working `release()`. */
export function toCapturedImage(
  canvas: HTMLCanvasElement,
  source: CapturedImage['source'],
): CapturedImage {
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    capturedAt: new Date().toISOString(),
    source,
    release() {
      // Zero-sizing is what actually releases the backing store in Safari and
      // Chrome; dropping the reference alone can leave it alive until GC.
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Live screen                                                         */
/* ------------------------------------------------------------------ */

export type ScreenProblem = 'unsupported' | 'insecure_context' | 'denied' | 'unknown';

export interface ScreenSupport {
  supported: boolean;
  problem?: ScreenProblem;
  detail?: string;
}

/**
 * `getDisplayMedia` has the same secure-context rule as the camera, and
 * `localhost` satisfies it.
 */
export function checkScreenSupport(): ScreenSupport {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { supported: false, problem: 'unsupported', detail: 'No browser environment.' };
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      problem: 'insecure_context',
      detail:
        'Screen sharing only works on a secure page. Open LockIn at http://localhost:5173 rather than over a plain network address.',
    };
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return {
      supported: false,
      problem: 'unsupported',
      detail: 'This browser does not let web pages capture a window.',
    };
  }
  return { supported: true };
}

export function describeScreenError(error: unknown): { problem: ScreenProblem; detail: string } {
  const name = (error as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        problem: 'denied',
        detail:
          'No window was shared. Choose your Edgenuity window in the picker — on a Mac you may also need to allow Screen Recording for Chrome in System Settings, then restart Chrome.',
      };
    case 'NotFoundError':
      return { problem: 'unknown', detail: 'No window was available to capture.' };
    case 'InvalidStateError':
      return {
        problem: 'unknown',
        detail: 'The window picker could not open. Click the button again.',
      };
    default:
      return { problem: 'unknown', detail: 'The window could not be captured.' };
  }
}

/**
 * Owns the MediaStream for one screen-share capture.
 *
 * Three things about `getDisplayMedia` shape this class, and none of them are
 * worth rediscovering the hard way:
 *
 *   1. **It prompts every single call.** Permission can never persist, by
 *      spec. So the flow is one picker per capture, and the class does not try
 *      to hold a stream open between the before and after readings.
 *   2. **It needs a real click.** Transient user activation is required, so
 *      `start()` must be called straight out of an event handler — never from
 *      an effect, a timer, or after an `await` on something slow.
 *   3. **A page cannot pre-select a window.** Chrome refuses to let the page
 *      choose for the user, on purpose. `monitorTypeSurfaces: 'exclude'` and
 *      `selfBrowserSurface: 'exclude'` are the most steering that is allowed —
 *      they push the picker toward windows and keep LockIn from capturing
 *      itself into a hall of mirrors.
 *
 * The student sharing a window they picked is the whole consent model here.
 * Nothing captures in the background, and there is no path that reopens a
 * stream without another click.
 */
export class LiveScreenCapture implements ProofCaptureSource {
  readonly kind = 'live_screen' as const;

  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  get active(): boolean {
    return !!this.stream;
  }

  /**
   * The running stream, so the UI can notice Chrome's own "Stop sharing".
   * Read-only on purpose: callers observe it, they never swap it.
   */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /** Must be called directly from a click handler — see note 2 above. */
  async start(): Promise<MediaStream> {
    const support = checkScreenSupport();
    if (!support.supported) throw new Error(support.detail ?? 'Screen sharing unavailable');

    this.stop();
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 5 },
      },
      audio: false,
      // Steer toward a single window, and never offer LockIn's own tab.
      monitorTypeSurfaces: 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions);

    // The student can end the share from Chrome's own bar. Treat that as a
    // stop rather than leaving a dead stream attached.
    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener('ended', () => this.stop(), { once: true });
    }
    return this.stream;
  }

  /** Binds the running stream to a video element and waits for real frames. */
  async attach(video: HTMLVideoElement): Promise<void> {
    if (!this.stream) throw new Error('Screen sharing is not running');
    this.video = video;
    video.srcObject = this.stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play().catch(() => {
      /* Autoplay refusal still leaves a usable preview after a user gesture. */
    });
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener('loadeddata', done);
          resolve();
        };
        video.addEventListener('loadeddata', done);
        window.setTimeout(done, 3000);
      });
    }
  }

  /** What the student actually shared, for the UI to name it back to them. */
  get surfaceLabel(): string | null {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return null;
    const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
    return settings.displaySurface ?? null;
  }

  async capture(): Promise<CapturedImage> {
    const video = this.video;
    if (!video || !this.stream) throw new Error('Screen sharing is not running');

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('The shared window has not produced a frame yet');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable');
    ctx.drawImage(video, 0, 0, width, height);

    return toCapturedImage(canvas, 'live_screen');
  }

  /** Stops every track and detaches the preview. Safe to call repeatedly. */
  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }
}
