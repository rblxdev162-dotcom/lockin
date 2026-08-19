/**
 * Course-level pacing, one product at a time.
 *
 * ## Why there is no single formula
 *
 * Classic Edgenuity publishes an *actual* completion percentage beside a
 * *target* one, and the whole point of the pair is that they are meant to be
 * compared. EdgeEX is a different product; applying classic Edgenuity's
 * percentage rule to it would produce a confident answer that nothing backs.
 *
 * So the product is explicit, and the honest fallback is loud:
 *
 *  - **EDGENUITY** with both numbers → compare them, with a small band around
 *    zero so a rounding difference is not reported as being behind.
 *  - **EDGEEX** → LockIn does not know the pacing semantics. It still compares
 *    what it has, but the result is always flagged as LockIn's estimate, never
 *    as the product's own status.
 *  - **UNKNOWN** → same conservative comparison, same flag.
 *
 * `official` is never true unless the source *published* a status. Nothing in
 * this file sets it; the parsers do, when a report literally says "Behind".
 */
import type { CoursePace, PaceStatus } from '../../types/pace';
import type { CourseProgress } from '../../types/integrations';
import { classify, preferSource } from '../sources/freshness';

/**
 * The band, in percentage points, inside which a course counts as on pace.
 *
 * This is LockIn's number, not Edgenuity's. Imagine Learning does not publish
 * a threshold that this project has been able to verify, so rather than
 * dressing a guess up as the vendor's rule, the band is deliberately small,
 * symmetric, and applied identically to every product — and every result it
 * produces is marked as an estimate. If a documented threshold ever turns up,
 * this is the one constant to change.
 */
export const ON_PACE_BAND = 2;

/** More than this far behind is not "slightly behind" any more. */
export const BEHIND_BAND = 5;

/**
 * Turns one stored course into a pace reading.
 *
 * Returns UNKNOWN — rather than guessing — whenever either number is missing
 * or the data behind it has gone stale. A percentage from two weeks ago
 * compared against today's target is not a pace, it is arithmetic on stale
 * inputs.
 */
export function coursePace(course: CourseProgress, now: number): CoursePace {
  const actual = course.actualProgressPercent;
  const target = course.targetProgressPercent;

  // The course's freshness is that of the newest field that matters for pace.
  const paceSource = preferSource(actual?.source, target?.source, now);
  const freshness = classify(paceSource, now);

  const base: CoursePace = {
    courseId: course.id,
    name: course.name,
    product: course.product,
    status: 'UNKNOWN',
    official: false,
    actualPercent: actual?.value,
    targetPercent: target?.value,
    freshness: freshness.label,
    stale: freshness.stale,
  };

  if (actual === undefined || target === undefined) return base;
  if (freshness.stale || freshness.state === 'UNAVAILABLE') return base;

  const delta = round1(actual.value - target.value);
  return { ...base, deltaPercent: delta, status: statusForDelta(delta) };
}

function statusForDelta(delta: number): PaceStatus {
  if (delta >= ON_PACE_BAND) return 'AHEAD';
  if (delta > -ON_PACE_BAND) return 'ON_TRACK';
  if (delta > -BEHIND_BAND) return 'AT_RISK';
  return 'BEHIND';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * One plain sentence about a course's pace.
 *
 * Never scolding, and never a bare number: "4.5% behind" means nothing on its
 * own, so the sentence always says what it is behind *against*.
 */
export function describeCoursePace(pace: CoursePace): string {
  if (pace.status === 'UNKNOWN') {
    return pace.stale
      ? `${pace.name} progress is out of date — updated ${pace.freshness.toLowerCase()}.`
      : `No pacing data for ${pace.name} yet.`;
  }
  const delta = pace.deltaPercent ?? 0;
  const size = Math.abs(delta).toFixed(1).replace(/\.0$/, '');
  switch (pace.status) {
    case 'AHEAD':
      return `${pace.name} is ${size}% ahead of its target pace.`;
    case 'ON_TRACK':
      return `${pace.name} is level with its target pace.`;
    case 'AT_RISK':
      return `${pace.name} is ${size}% behind its target pace.`;
    default:
      return `${pace.name} is ${size}% behind target — worth a session tonight.`;
  }
}
