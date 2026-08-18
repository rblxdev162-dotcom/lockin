/**
 * The live camera preview, framing overlay and shutter.
 *
 * Deliberately dumb: it opens a camera, hands one frame back and shuts the
 * camera down. It knows nothing about Edgenuity, OCR or verification, which is
 * what lets the camera-cleanup rules below be enforced in exactly one place.
 *
 * The cleanup rules, in order of how badly they'd be missed:
 *   1. every exit path stops the MediaStream — capture, cancel, unmount, and
 *      the page being hidden;
 *   2. the effect that starts the camera also owns stopping it, so a fast
 *      open/close cannot leak a stream started after the close;
 *   3. there is no file input anywhere in this component.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import {
  LiveCameraCapture,
  checkCameraSupport,
  describeCameraError,
} from '../../lib/edgenuity/capture';
import type { CameraProblem, CapturedImage } from '../../lib/edgenuity/capture';
import { cx } from '../../lib/cx';

export function CameraCapture({
  active,
  guidance,
  onCapture,
  onCancel,
  onPermission,
  busy,
  busyLabel,
  challengeCode,
}: {
  /** Set false to force the camera off without unmounting. */
  active: boolean;
  guidance?: ReactNode;
  /**
   * Shown in the overlay when Enhanced Proof is in force, so the student can
   * see where the written code should sit relative to the screen.
   */
  challengeCode?: string;
  onCapture: (image: CapturedImage) => void;
  onCancel: () => void;
  /** Reported so Settings can show camera state without re-prompting. */
  onPermission?: (permission: 'granted' | 'denied') => void;
  /** True while the caller is processing a frame — the shutter locks. */
  busy?: boolean;
  busyLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<LiveCameraCapture | null>(null);
  const [error, setError] = useState<{ problem: CameraProblem; detail: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [canSwitch, setCanSwitch] = useState(false);
  /** Bumped by "Try again" to re-run the start effect. */
  const [attempt, setAttempt] = useState(0);

  const support = checkCameraSupport();

  useEffect(() => {
    if (!active) return;
    if (!support.supported) {
      setError({ problem: support.problem ?? 'unsupported', detail: support.detail ?? '' });
      return;
    }

    let cancelled = false;
    const camera = new LiveCameraCapture();
    cameraRef.current = camera;
    setError(null);
    setReady(false);

    void (async () => {
      try {
        await camera.start();
        // The dialog may have closed while permission was being granted; the
        // stream that just opened still has to be shut down.
        if (cancelled) {
          camera.stop();
          return;
        }
        if (videoRef.current) await camera.attach(videoRef.current);
        if (cancelled) {
          camera.stop();
          return;
        }
        setReady(true);
        onPermission?.('granted');
        setCanSwitch(await camera.hasMultipleCameras());
      } catch (cause) {
        if (cancelled) return;
        const described = describeCameraError(cause);
        setError(described);
        if (described.problem === 'denied') onPermission?.('denied');
      }
    })();

    return () => {
      cancelled = true;
      camera.stop();
      cameraRef.current = null;
      setReady(false);
    };
  }, [active, attempt, support.supported]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the tab, locking the phone, or navigating away must not leave the
  // camera light on.
  useEffect(() => {
    const stopIfHidden = () => {
      if (document.visibilityState === 'hidden') cameraRef.current?.stop();
    };
    document.addEventListener('visibilitychange', stopIfHidden);
    window.addEventListener('pagehide', stopIfHidden);
    return () => {
      document.removeEventListener('visibilitychange', stopIfHidden);
      window.removeEventListener('pagehide', stopIfHidden);
    };
  }, []);

  const capture = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera || busy) return;
    try {
      const image = await camera.capture();
      // The frame is already in a canvas; the camera is no longer needed and is
      // stopped before the (slow) OCR work begins.
      camera.stop();
      setReady(false);
      onCapture(image);
    } catch (cause) {
      setError(describeCameraError(cause));
    }
  }, [busy, onCapture]);

  const cancel = useCallback(() => {
    cameraRef.current?.stop();
    onCancel();
  }, [onCancel]);

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
          <p className="flex items-start gap-2 text-sm font-bold text-amber-700 dark:text-amber-300">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>
              {error.problem === 'denied'
                ? 'Camera access is required for live Edgenuity verification.'
                : 'The camera could not be opened.'}
            </span>
          </p>
          <p className="mt-2 text-sm lk-muted">{error.detail}</p>
          {error.problem === 'denied' && (
            <p className="mt-2 text-xs lk-muted">
              Chrome remembers this choice per site — you may need to allow the camera from the
              icon in the address bar before trying again.
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button
            icon={<Icon name="refresh" size={16} />}
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {guidance}

      <div className="relative overflow-hidden rounded-2xl border lk-border bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="block max-h-[52vh] w-full object-contain"
        />

        {/* Framing guide. Generous on purpose: cropping tight to the number
            would remove the context that proves this is Edgenuity at all. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
          <div className="relative h-[78%] w-[88%] rounded-xl border-2 border-dashed border-white/70">
            <span className="absolute inset-x-0 -bottom-px translate-y-full pt-2 text-center text-[0.7rem] font-bold text-white/85 drop-shadow">
              {challengeCode
                ? 'Edgenuity screen here — code in the corner box'
                : 'Place the Edgenuity screen inside this area'}
            </span>

            {/* Enhanced Proof: a second, smaller region for the written code.
                It sits in a corner so the code lands beside the screen rather
                than over the progress information it is meant to accompany. */}
            {challengeCode && (
              <div className="absolute right-2 bottom-2 rounded-lg border-2 border-dashed border-brand-300 bg-black/45 px-3 py-1.5">
                <span className="font-mono text-lg font-extrabold tracking-[0.25em] text-white">
                  {challengeCode}
                </span>
              </div>
            )}
          </div>
        </div>

        {!ready && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm font-semibold text-white">
            Starting camera…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="lg"
          icon={<Icon name="camera" size={18} />}
          disabled={!ready || busy}
          onClick={() => void capture()}
        >
          {busy ? (busyLabel ?? 'Working…') : 'Capture'}
        </Button>
        {canSwitch && (
          <Button
            variant="secondary"
            icon={<Icon name="refresh" size={16} />}
            disabled={!ready || busy}
            onClick={() => void cameraRef.current?.switchCamera()}
          >
            Switch camera
          </Button>
        )}
        <Button variant="secondary" onClick={cancel}>
          Cancel
        </Button>
      </div>

      <p className={cx('text-center text-xs lk-muted')}>
        The photo is read on this device and then discarded. Nothing is uploaded.
      </p>
    </div>
  );
}
