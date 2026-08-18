/**
 * Where a proof image comes from.
 *
 * Strict Edgenuity verification accepts exactly two sources, and both are live
 * MediaStreams grabbed in this tab: a camera frame (Phase 4) or a screen-share
 * frame (Phase 12). There is no "upload a photo", no drag-and-drop and no file
 * picker anywhere in the flow — not because a photographed screen cannot be
 * faked, but because removing the file picker removes the easiest way to fake
 * it. A screen source keeps that property: `getDisplayMedia` hands back a
 * stream the browser opened, never a file the student chose.
 *
 * Screen capture exists because the camera path assumes two machines — a
 * school computer showing Edgenuity and the student's own device holding the
 * camera. When both are the same Mac, its camera faces the student, and no
 * amount of framing help makes a screen photograph itself.
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
  source: 'live_camera' | 'live_screen' | 'fixture';
  /** Frees the backing canvas so repeated captures don't accumulate memory. */
  release(): void;
}

export interface ProofCaptureSource {
  readonly kind: 'live_camera' | 'live_screen' | 'fixture';
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
/* Camera availability                                                 */
/* ------------------------------------------------------------------ */

export type CameraProblem =
  | 'unsupported'
  | 'insecure_context'
  | 'denied'
  | 'not_found'
  | 'in_use'
  | 'unknown';

export interface CameraSupport {
  supported: boolean;
  problem?: CameraProblem;
  /** Explains what is missing, in the student's words. */
  detail?: string;
}

/**
 * getUserMedia only exists on secure origins. `localhost` counts as secure, so
 * the shipped dev setup works; a LAN IP like `http://192.168.1.5:5173` does
 * not, and that is worth saying plainly instead of showing a dead button.
 */
export function checkCameraSupport(): CameraSupport {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { supported: false, problem: 'unsupported', detail: 'No browser environment.' };
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      problem: 'insecure_context',
      detail:
        'Cameras only work on a secure page. Open LockIn at http://localhost:5173 (or an https address) rather than over a plain network address.',
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      supported: false,
      problem: 'unsupported',
      detail: 'This browser does not provide camera access to web pages.',
    };
  }
  return { supported: true };
}

/** Maps a DOMException from getUserMedia onto something a student can act on. */
export function describeCameraError(error: unknown): { problem: CameraProblem; detail: string } {
  const name = (error as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        problem: 'denied',
        detail:
          'Camera access is required for live Edgenuity verification. Allow the camera for this page and try again.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { problem: 'not_found', detail: 'No camera was found on this device.' };
    case 'NotReadableError':
    case 'AbortError':
      return {
        problem: 'in_use',
        detail: 'The camera is already being used by another app. Close it and try again.',
      };
    default:
      return { problem: 'unknown', detail: 'The camera could not be started.' };
  }
}

/* ------------------------------------------------------------------ */
/* Live camera                                                         */
/* ------------------------------------------------------------------ */

export type FacingMode = 'environment' | 'user';

/**
 * Owns the MediaStream for one capture flow.
 *
 * The single most important behaviour in this file is that `stop()` really
 * stops every track. A page that keeps a camera light on after the student
 * closed the dialog is both a privacy failure and the kind of thing that gets
 * an app uninstalled, so every exit path — capture, cancel, unmount, page hide
 * — routes through here.
 */
export class LiveCameraCapture implements ProofCaptureSource {
  readonly kind = 'live_camera' as const;

  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private facing: FacingMode = 'environment';

  get facingMode(): FacingMode {
    return this.facing;
  }

  get active(): boolean {
    return !!this.stream;
  }

  /**
   * Starts the camera and resolves with the stream to show in a <video>.
   * Rear-facing is preferred because the student is photographing another
   * screen, but it is a preference rather than a constraint — a laptop with
   * only a front camera still works.
   */
  async start(facing: FacingMode = this.facing): Promise<MediaStream> {
    const support = checkCameraSupport();
    if (!support.supported) throw new Error(support.detail ?? 'Camera unavailable');

    this.stop();
    this.facing = facing;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    return this.stream;
  }

  /** Binds the running stream to a video element and waits for real frames. */
  async attach(video: HTMLVideoElement): Promise<void> {
    if (!this.stream) throw new Error('Camera is not running');
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
        // Never hang the UI on a camera that refuses to produce frames.
        window.setTimeout(done, 3000);
      });
    }
  }

  /** True when the device has more than one camera worth switching to. */
  async hasMultipleCameras(): Promise<boolean> {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput').length > 1;
    } catch {
      return false;
    }
  }

  async switchCamera(): Promise<MediaStream> {
    const next: FacingMode = this.facing === 'environment' ? 'user' : 'environment';
    const stream = await this.start(next);
    if (this.video) await this.attach(this.video);
    return stream;
  }

  /** Grabs the current frame at the camera's own resolution. */
  async capture(): Promise<CapturedImage> {
    const video = this.video;
    if (!video || !this.stream) throw new Error('Camera is not running');

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('The camera has not produced a frame yet');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable');
    ctx.drawImage(video, 0, 0, width, height);

    return toCapturedImage(canvas, 'live_camera');
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
