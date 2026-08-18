/**
 * The code the student has to get into the photo.
 *
 * Its whole job is legibility. The code is about to be copied out by hand and
 * then read back by OCR through a phone camera, so it is shown large, spaced,
 * and in a monospaced face where the restricted alphabet stays unambiguous.
 * Colour is never the only signal — the countdown says the time in words as
 * well as changing tone — and it can be read aloud for anyone who would rather
 * hear it.
 */
import { useEffect, useState } from 'react';
import type { VerificationChallenge } from '../../types';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { cx } from '../../lib/cx';

export function EdgenuityChallengeCard({
  challenge,
  now,
  onRegenerate,
}: {
  challenge: VerificationChallenge;
  /** Ticking clock from the store, so the countdown stays live. */
  now: number;
  onRegenerate: () => void;
}) {
  const msLeft = Date.parse(challenge.expiresAt) - now;
  const expired = msLeft <= 0 || challenge.status !== 'pending';
  const secondsLeft = Math.max(0, Math.round(msLeft / 1000));
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  if (expired || !challenge.value) {
    return (
      <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
        <p className="text-sm font-bold text-amber-700 dark:text-amber-300">
          That verification code expired.
        </p>
        <p className="mt-1 text-sm lk-muted">
          Codes last five minutes so an old photo can’t be reused. Generate a new one to continue.
        </p>
        <Button className="mt-3" icon={<Icon name="refresh" size={16} />} onClick={onRegenerate}>
          Generate new code
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-brand-500/50 bg-brand-50 p-4 dark:bg-brand-900/30">
      <p className="text-xs font-bold tracking-wide text-brand-700 uppercase dark:text-brand-300">
        Enhanced Proof · your verification code
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <p
          // Spaced characters read better on camera and are easier to copy by
          // hand one glyph at a time.
          className="font-mono text-5xl font-extrabold tracking-[0.35em] lk-strong select-all"
          aria-label={`Verification code ${challenge.value.split('').join(' ')}`}
        >
          {challenge.value}
        </p>
        <SpeakButton value={challenge.value} />
      </div>

      <ol className="mt-3 space-y-1.5 text-sm lk-strong">
        <li className="flex gap-2">
          <span className="font-bold lk-muted">1.</span>
          <span>
            Write this code on paper in large <strong>BLOCK CAPITALS</strong>, using dark ink, with
            the characters clearly separated.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-bold lk-muted">2.</span>
          <span>
            Put the paper <strong>beside</strong> the monitor — not over the Edgenuity progress
            information.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-bold lk-muted">3.</span>
          <span>Take one photo showing both the code and your Edgenuity progress.</span>
        </li>
      </ol>

      <p
        className={cx(
          'mt-3 text-xs font-semibold',
          secondsLeft <= 60 ? 'text-flame-600 dark:text-flame-400' : 'lk-muted',
        )}
      >
        Code expires in {minutes > 0 ? `${minutes} min ` : ''}
        {seconds} sec
        {secondsLeft <= 60 && ' — take the photo soon, or generate a new code.'}
      </p>

      <p className="mt-1 text-xs lk-muted">
        If you have a second device, you can display the code on it instead of writing it.
      </p>
    </div>
  );
}

/** Reads the code out one character at a time. Uses the OS voice; no network. */
function SpeakButton({ value }: { value: string }) {
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window), []);
  if (!supported) return null;

  return (
    <button
      type="button"
      title="Read the code aloud"
      aria-label="Read the verification code aloud"
      className="rounded-lg p-2 lk-muted transition-colors hover:lk-sunken hover:lk-strong"
      onClick={() => {
        const utterance = new SpeechSynthesisUtterance(value.split('').join(', '));
        utterance.rate = 0.7;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }}
    >
      <Icon name="volume" size={18} />
    </button>
  );
}
