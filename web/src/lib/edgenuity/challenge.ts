/**
 * One-time challenge codes — generation, lifetime, and detection in a photo.
 *
 * What this buys, precisely: a photograph taken before the code existed cannot
 * contain the code. That defeats a *prepared* image — yesterday's screenshot,
 * a classmate's screen photographed at lunch, a saved picture kept for later.
 *
 * What it does not buy: any evidence about whether the screen in the photo is
 * genuine, or whose it is. Someone standing in front of the right screen with
 * a pen can always satisfy this. That is the honest limit and the UI says so.
 *
 * Pure module: no DOM, no React, no network. `crypto.getRandomValues` is the
 * only environment dependency, and it exists in browsers and in Node.
 */
import type {
  ChallengeDetection,
  OcrWord,
  VerificationChallenge,
} from '../../types/edgenuity';
import { CHALLENGE_TTL_MS } from '../../types/edgenuity';

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Characters OCR can tell apart, written by hand, in bad light.
 *
 * Excluded on purpose: `0/O/D/Q`, `1/I/L`, `5/S`, `8/B`, `2/Z`, `6/G`, `U/V`.
 * Losing those costs a little entropy and buys the thing that makes the whole
 * feature affordable — matching can demand an *exact* string rather than
 * guessing through a table of OCR confusions, and a guess-through-confusions
 * matcher is exactly how a challenge system quietly stops being evidence.
 */
export const CHALLENGE_LETTERS = 'ACEFHJKMNPRTWXY';
export const CHALLENGE_DIGITS = '34679';
export const CHALLENGE_ALPHABET = CHALLENGE_LETTERS + CHALLENGE_DIGITS;

export const CHALLENGE_LENGTH = 4;

/**
 * Uniform random index into `max`, via rejection sampling.
 *
 * `value % max` would bias toward the low end of the alphabet; with a 20-symbol
 * alphabet and 256 buckets the skew is small but there is no reason to accept
 * it when discarding the ragged tail is two lines.
 */
function randomIndex(max: number): number {
  const limit = Math.floor(256 / max) * max;
  const buffer = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % max;
  }
}

function pick(source: string): string {
  return source[randomIndex(source.length)];
}

/** Fisher-Yates over a small array, using the same unbiased source. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A fresh code, e.g. `K7M4`.
 *
 * Guaranteed to contain at least one letter and one digit. That is not
 * decoration: it is what lets the detector recognise a *code-like* token
 * without matching ordinary words on the page — `MATH` and `PROGRESS` can
 * never be candidates, so a near-miss against real page text is impossible.
 */
export function generateChallengeValue(length = CHALLENGE_LENGTH): string {
  const size = Math.max(2, Math.min(8, length));
  const characters = [pick(CHALLENGE_LETTERS), pick(CHALLENGE_DIGITS)];
  for (let i = characters.length; i < size; i += 1) characters.push(pick(CHALLENGE_ALPHABET));
  return shuffle(characters).join('');
}

/**
 * FNV-1a, 32-bit. Deliberately *not* a security hash.
 *
 * Its only job is to let a spent challenge stay linked to the record it proved
 * without keeping the code itself lying around. A four-character code from a
 * 20-symbol alphabet would fall to a brute-force search instantly whatever the
 * hash, and the student was shown the code anyway — pretending otherwise would
 * be the sort of security theatre this feature is supposed to avoid.
 */
export function hashChallengeValue(value: string): string {
  let hash = 0x811c9dc5;
  const normalized = normalizeChallengeText(value);
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ */
/* Lifetime                                                            */
/* ------------------------------------------------------------------ */

export function challengeExpiryFrom(createdAt: string, ttlMs = CHALLENGE_TTL_MS): string {
  return new Date(Date.parse(createdAt) + ttlMs).toISOString();
}

export function isChallengeExpired(challenge: VerificationChallenge, now = Date.now()): boolean {
  const expires = Date.parse(challenge.expiresAt);
  return Number.isNaN(expires) || expires <= now;
}

export const CHALLENGE_REJECTIONS = [
  'missing',
  'expired',
  'already_used',
  'wrong_assignment',
  'wrong_session',
  'wrong_phase',
  'not_pending',
] as const;
export type ChallengeRejection = (typeof CHALLENGE_REJECTIONS)[number];

export interface ChallengeUsabilityContext {
  assignmentId: string;
  phase: VerificationChallenge['phase'];
  /** Null while the starting proof is being taken — the session doesn't exist yet. */
  sessionId: string | null;
  now?: number;
}

/**
 * May this challenge be consumed right now?
 *
 * Every rejection here is one of the replay attempts Phase 5 exists to stop, so
 * they are all checked, in one place, and the reducer calls this rather than
 * trusting anything the UI passes in.
 */
export function challengeUsable(
  challenge: VerificationChallenge | undefined,
  context: ChallengeUsabilityContext,
): { ok: true } | { ok: false; reason: ChallengeRejection } {
  const now = context.now ?? Date.now();
  if (!challenge) return { ok: false, reason: 'missing' };
  if (challenge.status === 'verified' || challenge.usedAt) {
    return { ok: false, reason: 'already_used' };
  }
  if (challenge.status !== 'pending') return { ok: false, reason: 'not_pending' };
  if (isChallengeExpired(challenge, now)) return { ok: false, reason: 'expired' };
  if (challenge.assignmentId !== context.assignmentId) {
    return { ok: false, reason: 'wrong_assignment' };
  }
  if (challenge.phase !== context.phase) return { ok: false, reason: 'wrong_phase' };
  // A `before` challenge is issued before its session exists, so null is the
  // expected state; an `after` challenge must name the session it was cut for.
  if (challenge.sessionId !== null && challenge.sessionId !== context.sessionId) {
    return { ok: false, reason: 'wrong_session' };
  }
  if (challenge.phase === 'after' && challenge.sessionId === null) {
    return { ok: false, reason: 'wrong_session' };
  }
  return { ok: true };
}

export const CHALLENGE_REJECTION_MESSAGE: Record<ChallengeRejection, string> = {
  missing: 'No verification code was issued for this capture.',
  expired: 'That code is no longer valid. Generate a new code to continue.',
  already_used: 'That code has already been used. Generate a new code to continue.',
  wrong_assignment: 'That code belongs to a different assignment.',
  wrong_session: 'That code belongs to a different verification session.',
  wrong_phase: 'That code was issued for a different step of the verification.',
  not_pending: 'That code is no longer usable. Generate a new code to continue.',
};

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

/** Uppercase, strip everything that isn't a letter or digit. `k-7 m4` -> `K7M4`. */
export function normalizeChallengeText(value: string): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Only tokens shaped like a code are considered — never ordinary page words. */
function isCodeLike(token: string): boolean {
  if (token.length < 3 || token.length > 8) return false;
  if (!/^[A-Z0-9]+$/.test(token)) return false;
  return /[A-Z]/.test(token) && /[0-9]/.test(token);
}

interface CodeToken {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Code-shaped tokens in the image, including ones OCR split apart.
 *
 * Hand-written characters are often spaced, and Tesseract then returns `K 7 M 4`
 * as four separate words. Joining short runs of neighbouring words on the same
 * line is what makes a written card readable at all; without it Enhanced Proof
 * would fail on exactly the input it was designed for.
 */
export function collectCodeTokens(words: OcrWord[]): CodeToken[] {
  const usable = words.filter((w) => w.text.trim().length > 0);
  const tokens: CodeToken[] = [];

  for (const word of usable) {
    const text = normalizeChallengeText(word.text);
    if (isCodeLike(text)) {
      tokens.push({ text, x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 });
    }
  }

  const heights = usable.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const lineHeight = heights[Math.floor(heights.length / 2)] || 20;

  // Join runs of up to 8 short neighbouring fragments on the same line.
  const byLine = [...usable].sort(
    (a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0,
  );
  for (let start = 0; start < byLine.length; start += 1) {
    let combined = normalizeChallengeText(byLine[start].text);
    if (combined.length === 0 || combined.length > 4) continue;
    let box = { ...byLine[start] };

    for (let end = start + 1; end < byLine.length && end - start < 8; end += 1) {
      const next = byLine[end];
      const sameLine =
        Math.abs((next.y0 + next.y1) / 2 - (box.y0 + box.y1) / 2) < lineHeight * 0.7;
      const adjacent = next.x0 - box.x1 < lineHeight * 1.5 && next.x0 >= box.x0;
      if (!sameLine || !adjacent) break;

      const piece = normalizeChallengeText(next.text);
      if (piece.length === 0 || piece.length > 4) break;
      combined += piece;
      box = {
        text: combined,
        x0: Math.min(box.x0, next.x0),
        y0: Math.min(box.y0, next.y0),
        x1: Math.max(box.x1, next.x1),
        y1: Math.max(box.y1, next.y1),
      };
      if (isCodeLike(combined)) {
        tokens.push({ text: combined, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 });
      }
      if (combined.length >= 8) break;
    }
  }

  return tokens;
}

/** Characters that differ between two same-length strings. */
function differences(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) count += 1;
  return count;
}

export interface FindChallengeOptions {
  /**
   * Where the progress reading was found. A "code" recognised inside that box
   * is far more likely to be misread page text than a card held up beside the
   * screen, so it does not count.
   */
  progressRegion?: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Looks for one *known* code in the recognised words.
 *
 * Note the direction: the expected value is known before the photo is taken, so
 * this confirms a specific string rather than harvesting whatever code-like
 * text it can find and comparing afterwards. Matching is exact after
 * normalisation — the restricted alphabet is what makes that affordable, and
 * anything less exact would let OCR noise vote for a pass.
 */
export function findChallengeInWords(
  words: OcrWord[],
  expected: string,
  options: FindChallengeOptions = {},
): ChallengeDetection {
  const target = normalizeChallengeText(expected);
  const miss: ChallengeDetection = {
    matched: false,
    confidence: 0,
    ambiguous: false,
    separated: false,
    problem: 'not_found',
  };
  if (!target) return miss;

  const tokens = collectCodeTokens(words);
  if (tokens.length === 0) return miss;

  const exact = tokens.filter((t) => t.text === target);
  if (exact.length > 0) {
    const region = options.progressRegion;
    // Prefer a match that is clear of the progress reading; only if every match
    // overlaps it does the capture get refused for overlap.
    const clear = region ? exact.filter((t) => !isInside(t, region)) : exact;
    if (clear.length === 0) {
      return {
        matched: false,
        matchedText: target,
        confidence: 0.4,
        ambiguous: false,
        separated: false,
        problem: 'overlaps_progress',
      };
    }
    return { matched: true, matchedText: target, confidence: 1, ambiguous: false, separated: true };
  }

  /* Nothing exact. Was something *nearly* right? */
  const near = tokens.filter((t) => t.text.length === target.length && differences(t.text, target) === 1);
  const distinctNear = new Set(near.map((t) => t.text));

  if (distinctNear.size >= 2) {
    // Two different tokens are each one character off. Picking one would be a
    // guess, and a guess is not evidence.
    return { matched: false, confidence: 0.3, ambiguous: true, separated: false, problem: 'ambiguous' };
  }
  if (distinctNear.size === 1) {
    return {
      matched: false,
      matchedText: [...distinctNear][0],
      confidence: 0.5,
      ambiguous: false,
      separated: false,
      problem: 'low_confidence',
    };
  }
  return miss;
}

function isInside(
  token: { x0: number; y0: number; x1: number; y1: number },
  region: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const centerX = (token.x0 + token.x1) / 2;
  const centerY = (token.y0 + token.y1) / 2;
  return (
    centerX >= region.x0 && centerX <= region.x1 && centerY >= region.y0 && centerY <= region.y1
  );
}

export const CHALLENGE_PROBLEM_ADVICE: Record<
  NonNullable<ChallengeDetection['problem']>,
  string
> = {
  not_found:
    'That verification code wasn’t detected. Make sure it is clearly visible beside the Edgenuity screen.',
  ambiguous:
    'More than one code-like value was detected and none matched clearly. Show only the current code.',
  overlaps_progress:
    'The code is covering the progress information. Move it beside the screen, not over it.',
  low_confidence:
    'The code was almost readable. Write it larger, in dark ink, with the characters separated.',
};
