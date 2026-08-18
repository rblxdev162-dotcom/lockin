/**
 * Deterministic string similarity for OCR output. No AI, no network.
 *
 * OCR of a photographed screen misreads characters constantly
 * (`Physical Scienee`), so course and brand matching has to be character-level
 * and fuzzy. `lib/canvas/matching.ts` already does token-overlap matching for
 * Canvas titles; that is the wrong tool here because a single wrong letter
 * destroys a whole token.
 */

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic Levenshtein distance, two-row variant. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** 1 for identical, 0 for nothing in common. Normalised before comparing. */
export function similarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  const longest = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / longest;
}

/**
 * True when two course names are close enough to be the same course.
 *
 * `Physical Science Semester A` vs `Physical Scienee Semester A` must match;
 * `Science` vs `Math` must not. The threshold is deliberately generous —
 * refusing a genuine match only costs the student a retake, while the
 * *mismatch* case (proving Math progress against a Science requirement) is
 * what actually needs catching.
 */
export function isSameCourse(a: string | undefined, b: string | undefined, threshold = 0.7): boolean {
  if (!a || !b) return true; // Nothing to contradict — handled by the caller.
  const direct = similarity(a, b);
  if (direct >= threshold) return true;
  // One photo may crop the course name shorter than the other
  // ("Physical Science" vs "Physical Science Semester A").
  const x = normalizeText(a);
  const y = normalizeText(b);
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  if (shorter.length >= 6 && longer.startsWith(shorter)) return true;
  return false;
}

/**
 * True when two activity labels are the same activity.
 *
 * Deliberately *not* `isSameCourse`: `Lesson 4` and `Lesson 5` differ by one
 * character out of eight, so character similarity calls them the same thing
 * while they are in fact the whole point of activity counting. Numbers are
 * therefore compared first and exactly.
 */
export function isSameActivity(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const numbersA = normalizeText(a).match(/\d+/g)?.join('.') ?? '';
  const numbersB = normalizeText(b).match(/\d+/g)?.join('.') ?? '';
  if (numbersA !== numbersB) return false;
  return similarity(a, b) >= 0.85;
}

/** Does any token in `text` look like `word`, allowing for OCR slips? */
export function containsFuzzyWord(text: string, word: string, threshold = 0.8): boolean {
  const target = normalizeText(word);
  if (!target) return false;
  const normalized = normalizeText(text);
  if (normalized.includes(target)) return true;

  const targetWords = target.split(' ');
  const words = normalized.split(' ');
  // Slide a window the size of the target phrase across the text.
  for (let i = 0; i + targetWords.length <= words.length; i += 1) {
    const window = words.slice(i, i + targetWords.length).join(' ');
    if (similarity(window, target) >= threshold) return true;
  }
  return false;
}
