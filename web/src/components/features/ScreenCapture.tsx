/**
 * Sharing one window, previewing it, and grabbing a single frame.
 *
 * The sibling of `CameraCapture`, and deliberately as dumb: it opens a screen
 * share, hands one frame back, and stops the stream. It knows nothing about
 * Edgenuity, OCR or verification.
 *
 * Two rules from `getDisplayMedia` shape the whole component, and neither is
 * negotiable:
 *
 *   1. **A real click starts it.** Transient user activation is required, so
 *      the picker is opened from the button's own handler — never from an
 *      effect. This is the one place where this component differs from
 *      `CameraCapture`, which can start its stream on mount.
 *   2. **Chrome prompts every time.** Permission can never persist, so there
 *      is no "remember this window" and nothing to cache between the before
 *      and after readings. That is the consent model, not a limitation to
 *      work around.
 *
 * Cleanup matches the camera component: every exit path — capture, cancel,
 * unmount, page hide, and the student pressing Chrome's own "Stop sharing" —
 * stops the stream. There is no file input anywhere in here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import {
  LiveScreenCapture,
  checkScreenSupport,
  describeScreenError,
} from '../../lib/edgenuity/capture';
import type { CapturedImage, ScreenProblem } from '../../lib/edgenuity/capture';

export function ScreenCapture({
  guidance,
  onCapture,
  onCancel,
  busy,
  busyLabel,
}: {
  guidance?: ReactNode;
  onCapture: (image: CapturedImage) => void;
  onCancel: () => void;
  busy?: boolean;
  busyLabel?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<LiveScreenCapture | null>(null);
  const [error, setError] = useState<{ problem: ScreenProblem; detail: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [surface, setSurface] = useState<string | null>(null);

  const support = checkScreenSupport();

  const stop = useCallback(() => {
    screenRef.current?.stop();
    screenRef.current = null;
    setSharing(false);
    setSurface(null);
  }, []);

  // Unmount and page-hide are the two exits the component cannot see coming.
  useEffect(() => {
    const onHide = () => stop();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      stop();
    };
  }, [stop]);

  /** Called straight from the click — see rule 1 at the top of this file. */
  const share = async () => {
    setError(null);
    const capture = new LiveScreenCapture();
    screenRef.current = capture;
    try {
      await capture.start();
    } catch (err) {
      // Cancelling the picker throws NotAllowedError too. It is not a failure,
      // so it reads as guidance rather than an error state.
      setError(describeScreenError(err));
      stop();
      return;
    }

    setSharing(true);
    setSurface(capture.surfaceLabel);

    const video = videoRef.current;
    if (video) {
      try {
        await capture.attach(video);
      } catch {
        setError({ problem: 'unknown', detail: 'The shared window could not be previewed.' });
      }
    }

    /**
     * The student can stop sharing from Chrome's own bar at any moment. The
     * capture class already stops its tracks; this keeps the UI honest about
     * it rather than showing a frozen last frame as if it were live.
     */
    const track = capture.mediaStream?.getVideoTracks()[0];
    track?.addEventListener('ended', () => {
      setSharing(false);
      setSurface(null);
    });
  };

  const take = async () => {
    const capture = screenRef.current;
    if (!capture) return;
    try {
      const image = await capture.capture();
      // One frame is all that is wanted; holding the share open afterwards
      // would keep a window visible to the page for no reason.
      stop();
      onCapture(image);
    } catch (err) {
      setError(describeScreenError(err));
    }
  };

  if (!support.supported) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border px-3 py-2 text-sm lk-border lk-muted">{support.detail}</p>
        <Button variant="secondary" onClick={onCancel}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border lk-border lk-sunken">
        <video
          ref={videoRef}
          className="block h-auto w-full"
          style={{ aspectRatio: '16 / 10', display: sharing ? 'block' : 'none' }}
          playsInline
          muted
        />
        {!sharing && (
          <div className="grid place-items-center px-6 py-10 text-center">
            <Icon name="edgenuity" size={28} className="mb-2 lk-muted" />
            <p className="text-sm font-semibold lk-strong">Share your Edgenuity window</p>
            <p className="mt-1 max-w-sm text-xs lk-muted">
              Chrome will ask which window to share. Pick the window that has your Edgenuity
              course open — LockIn reads one frame from it and stops.
            </p>
          </div>
        )}
      </div>

      {guidance}

      {sharing && surface && surface !== 'window' && (
        // A whole monitor works, but naming what was shared beats a silent
        // surprise about how much is in frame.
        <p className="text-xs lk-muted">
          You shared your {surface === 'monitor' ? 'whole screen' : surface}. A single window is
          usually easier for LockIn to read.
        </p>
      )}

      {error && <p className="rounded-xl border px-3 py-2 text-sm lk-border lk-muted">{error.detail}</p>}

      <div className="flex flex-wrap gap-2">
        {!sharing ? (
          <Button onClick={share} icon={<Icon name="edgenuity" size={16} />}>
            Choose window
          </Button>
        ) : (
          <Button onClick={take} disabled={busy}>
            {busy ? (busyLabel ?? 'Reading…') : 'Capture this window'}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            stop();
            onCancel();
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
