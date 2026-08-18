/**
 * Assignment capture: one field, everything else inferred.
 *
 * The old form asked for title, subject, platform, due date, due time, estimate
 * and priority — seven-plus fields, every time, for something a student can say
 * in six words. Baymard's form research puts 7+ fields at a 67.8% abandonment
 * rate, with each extra field costing about 4.1%; "field reduction returns more
 * lift than visual redesign". An app you cannot be bothered to feed plans
 * nothing.
 *
 * So capture asks for exactly one thing — what the work is — and parses anything
 * else the student happens to type. Three rules keep that honest:
 *
 *  1. **Show what was understood, in the input, as it is typed.** Todoist
 *     highlights the parsed spans live, which is why its parser is trusted
 *     rather than feared. `spans` below exists for that.
 *  2. **Never invent a due date.** Undated work is real work; it sorts last and
 *     is never hidden. Todoist and Apple Reminders both keep undated tasks;
 *     Google Tasks requires a date and is the one people avoid for that reason.
 *  3. **Never ask for the estimate.** Motion requires duration + date + time and
 *     is the app people call exhausting. Sunsama never asks: it falls back to a
 *     default and *learns* from what you actually spend. LockIn already logs
 *     real minutes per assignment, so it can do the same — see `estimateFor`.
 *
 * Everything here is pure and takes `now` as an input, so tests can sit on a
 * Wednesday without waiting for one.
 *
 * See `docs/research/2026-08-task-capture-ux.md`.
 */
import type { Assignment, CompletedSession, Platform, Priority } from '../types';
import { addDaysISO, todayISO } from './time';

/** A stretch of the raw input that the parser claimed, for highlighting. */
export interface ParsedSpan {
  start: number;
  end: number;
  kind: 'date' | 'time' | 'duration' | 'priority' | 'platform';
  /** What it was understood as, e.g. "Fri 5 Sep". */
  label: string;
}

export interface QuickAddResult {
  title: string;
  /** ISO `YYYY-MM-DD`, or '' when nothing dated was said. */
  dueDate: string;
  dueTime: string;
  estimatedMinutes: number;
  /** True when the estimate was inferred rather than stated. */
  estimateInferred: boolean;
  /**
   * Where the estimate came from. The UI says this out loud, so it has to be
   * accurate — telling a student "guessed from your Science work" when they
   * have never finished a Science assignment is a small lie that costs trust
   * in every other number the app shows.
   */
  estimateSource: 'stated' | 'learned' | 'keyword' | 'default';
  subject: string;
  platform: Platform;
  priority: Priority;
  spans: ParsedSpan[];
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

const WEEKDAYS = [
  ['sunday', 'sun'],
  ['monday', 'mon'],
  ['tuesday', 'tue', 'tues'],
  ['wednesday', 'wed', 'weds'],
  ['thursday', 'thu', 'thur', 'thurs'],
  ['friday', 'fri'],
  ['saturday', 'sat'],
];

const MONTHS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];

/**
 * Subjects LockIn can name from a word in the title.
 *
 * Deliberately mainstream and short. A long list guesses wrong more often, and
 * a wrong subject quietly changes planning (the planner keeps per-subject speed
 * factors) — so anything unrecognised leaves the subject blank rather than
 * picking the closest thing.
 */
const SUBJECTS: [string, string[]][] = [
  ['Math', ['math', 'maths', 'algebra', 'geometry', 'calculus', 'trig', 'precalc', 'calc', 'stats', 'statistics']],
  ['English', ['english', 'ela', 'lit', 'literature', 'shakespeare']],
  ['Science', ['science', 'biology', 'bio', 'chemistry', 'chem', 'physics', 'anatomy']],
  ['History', ['history', 'civics', 'government', 'geography', 'econ', 'economics', 'apush']],
  ['Spanish', ['spanish', 'espanol']],
  ['French', ['french']],
  ['German', ['german']],
  ['Art', ['art', 'drawing', 'painting', 'ceramics', 'photography']],
  ['Music', ['music', 'band', 'orchestra', 'choir', 'guitar', 'piano']],
  ['PE', ['pe', 'gym', 'fitness']],
  ['Computer Science', ['cs', 'coding', 'programming', 'compsci']],
];

const PLATFORMS: [Platform, string[]][] = [
  ['Canvas', ['canvas']],
  ['Edgenuity', ['edgenuity', 'edg']],
];

/** Words that only ever introduce a date, and are never part of a title. */
const DUE_WORDS = ['due', 'by', 'on', 'for'];

/**
 * How long different kinds of schoolwork tend to take, in minutes.
 *
 * These are starting points that get out of the way, not measurements — the
 * moment a student logs real time on a subject, `estimateFor` prefers their own
 * history. The spread matters more than the exact numbers: an essay and a
 * worksheet are not the same job, and defaulting both to 30 minutes makes the
 * first plan obviously wrong, which is how a student learns to distrust it.
 */
const WORK_TYPES: [number, string[]][] = [
  [90, ['essay', 'paper', 'report', 'project', 'presentation', 'lab report']],
  // Note "chapter" is deliberately absent: it names a unit of material, not a
  // kind of work. With it here, "read chapter 4" matched 60 minutes before
  // "read" could claim 45. "study chapter 5" still lands on 60, via "study".
  [60, ['lab', 'study', 'revise', 'revision', 'review']],
  [45, ['read', 'reading', 'notes', 'outline', 'draft']],
  [30, ['worksheet', 'homework', 'hw', 'problems', 'practice', 'exercises', 'quiz']],
  [20, ['vocab', 'flashcards', 'watch', 'video', 'discussion', 'post', 'submit']],
];

/** Used when nothing at all can be inferred. */
export const DEFAULT_ESTIMATE_MINUTES = 30;

/* ------------------------------------------------------------------ */
/* Estimating without asking                                           */
/* ------------------------------------------------------------------ */

/**
 * The estimate LockIn uses when the student didn't give one.
 *
 * Order of preference, best evidence first:
 *
 *  1. **What this student actually spends on this subject.** Median of finished
 *     assignments in that subject, which is the only real data there is. Median
 *     rather than mean: one all-nighter should not move every future estimate.
 *  2. **What the words suggest** — an essay is not a worksheet.
 *  3. **30 minutes.**
 *
 * Rounded to five minutes, because an estimate of "37" implies a precision that
 * does not exist and invites arguing with it.
 */
export function estimateFor(
  text: string,
  subject: string,
  history: { assignments: readonly Assignment[]; sessions: readonly CompletedSession[] } = {
    assignments: [],
    sessions: [],
  },
): { minutes: number; source: 'learned' | 'keyword' | 'default' } {
  const learned = learnedEstimate(subject, history);
  if (learned !== null) return { minutes: learned, source: 'learned' };

  const words = text.toLowerCase();
  for (const [minutes, keywords] of WORK_TYPES) {
    if (keywords.some((keyword) => words.includes(keyword))) return { minutes, source: 'keyword' };
  }
  return { minutes: DEFAULT_ESTIMATE_MINUTES, source: 'default' };
}

/** Median real time spent on finished work in this subject, or null. */
function learnedEstimate(
  subject: string,
  history: { assignments: readonly Assignment[]; sessions: readonly CompletedSession[] },
): number | null {
  if (!subject) return null;
  const minutes = history.assignments
    .filter((a) => a.subject === subject && a.status === 'Completed' && a.loggedMinutes > 0)
    .map((a) => a.loggedMinutes)
    .sort((a, b) => a - b);

  // Two finished assignments is not a pattern. Three is enough to beat a guess
  // made from keywords, and few enough to start helping in the first week.
  if (minutes.length < 3) return null;
  const median = minutes[Math.floor(minutes.length / 2)];
  return Math.max(5, Math.min(600, Math.round(median / 5) * 5));
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

const clean = (text: string) => text.toLowerCase().replace(/[^0-9a-z:/.-]/g, '');
const letters = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '');

export function parseQuickAdd(
  input: string,
  now = new Date(),
  history?: { assignments: readonly Assignment[]; sessions: readonly CompletedSession[] },
): QuickAddResult {
  const tokens = tokenize(input);
  const consumed = new Set<number>();
  const spans: ParsedSpan[] = [];

  const claim = (indices: number[], kind: ParsedSpan['kind'], label: string) => {
    for (const i of indices) consumed.add(i);
    const first = tokens[indices[0]];
    const last = tokens[indices[indices.length - 1]];
    spans.push({ start: first.start, end: last.end, kind, label });
  };

  /* ---- duration ---- */
  let statedMinutes: number | null = null;
  tokens.forEach((token, i) => {
    if (statedMinutes !== null || consumed.has(i)) return;
    const value = clean(token.text);

    const inline = /^(\d+(?:\.\d+)?)(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)$/.exec(value);
    if (inline) {
      statedMinutes = clampMinutes(Number(inline[1]) * (inline[2].startsWith('h') ? 60 : 1));
      claim([i], 'duration', `${statedMinutes} min`);
      return;
    }
    const next = tokens[i + 1] ? letters(tokens[i + 1].text) : '';
    if (/^\d+(?:\.\d+)?$/.test(value) && next) {
      if (/^(h|hr|hrs|hour|hours)$/.test(next)) {
        statedMinutes = clampMinutes(Number(value) * 60);
        claim([i, i + 1], 'duration', `${statedMinutes} min`);
      } else if (/^(m|min|mins|minute|minutes)$/.test(next)) {
        statedMinutes = clampMinutes(Number(value));
        claim([i, i + 1], 'duration', `${statedMinutes} min`);
      }
    }
  });

  /* ---- time of day ---- */
  let dueTime = '23:59';
  let statedTime = false;
  tokens.forEach((token, i) => {
    if (statedTime || consumed.has(i)) return;
    const value = clean(token.text);

    const meridiem = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(value);
    if (meridiem) {
      let hour = Number(meridiem[1]) % 12;
      if (meridiem[3] === 'pm') hour += 12;
      dueTime = `${pad(hour)}:${meridiem[2] ?? '00'}`;
      statedTime = true;
      claim([i], 'time', formatClock(dueTime));
      return;
    }
    // "5 pm" as two tokens.
    const next = tokens[i + 1] ? letters(tokens[i + 1].text) : '';
    if (/^\d{1,2}$/.test(value) && (next === 'am' || next === 'pm')) {
      let hour = Number(value) % 12;
      if (next === 'pm') hour += 12;
      dueTime = `${pad(hour)}:00`;
      statedTime = true;
      claim([i, i + 1], 'time', formatClock(dueTime));
      return;
    }
    const clock = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (clock && Number(clock[1]) < 24) {
      dueTime = `${pad(Number(clock[1]))}:${clock[2]}`;
      statedTime = true;
      claim([i], 'time', formatClock(dueTime));
    }
  });

  /* ---- date ---- */
  let dueDate = '';
  const today = todayISO(now);
  tokens.forEach((token, i) => {
    if (dueDate || consumed.has(i)) return;
    const word = letters(token.text);
    const value = clean(token.text);

    if (word === 'today' || word === 'tonight') {
      dueDate = today;
      claim([i], 'date', 'today');
      return;
    }
    if (word === 'tomorrow' || word === 'tmrw' || word === 'tmr' || word === 'tmw') {
      dueDate = addDaysISO(today, 1);
      claim([i], 'date', 'tomorrow');
      return;
    }

    // "next friday" / "this friday"
    const qualifier = i > 0 && !consumed.has(i - 1) ? letters(tokens[i - 1].text) : '';
    const weekday = WEEKDAYS.findIndex((names) => names.includes(word));
    if (weekday !== -1) {
      // Always the next occurrence, never today: "due friday" said on a Friday
      // means the coming Friday, and a deadline already past is a worse guess
      // than one seven days out.
      let delta = ((weekday - now.getDay() + 7) % 7) || 7;
      const indices = [i];
      if (qualifier === 'next') {
        delta += 7;
        indices.unshift(i - 1);
      } else if (qualifier === 'this') {
        indices.unshift(i - 1);
      }
      dueDate = addDaysISO(today, delta);
      claim(indices, 'date', shortDate(dueDate));
      return;
    }

    // "sep 12" / "12 sep" / "september 12th"
    const month = MONTHS.findIndex((names) => names.includes(word));
    if (month !== -1) {
      const after = tokens[i + 1] ? Number(clean(tokens[i + 1].text).replace(/(st|nd|rd|th)$/, '')) : NaN;
      const before = i > 0 && !consumed.has(i - 1)
        ? Number(clean(tokens[i - 1].text).replace(/(st|nd|rd|th)$/, ''))
        : NaN;
      const day = Number.isInteger(after) ? after : before;
      const indices = Number.isInteger(after) ? [i, i + 1] : Number.isInteger(before) ? [i - 1, i] : null;
      if (indices && day >= 1 && day <= 31) {
        const built = buildDate(now, month + 1, day);
        if (built) {
          dueDate = built;
          claim(indices, 'date', shortDate(built));
          return;
        }
      }
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-').map(Number);
      if (isRealDate(y, m, d)) {
        dueDate = value;
        claim([i], 'date', shortDate(value));
      }
      return;
    }

    // 12/5 or 12/5/26 — month/day, the US convention this app is built for.
    const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(value);
    if (slash) {
      const month2 = Number(slash[1]);
      const day = Number(slash[2]);
      const year = slash[3]
        ? slash[3].length === 2
          ? 2000 + Number(slash[3])
          : Number(slash[3])
        : undefined;
      const built = buildDate(now, month2, day, year);
      if (built) {
        dueDate = built;
        claim([i], 'date', shortDate(built));
      }
    }
  });

  /* ---- priority ---- */
  let priority: Priority = 'Normal';
  tokens.forEach((token, i) => {
    if (consumed.has(i)) return;
    const value = token.text.toLowerCase().replace(/[^a-z!]/g, '');
    if (value === '!!' || value === '!!!' || value === 'urgent') {
      priority = 'Urgent';
      claim([i], 'priority', 'urgent');
    } else if (value === '!' || value === 'important') {
      priority = 'Important';
      claim([i], 'priority', 'important');
    }
  });

  /* ---- platform ---- */
  let platform: Platform = 'Other';
  tokens.forEach((token, i) => {
    if (consumed.has(i)) return;
    const word = letters(token.text);
    for (const [name, aliases] of PLATFORMS) {
      if (aliases.includes(word)) {
        platform = name;
        claim([i], 'platform', name);
        return;
      }
    }
  });

  /* ---- subject ----
     Recognised but NOT claimed: "math" is genuinely part of "chapter 7 math",
     and striking it out would leave a title that reads worse than what was
     typed. */
  let subject = '';
  for (const token of tokens) {
    const word = letters(token.text);
    const hit = SUBJECTS.find(([, aliases]) => aliases.includes(word));
    if (hit) {
      subject = hit[0];
      break;
    }
  }

  /* ---- whatever is left is the title ---- */
  const title = tokens
    .filter((token, i) => {
      if (consumed.has(i)) return false;
      // A "due"/"by" that introduced a date we understood is noise; one that
      // did not is part of the title, because dropping it would lose meaning.
      if (dueDate && DUE_WORDS.includes(letters(token.text))) return false;
      return true;
    })
    .map((token) => token.text)
    .join(' ')
    .trim();

  const estimate = estimateFor(input, subject, history);
  return {
    title: title.slice(0, 200),
    dueDate,
    dueTime,
    estimatedMinutes: statedMinutes ?? estimate.minutes,
    estimateInferred: statedMinutes === null,
    estimateSource: statedMinutes === null ? estimate.source : 'stated',
    subject,
    platform,
    priority,
    spans: spans.sort((a, b) => a.start - b.start),
  };
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function clampMinutes(value: number): number {
  return Math.max(5, Math.min(600, Math.round(value)));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Builds a date from a month and day with no year.
 *
 * A bare "9/10" in the past almost always means next year — school runs across
 * a year boundary, and nobody types a deadline that has already gone.
 */
function buildDate(now: Date, month: number, day: number, year?: number): string | null {
  let resolved = year ?? now.getFullYear();
  if (year === undefined) {
    const candidate = new Date(resolved, month - 1, day);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (candidate < startOfToday) resolved += 1;
  }
  if (!isRealDate(resolved, month, day)) return null;
  return `${resolved}-${pad(month)}-${pad(day)}`;
}

/** `Fri 5 Sep`, for a highlight label. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${m ? `:${pad(m)}` : ''}${suffix}`;
}
