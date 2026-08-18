/**
 * Turning OCR text into a structured Edgenuity reading — pure, no DOM, no
 * React, no network. This is the Edgenuity counterpart of
 * `lib/canvas/pageProvider.ts`'s parsing, and it is tested the same way: on
 * fixed inputs with known answers.
 *
 * Two problems dominate here and shape everything below.
 *
 * 1. A photo of any web page can contain `47%`. A number alone is not evidence,
 *    so a reading is only accepted when several independent signals say the
 *    screen is an Edgenuity-like course page.
 * 2. An Edgenuity page shows several percentages at once — overall grade,
 *    relative grade, course progress. Taking the first one would silently
 *    verify against the wrong number, so every percentage is scored by the
 *    words around it and ties are reported as ambiguous rather than guessed.
 */
import type {
  EdgenuityOcrResult,
  OcrWord,
  ParseConfidence,
  PercentCandidate,
  ScreenEvidence,
} from '../../types/edgenuity';
import { containsFuzzyWord, normalizeText } from './similarity';

/* ------------------------------------------------------------------ */
/* Screen recognition                                                  */
/* ------------------------------------------------------------------ */

/**
 * Signals that a screen is an Edgenuity-style course page.
 *
 * Deliberately not a single brand string: the product is sold as Edgenuity and
 * as Imagine Learning, districts rebrand the header, and OCR mangles logos.
 * Branding is the strongest signal but never the only one — a rebranded
 * deployment still shows course/lesson/progress structure.
 */
const SCREEN_SIGNALS: { id: string; words: string[]; weight: number }[] = [
  // Branding is weighted to exactly clear MIN_SCREEN_SCORE on its own.
  { id: 'edgenuity', words: ['edgenuity'], weight: 0.5 },
  { id: 'imagine_learning', words: ['imagine learning', 'imaginelearning'], weight: 0.5 },
  { id: 'course_progress', words: ['course progress', 'progress'], weight: 0.22 },
  { id: 'course', words: ['course', 'semester'], weight: 0.14 },
  {
    id: 'activity',
    words: ['activity', 'lesson', 'unit', 'assignment', 'quiz', 'test', 'assessment'],
    weight: 0.14,
  },
  {
    id: 'coursework',
    words: ['warm up', 'instruction', 'summary', 'vocabulary', 'my courses', 'student'],
    weight: 0.1,
  },
  { id: 'completion', words: ['complete', 'completed', 'completion'], weight: 0.1 },
];

/** Signal ids that on their own indicate the actual product. */
const BRAND_SIGNALS = new Set(['edgenuity', 'imagine_learning']);

/** Below this, the photo is not treated as an Edgenuity screen at all. */
export const MIN_SCREEN_SCORE = 0.5;

export function detectScreenSignals(text: string): { signals: string[]; score: number } {
  const signals: string[] = [];
  let score = 0;
  for (const signal of SCREEN_SIGNALS) {
    if (signal.words.some((word) => containsFuzzyWord(text, word))) {
      signals.push(signal.id);
      score += signal.weight;
    }
  }
  return { signals, score: Math.min(1, score) };
}

/**
 * Branding alone, or structure + progress language together, is enough.
 * A page that merely says "progress" once is not.
 */
export function looksLikeEdgenuity(signals: string[], score: number): boolean {
  if (score < MIN_SCREEN_SCORE) return false;
  if (signals.some((s) => BRAND_SIGNALS.has(s))) return true;
  const structural = signals.includes('course') || signals.includes('activity');
  const progressish = signals.includes('course_progress') || signals.includes('completion');
  return structural && progressish;
}

/* ------------------------------------------------------------------ */
/* Percentage extraction                                               */
/* ------------------------------------------------------------------ */

/**
 * Words that make a nearby number *more* likely to be course progress, and
 * words that make it almost certainly something else. Grades are the dangerous
 * case: an Edgenuity page shows "Overall Grade 92%" right next to progress.
 */
const PROGRESS_TERMS: { phrase: string; weight: number }[] = [
  // `Course Progress` is the label Edgenuity puts on the number that matters,
  // so it has to out-score a bare `Progress` by more than the tie margin —
  // otherwise a page showing both course and unit progress (most of them) would
  // always be reported ambiguous and the feature would never verify anything.
  { phrase: 'course progress', weight: 0.6 },
  { phrase: 'progress', weight: 0.35 },
  { phrase: 'completed', weight: 0.3 },
  { phrase: 'complete', weight: 0.28 },
  { phrase: 'completion', weight: 0.3 },
  { phrase: 'course completion', weight: 0.6 },
];

const NON_PROGRESS_TERMS = [
  'overall grade',
  'relative grade',
  'actual grade',
  'grade',
  'score',
  'average',
  'attendance',
  'target',
  'goal',
];

/**
 * OCR confusions that are safe to undo *only* when the surrounding text has
 * already established that the token is a percentage. Applying these broadly
 * would invent progress out of ordinary words.
 */
const DIGIT_CONFUSIONS: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  I: '1',
  l: '1',
  '|': '1',
  Z: '2',
  z: '2',
  S: '5',
  s: '5',
  b: '6',
  G: '6',
  T: '7',
  B: '8',
  g: '9',
  q: '9',
};

/** `4B%` -> `48%`, but only for tokens already known to be a percentage. */
export function repairDigits(token: string): string | null {
  let out = '';
  for (const ch of token) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (DIGIT_CONFUSIONS[ch]) out += DIGIT_CONFUSIONS[ch];
    else return null;
  }
  return out.length > 0 && out.length <= 3 ? out : null;
}

/** Percentages are 0..100. Anything else is a misread, not a value. */
export function isValidPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function scoreContext(line: string, above: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  for (const term of PROGRESS_TERMS) {
    if (containsFuzzyWord(line, term.phrase)) {
      score = Math.max(score, term.weight);
      reasons.push(term.phrase);
      break;
    }
  }

  // Edgenuity stacks the label above its value; give the label line a smaller
  // share of the credit.
  if (score === 0 && above) {
    for (const term of PROGRESS_TERMS) {
      if (containsFuzzyWord(above, term.phrase)) {
        score = Math.max(score, term.weight * 0.6);
        reasons.push(`${term.phrase} (line above)`);
        break;
      }
    }
  }

  for (const bad of NON_PROGRESS_TERMS) {
    if (containsFuzzyWord(line, bad)) {
      // A grade percentage must not be able to out-score a progress one even
      // when the same line mentions both.
      score -= 0.7;
      reasons.push(`not progress: ${bad}`);
      break;
    }
  }

  return { score, reasons };
}

/**
 * The nearest line above that could actually be a label.
 *
 * Real OCR of a progress screen puts junk between the label and its value —
 * blank lines, and the progress *bar* recognised as something like `[v)`. So
 * this looks back a few lines and skips anything with no real words in it,
 * rather than only checking the line immediately above.
 */
function labelLineAbove(lines: string[], index: number, lookBack = 3): string {
  for (let i = index - 1; i >= 0 && i >= index - lookBack; i -= 1) {
    const candidate = lines[i];
    if (/[a-z]{3}/i.test(candidate)) return candidate;
  }
  return '';
}

/**
 * Every plausible percentage in the text, scored by its surrounding words and
 * sorted best first. A bare `43` with no percent sign only counts when a
 * progress word introduces it — otherwise page numbers and dates would qualify.
 */
export function extractPercentCandidates(text: string): PercentCandidate[] {
  const lines = text.split(/\r?\n/);
  const candidates: PercentCandidate[] = [];

  lines.forEach((line, index) => {
    const context = scoreContext(line, labelLineAbove(lines, index));
    const seen = new Set<number>();

    const push = (value: number, bonus: number) => {
      if (!isValidPercent(value) || seen.has(value)) return;
      seen.add(value);
      candidates.push({
        value,
        score: Math.max(0, Math.min(1, context.score + bonus)),
        reasons: [...context.reasons],
        context: line.trim().slice(0, 120),
      });
    };

    // 1. Anything ending in `%`, including OCR-mangled digits (`4B %`).
    for (const match of line.matchAll(/([0-9OoDQIlZzSsbGTBgq|]{1,3})\s*%/g)) {
      const repaired = repairDigits(match[1]);
      if (repaired === null) continue;
      push(Number(repaired), 0.15);
    }

    // 2. `Course Progress: 43` — a number with no percent sign is only a
    //    percentage when a progress word introduces it on this line.
    if (context.score > 0) {
      for (const match of line.matchAll(
        // `(?![\w%])` stops this rule from biting a chunk out of an
        // OCR-mangled percentage: `4B%` must be read as 48 by the rule above,
        // never as a bare 4 here.
        /(?:progress|complete|completed|completion)[^0-9%\n]{0,12}(\d{1,3})(?![\w%])(?!\s*%)(?!\s*\d)/gi,
      )) {
        push(Number(match[1]), 0);
      }
    }
  });

  return candidates.sort((a, b) => b.score - a.score || b.value - a.value);
}

/* ------------------------------------------------------------------ */
/* Spatial extraction — the fix for two-column layouts                 */
/* ------------------------------------------------------------------ */

/**
 * Word-position-aware extraction.
 *
 * An Edgenuity course page puts Course Progress on the left and the grades on
 * the right, which OCR flattens to `Course Progress Overall Grade` above
 * `43% 92%`. From the text alone the two pairings are indistinguishable; from
 * the boxes they are obvious, because `43%` starts at the same x as
 * `Course Progress` and `92%` at the same x as `Overall Grade`.
 *
 * So each percentage collects the words *physically near it* — same row to the
 * left, or directly above — and that little cluster is scored with exactly the
 * same rules the text path uses.
 */
export function extractPercentCandidatesFromWords(words: OcrWord[]): PercentCandidate[] {
  const usable = words.filter((w) => w.text.trim().length > 0 && w.y1 > w.y0);
  if (usable.length === 0) return [];

  const heights = usable.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const lineHeight = heights[Math.floor(heights.length / 2)] || 20;

  const candidates: PercentCandidate[] = [];

  for (const word of usable) {
    const match = word.text.match(/^([0-9OoDQIlZzSsbGTBgq|]{1,3})\s*%$/);
    if (!match) continue;
    const repaired = repairDigits(match[1]);
    if (repaired === null) continue;
    const value = Number(repaired);
    if (!isValidPercent(value)) continue;

    const centerY = (word.y0 + word.y1) / 2;
    const sameRow: OcrWord[] = [];
    const above: OcrWord[] = [];

    for (const other of usable) {
      if (other === word) continue;
      const otherCenterY = (other.y0 + other.y1) / 2;

      const isSameRow =
        Math.abs(otherCenterY - centerY) < lineHeight * 0.7 &&
        other.x1 <= word.x1 &&
        word.x0 - other.x1 < lineHeight * 8;
      if (isSameRow) {
        sameRow.push(other);
        continue;
      }

      // Directly above: within a couple of lines, and in the same column. The
      // column test is generous — a label and its value are often indented
      // differently — but nowhere near generous enough to reach the grades on
      // the far side of the page, which is the pairing that must not happen.
      const gap = word.y0 - other.y1;
      const alignedLeft = Math.abs(other.x0 - word.x0) < lineHeight * 6;
      const overlaps = other.x0 < word.x1 && other.x1 > word.x0;
      if (gap >= -lineHeight * 0.3 && gap < lineHeight * 3 && (alignedLeft || overlaps)) {
        above.push(other);
      }
    }

    const inReadingOrder = (list: OcrWord[]) =>
      [...list].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((w) => w.text).join(' ');

    const rowText = inReadingOrder(sameRow);
    const aboveText = inReadingOrder(above);
    const context = scoreContext(rowText, aboveText);

    // The region is the value plus the label that earned it — the area a
    // challenge code must stay clear of (Phase 5).
    const region = [word, ...above].reduce(
      (box, w) => ({
        x0: Math.min(box.x0, w.x0),
        y0: Math.min(box.y0, w.y0),
        x1: Math.max(box.x1, w.x1),
        y1: Math.max(box.y1, w.y1),
      }),
      { x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 },
    );

    candidates.push({
      value,
      score: Math.max(0, Math.min(1, context.score + 0.15)),
      reasons: context.reasons,
      context: `${aboveText} ${rowText}`.trim().slice(0, 120),
      box: region,
    });
  }

  // Two readings of the same value (a wrapped label, say) are one candidate.
  const byValue = new Map<number, PercentCandidate>();
  for (const candidate of candidates) {
    const existing = byValue.get(candidate.value);
    if (!existing || candidate.score > existing.score) byValue.set(candidate.value, candidate);
  }

  return [...byValue.values()].sort((a, b) => b.score - a.score || b.value - a.value);
}

/** Score below which no candidate is trusted as *course progress*. */
export const MIN_PERCENT_SCORE = 0.25;
/** Two candidates this close together are a tie, not a winner. */
const TIE_MARGIN = 0.15;

export interface PercentChoice {
  value?: number;
  ambiguous: boolean;
  candidates: PercentCandidate[];
}

/**
 * Picks the course-progress percentage, or refuses.
 *
 * Refusing is the safe outcome: the student retakes the photo closer to the
 * progress area, which costs seconds. Guessing would verify against a grade.
 */
export function chooseProgressPercent(candidates: PercentCandidate[]): PercentChoice {
  const usable = candidates.filter((c) => c.score >= MIN_PERCENT_SCORE);
  if (usable.length === 0) return { ambiguous: false, candidates };

  const best = usable[0];
  // The epsilon keeps a hand-computed margin (0.75 - 0.60) from landing on the
  // wrong side of the comparison through float error.
  const rivals = usable.filter(
    (c) => c.value !== best.value && best.score - c.score <= TIE_MARGIN + 1e-9,
  );
  if (rivals.length > 0) return { ambiguous: true, candidates };

  return { value: best.value, ambiguous: false, candidates };
}

/* ------------------------------------------------------------------ */
/* Course and activity names                                           */
/* ------------------------------------------------------------------ */

function cleanName(value: string): string {
  return value
    .replace(/\s*[:|\-–]\s*$/, '')
    .replace(/\b\d{1,3}\s*%/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

const COURSE_NOISE = /^(course|courses|my courses|home|dashboard|student|menu)$/i;

/** `Course: Physical Science Semester A`, or a line that names a semester. */
export function extractCourseName(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const labelled = line.match(/^course\s*[:\-–]\s*(.{3,})$/i);
    if (labelled) {
      const name = cleanName(labelled[1]);
      if (name && !COURSE_NOISE.test(name)) return name;
    }
  }

  // Unlabelled: a title line mentioning a semester is how Edgenuity names most
  // courses (`Physical Science Semester A`).
  for (const line of lines) {
    if (/semester\s*[ab12]/i.test(line)) {
      const name = cleanName(line);
      if (name.length >= 4 && !COURSE_NOISE.test(name)) return name;
    }
  }

  // Fall back to the line directly under a bare `Course` label.
  const index = lines.findIndex((l) => /^course$/i.test(l.trim()));
  if (index >= 0 && lines[index + 1]) {
    const name = cleanName(lines[index + 1]);
    if (name.length >= 3 && !COURSE_NOISE.test(name)) return name;
  }

  return undefined;
}

/** `Lesson 4`, `Activity: Cell Structure`, `Quiz 2`. */
export function extractActivityName(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const labelled = line.match(
      /\b(activity|lesson|unit|quiz|test|assignment)\s*[:#\-–]?\s*([\w][\w\s.'&-]{0,58})/i,
    );
    if (!labelled) continue;
    const name = cleanName(`${labelled[1]} ${labelled[2]}`);
    if (name.length >= 4) return name;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Whole-reading entry point                                           */
/* ------------------------------------------------------------------ */

function gradeConfidence(
  screenScore: number,
  percentScore: number,
  engineConfidence: number | undefined,
): ParseConfidence {
  const engine = engineConfidence ?? 60;
  if (screenScore >= 0.7 && percentScore >= 0.55 && engine >= 55) return 'high';
  if (screenScore >= MIN_SCREEN_SCORE && percentScore >= MIN_PERCENT_SCORE && engine >= 35) {
    return 'medium';
  }
  return 'low';
}

export interface ParseOptions {
  /** Mean character confidence from the OCR engine, 0..100. */
  confidence?: number;
  /**
   * Recognised words with their positions. Strongly preferred: without them a
   * two-column page cannot be read reliably. Falls back to line-based scoring
   * when the engine gives text only.
   */
  words?: OcrWord[];
  /**
   * `session_progress` targets do not need a percentage at all — the proof only
   * has to show the same course before and after. Missing percentages are then
   * not a failure.
   */
  requirePercent?: boolean;
  /** Keep `rawText` on the result. Developer mode only; never persisted. */
  keepRawText?: boolean;
}

/**
 * The single entry point: OCR text in, structured reading out.
 *
 * The order of the refusals matters. "This isn't an Edgenuity screen" is a very
 * different retake instruction from "I can see two progress numbers", and the
 * student is told which one applies.
 */
export function parseEdgenuityText(
  rawText: string,
  options: ParseOptions = {},
): EdgenuityOcrResult {
  const text = rawText ?? '';
  const { signals, score: screenScore } = detectScreenSignals(text);
  const spatial = options.words?.length ? extractPercentCandidatesFromWords(options.words) : [];
  // Positions win when they found anything; the text scan is the fallback.
  const candidates = spatial.length > 0 ? spatial : extractPercentCandidates(text);
  const choice = chooseProgressPercent(candidates);
  const requirePercent = options.requirePercent !== false;

  const base: EdgenuityOcrResult = {
    rawText: options.keepRawText ? text.slice(0, 4000) : undefined,
    confidence: options.confidence,
    detectedCourse: extractCourseName(text),
    detectedActivity: extractActivityName(text),
    detectedProgressPercent: choice.value,
    percentCandidates: candidates.slice(0, 8),
    edgenuitySignals: signals,
    screenScore,
    progressRegion: candidates.find((c) => c.value === choice.value)?.box,
    parseConfidence: 'low',
  };

  // Almost nothing came back: a dark, blurred or badly framed photo.
  if (normalizeText(text).length < 12) {
    return { ...base, problem: 'unreadable' };
  }

  if (!looksLikeEdgenuity(signals, screenScore)) {
    return { ...base, problem: 'not_edgenuity' };
  }

  if (choice.ambiguous) {
    return { ...base, detectedProgressPercent: undefined, problem: 'ambiguous_percentage' };
  }

  if (choice.value === undefined) {
    return {
      ...base,
      // A same-course screen with no readable percentage is still usable proof
      // for the Focus + Screen Proof target type.
      problem: requirePercent ? 'no_percentage' : undefined,
      parseConfidence: requirePercent
        ? 'low'
        : gradeConfidence(screenScore, MIN_PERCENT_SCORE, options.confidence),
    };
  }

  const bestScore = candidates.find((c) => c.value === choice.value)?.score ?? 0;
  return {
    ...base,
    parseConfidence: gradeConfidence(screenScore, bestScore, options.confidence),
  };
}

/* ------------------------------------------------------------------ */
/* Screen evidence (Phase 5)                                           */
/* ------------------------------------------------------------------ */

/**
 * Enhanced Proof needs more than "this passed the Standard bar".
 *
 * Standard asks a yes/no question — does this look like Edgenuity at all. This
 * turns the same signals into a score, so a stronger claim can demand stronger
 * evidence without inventing a second recogniser.
 *
 * It stays signal-based on purpose. Districts rebrand Edgenuity and the product
 * is also sold as Imagine Learning; a rule that demanded one exact layout would
 * reject most real deployments while doing nothing to stop a convincing fake.
 */
export const MIN_ENHANCED_SCREEN_SCORE = 0.7;
export const MIN_ENHANCED_SIGNALS = 3;

export function screenEvidenceFrom(result: EdgenuityOcrResult): ScreenEvidence {
  const signals = [...result.edgenuitySignals];
  let score = result.screenScore;

  // A percentage that actually scored as *course progress* is corroboration
  // that this is a progress page, not merely a page mentioning a course.
  const best = result.percentCandidates[0];
  if (result.detectedProgressPercent !== undefined && (best?.score ?? 0) >= 0.5) {
    signals.push('scored_progress_value');
    score += 0.1;
  }
  if (result.detectedCourse) {
    signals.push('course_title');
    score += 0.05;
  }

  const bounded = Math.max(0, Math.min(1, score));
  const confidence: ParseConfidence =
    bounded >= MIN_ENHANCED_SCREEN_SCORE && signals.length >= MIN_ENHANCED_SIGNALS
      ? 'high'
      : bounded >= MIN_SCREEN_SCORE
        ? 'medium'
        : 'low';

  return { score: bounded, signals, confidence };
}

/** The bar Enhanced Proof asks a frame to clear. */
export function meetsEnhancedScreenBar(evidence: ScreenEvidence): boolean {
  return (
    evidence.confidence === 'high' &&
    evidence.score >= MIN_ENHANCED_SCREEN_SCORE &&
    evidence.signals.length >= MIN_ENHANCED_SIGNALS
  );
}

/**
 * Structured, tiny fingerprint of a screen, for comparing two captures.
 *
 * Deliberately built from values already extracted — no pixels, no hashes of
 * images, nothing that could reconstruct the photo. It exists so before/after
 * can be checked for being the same *kind* of screen, not the same image.
 */
export function screenFingerprint(result: EdgenuityOcrResult): string {
  const course = normalizeText(result.detectedCourse ?? '');
  const labels = [...new Set(result.edgenuitySignals)].sort().join(',');
  const hasPercent = result.detectedProgressPercent !== undefined ? 'p' : '-';
  return `${course}|${labels}|${hasPercent}`;
}

/**
 * Strips everything that should not outlive processing.
 *
 * A photo of a school screen can carry other students' names, grades and
 * schedules. Only the handful of fields verification actually needs survives,
 * and raw OCR text never reaches storage.
 */
export function redactOcrResult(result: EdgenuityOcrResult): EdgenuityOcrResult {
  const { rawText: _rawText, ...rest } = result;
  return { ...rest, percentCandidates: [] };
}
