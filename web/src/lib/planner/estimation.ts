/**
 * Learning how long work actually takes.
 *
 * Statistics, not machine learning: a median of ratios, a minimum sample
 * count, and hard clamps at both ends. No library, no model, no training.
 *
 * Two rules do most of the work here. A single bad session must not move
 * anything (one abandoned timer would otherwise teach LockIn that Math takes
 * eight times as long), and nothing is applied to the student's own numbers
 * until they say so.
 */
import type { Assignment } from '../../types';

/** Below this many finished assignments, a subject is simply not measured. */
export const MIN_SAMPLES = 3;
/** A single sample outside this range is pulled back before it is counted. */
export const SAMPLE_CLAMP_MIN = 0.25;
export const SAMPLE_CLAMP_MAX = 4;
/** The strongest adjustment the planner will ever apply. */
export const FACTOR_MIN = 0.5;
export const FACTOR_MAX = 2;
/** Factors closer to 1 than this are noise and are not worth suggesting. */
export const SUGGESTION_THRESHOLD = 0.1;

export interface SubjectFactor {
  subject: string;
  factor: number;
  samples: number;
  /** True when the factor is far enough from 1 to be worth mentioning. */
  notable: boolean;
}

export function normaliseSubject(subject: string): string {
  return subject.trim().toLowerCase();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Speed factors per subject, from completed assignments only.
 *
 * Unfinished work is excluded on purpose: an assignment with 10 of 60 minutes
 * logged is not evidence that it takes a sixth as long, it is evidence that it
 * is not done.
 */
export function subjectFactors(assignments: Assignment[]): Map<string, SubjectFactor> {
  const buckets = new Map<string, { subject: string; ratios: number[] }>();

  for (const a of assignments) {
    if (a.status !== 'Completed') continue;
    if (!(a.estimatedMinutes > 0) || !(a.loggedMinutes > 0)) continue;
    const key = normaliseSubject(a.subject);
    if (!key) continue;
    const ratio = Math.min(
      SAMPLE_CLAMP_MAX,
      Math.max(SAMPLE_CLAMP_MIN, a.loggedMinutes / a.estimatedMinutes),
    );
    const bucket = buckets.get(key) ?? { subject: a.subject.trim(), ratios: [] };
    bucket.ratios.push(ratio);
    buckets.set(key, bucket);
  }

  const factors = new Map<string, SubjectFactor>();
  for (const [key, bucket] of buckets) {
    if (bucket.ratios.length < MIN_SAMPLES) continue;
    const raw = median(bucket.ratios);
    const factor =
      Math.round(Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, raw)) * 100) / 100;
    factors.set(key, {
      subject: bucket.subject,
      factor,
      samples: bucket.ratios.length,
      notable: Math.abs(factor - 1) >= SUGGESTION_THRESHOLD,
    });
  }
  return factors;
}

/**
 * The factor to actually schedule with.
 *
 * Opting in is either global (`useAdjustedEstimates`) or per subject — a
 * student who agrees that Math runs long is not thereby agreeing to have every
 * other subject rewritten.
 */
export function effectiveFactor(
  subject: string,
  factors: Map<string, SubjectFactor>,
  options: { useAdjustedEstimates: boolean; accepted: string[] },
): number {
  const key = normaliseSubject(subject);
  const entry = factors.get(key);
  if (!entry) return 1;
  const accepted = options.accepted.some((s) => normaliseSubject(s) === key);
  return options.useAdjustedEstimates || accepted ? entry.factor : 1;
}

/** Subjects worth offering as "use adjusted estimates?" — never applied alone. */
export function factorSuggestions(
  factors: Map<string, SubjectFactor>,
  accepted: string[],
): SubjectFactor[] {
  const seen = new Set(accepted.map(normaliseSubject));
  return [...factors.entries()]
    .filter(([key, f]) => f.notable && !seen.has(key))
    .map(([, f]) => f)
    .sort((a, b) => Math.abs(b.factor - 1) - Math.abs(a.factor - 1) || a.subject.localeCompare(b.subject));
}
