/**
 * Capture → preprocess → OCR → parse, in one place.
 *
 * Kept separate from `ocr.ts` (engine plumbing) and `parser.ts` (pure text
 * analysis) so the interesting decision — *how many passes are worth running
 * before giving up on a photo* — lives somewhere it can be reasoned about.
 *
 * The rule: stop at the first pass that reads confidently. A clear photo costs
 * one pass; a difficult one costs at most `maxPasses`. Twenty passes would be
 * slower than retaking the photo and no more accurate.
 */
import type {
  ChallengeDetection,
  EdgenuityOcrResult,
  EdgenuityProof,
  ScreenEvidence,
} from '../../types/edgenuity';
import type { CapturedImage } from './capture';
import type { OcrProgress } from './ocr';
import type { QualityReport } from './preprocess';
import { recognizeCanvas } from './ocr';
import { parseEdgenuityText, screenEvidenceFrom } from './parser';
import { findChallengeInWords } from './challenge';
import {
  QUALITY_ADVICE,
  assessQuality,
  buildVariants,
  releaseVariants,
  toThumbnail,
} from './preprocess';

export interface ReadProofOptions {
  /** False for Focus + Screen Proof, which does not need a percentage. */
  requirePercent?: boolean;
  /** Developer mode only. Raw text is never persisted regardless. */
  keepRawText?: boolean;
  /** Produce a small thumbnail for the active session's review screen. */
  wantThumbnail?: boolean;
  onProgress?: (progress: OcrProgress) => void;
  signal?: AbortSignal;
  maxPasses?: number;
  /**
   * The code that must appear in this frame (Enhanced Proof).
   *
   * Passed *in* rather than discovered: the expected value is known before the
   * shutter, so the detector confirms one string instead of harvesting codes
   * and comparing afterwards.
   */
  expectedChallenge?: string;
}

export interface PassReport {
  variant: string;
  confidence: number;
  problem?: string;
  percent?: number;
  challengeMatched?: boolean;
}

export interface ProofReading {
  result: EdgenuityOcrResult;
  /** How convincingly this frame looked like an Edgenuity page (Phase 5). */
  screenEvidence: ScreenEvidence;
  /** Present only when a challenge was expected. */
  challenge?: ChallengeDetection;
  quality: QualityReport;
  /** What each attempted pass produced. Diagnostics; never persisted. */
  passes: PassReport[];
  /** Present only when asked for; session-scoped and never uploaded. */
  thumbnail?: string;
  /** Set when the image was rejected before OCR ran. */
  qualityAdvice?: string;
}

/** Higher is better. Used to keep the best pass when none is confident. */
function rank(result: EdgenuityOcrResult, challenge?: ChallengeDetection): number {
  const confidence = { high: 2, medium: 1, low: 0 }[result.parseConfidence];
  const usable = result.problem ? 0 : 1;
  // `not_edgenuity` is the least useful outcome — a pass that at least found an
  // Edgenuity-looking screen is a better basis for the retake message.
  const recognised = result.problem === 'not_edgenuity' ? 0 : 1;
  // A pass that found the code is worth more than one that only read the
  // progress: without the code the capture cannot reach Enhanced trust anyway.
  const codeFound = challenge?.matched ? 40 : 0;
  return (
    usable * 100 + codeFound + recognised * 20 + confidence * 5 + (result.confidence ?? 0) / 100
  );
}

/**
 * Whether to stop early.
 *
 * When a code is expected, a pass that read the progress but missed the code is
 * *not* good enough — a higher-contrast variant often picks up hand-written
 * characters the first pass loses, and stopping early would fail the student
 * for a pass we hadn't tried yet.
 */
function isGoodEnough(result: EdgenuityOcrResult, challenge?: ChallengeDetection): boolean {
  if (result.problem || result.parseConfidence === 'low') return false;
  return challenge === undefined || challenge.matched;
}

/**
 * Reads one captured frame.
 *
 * Quality is checked first because it is nearly free and a lens-cap photo would
 * otherwise cost several seconds of wasm before failing anyway.
 */
export async function readProofImage(
  image: CapturedImage,
  options: ReadProofOptions = {},
): Promise<ProofReading> {
  const { onProgress, signal } = options;
  const maxPasses = Math.max(1, Math.min(4, options.maxPasses ?? 3));

  onProgress?.({ stage: 'preparing_image' });
  const quality = assessQuality(image.canvas);
  const thumbnail = options.wantThumbnail ? toThumbnail(image.canvas) : undefined;

  if (!quality.ok && quality.problem) {
    return {
      quality,
      thumbnail,
      passes: [],
      qualityAdvice: QUALITY_ADVICE[quality.problem],
      result: {
        percentCandidates: [],
        edgenuitySignals: [],
        screenScore: 0,
        parseConfidence: 'low',
        problem: 'unreadable',
      },
      // An unusable frame is evidence of nothing, at either trust level.
      screenEvidence: { score: 0, signals: [], confidence: 'low' },
    };
  }

  const variants = buildVariants(image.canvas);
  const passes: PassReport[] = [];
  let best: EdgenuityOcrResult | null = null;
  let bestChallenge: ChallengeDetection | undefined;

  try {
    for (const variant of variants.slice(0, maxPasses)) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

      const { text, confidence, words } = await recognizeCanvas(variant.canvas, {
        onProgress,
        signal,
      });
      onProgress?.({ stage: 'finding_progress' });

      const parsed = parseEdgenuityText(text, {
        confidence,
        words,
        requirePercent: options.requirePercent,
        keepRawText: options.keepRawText,
      });
      // The code is looked for in the same recognised words, so Enhanced Proof
      // costs no extra OCR pass — just a scan of tokens already in hand.
      const challenge = options.expectedChallenge
        ? findChallengeInWords(words, options.expectedChallenge, {
            progressRegion: parsed.progressRegion,
          })
        : undefined;

      passes.push({
        variant: variant.name,
        confidence,
        problem: parsed.problem,
        percent: parsed.detectedProgressPercent,
        challengeMatched: challenge?.matched,
      });

      if (!best || rank(parsed, challenge) > rank(best, bestChallenge)) {
        best = parsed;
        bestChallenge = challenge;
      }
      if (isGoodEnough(parsed, options.expectedChallenge ? challenge : undefined)) break;
    }
  } finally {
    releaseVariants(variants);
  }

  const result = best ?? {
    percentCandidates: [],
    edgenuitySignals: [],
    screenScore: 0,
    parseConfidence: 'low' as const,
    problem: 'unreadable' as const,
  };

  return {
    quality,
    thumbnail,
    passes,
    result,
    screenEvidence: screenEvidenceFrom(result),
    challenge: bestChallenge,
  };
}

/**
 * The only thing that survives a capture.
 *
 * The canvas, the variants and the raw OCR text are all gone by the time this
 * returns — a proof is four small fields and a timestamp.
 */
export function proofFromReading(
  reading: ProofReading,
  source: CapturedImage['source'],
  capturedAt = new Date().toISOString(),
): EdgenuityProof {
  return {
    capturedAt,
    progressPercent: reading.result.detectedProgressPercent,
    courseName: reading.result.detectedCourse,
    activityName: reading.result.detectedActivity,
    confidence: reading.result.confidence,
    parseConfidence: reading.result.parseConfidence,
    source,
    screenEvidence: reading.screenEvidence,
    challenge: reading.challenge,
  };
}

/** Student-facing explanation of why a reading could not be used. */
export const READ_PROBLEM_ADVICE: Record<string, string> = {
  not_edgenuity:
    'We couldn’t confidently recognise this as an Edgenuity progress screen. Show more of the page, including the course name.',
  no_percentage:
    'We couldn’t find a course-progress percentage. Move closer so the progress number is larger and clearly visible.',
  ambiguous_percentage:
    'Multiple progress values were detected. Please retake a closer photo showing the Course Progress area.',
  unreadable:
    'We couldn’t read the progress clearly. Try moving closer, reducing glare, and holding the camera steady.',
};
