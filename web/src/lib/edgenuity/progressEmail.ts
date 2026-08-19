/**
 * Parsing an Edgenuity progress report that the authorized recipient already
 * has.
 *
 * ## What this is, and what it is carefully not
 *
 * Edgenuity can email a recurring progress report to a parent or guardian.
 * That email belongs to the person who received it. Parsing a copy of it, on
 * their own machine, with no request ever issued to Imagine Learning, is a
 * completely different act from scraping a site — and it is the reason this
 * file exists instead of a scraper.
 *
 * It reads **only** academic progress fields. There is no code path here that
 * extracts a lesson, a question, an answer, a login link or anything about the
 * recipient. A field this parser does not name cannot enter LockIn.
 *
 * ## Deterministic, and never sent anywhere
 *
 * Plain regular expressions over the report's own labels. No AI service, no
 * network call, no heuristics that "usually work" — a number LockIn cannot
 * read confidently is left absent, and `UNKNOWN` is a perfectly good answer.
 *
 * ## Honest limitation, stated up front
 *
 * These patterns are written against the *documented* field names Edgenuity
 * progress reports use — Course, Completed, Target Completion, Overall Grade,
 * Actual Grade, Relative Grade, Start Date, Target Date. This project has no
 * real progress email to validate them against, so the parser is deliberately
 * label-driven and forgiving about layout, and `parseProgressEmail` reports
 * exactly which fields it found. When a real report arrives, checking that
 * report against `MATCHERS` is the whole of the work.
 */
import type { CourseProduct } from '../../types/integrations';

export interface ParsedCourseProgress {
  courseName: string;
  /** Percent complete right now. */
  actualProgressPercent?: number;
  /** Where the pacing schedule says the student should be. */
  targetProgressPercent?: number;
  overallGrade?: number;
  actualGrade?: number;
  relativeGrade?: number;
  /** ISO `YYYY-MM-DD`. */
  startDate?: string;
  targetEndDate?: string;
  /**
   * A status the report *published*, verbatim and normalised — the only thing
   * that may ever be shown as Edgenuity's own verdict rather than LockIn's.
   */
  officialStatus?: 'AHEAD' | 'ON_TRACK' | 'BEHIND';
  product: CourseProduct;
}

export interface ProgressEmailResult {
  ok: boolean;
  courses: ParsedCourseProgress[];
  /** The timestamp the report itself carried, ISO, when it stated one. */
  reportedAt?: string;
  /** Human-readable problem, when nothing usable was found. */
  error?: string;
  warnings: string[];
}

/** Anything longer than this is not a progress report. */
const MAX_INPUT = 512 * 1024;

/* ------------------------------------------------------------------ */
/* Text extraction                                                     */
/* ------------------------------------------------------------------ */

/**
 * HTML → text, without an HTML parser and without ever creating a node.
 *
 * A progress email is remote HTML. Building a DOM from it — even a detached
 * one — runs its `<img onerror>` handlers in some browsers and is exactly the
 * kind of shortcut that turns a parser into an XSS hole. So tags are stripped
 * textually, script and style bodies are removed wholesale, and the result is
 * plain text that nothing will ever render as markup.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    // Row and cell boundaries carry meaning in a table-shaped report: without
    // them every course collapses onto one line and the row matcher fails.
    .replace(/<\/(tr|div|p|h\d|li)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]{0,2000}>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d{1,6});/g, (_, code) => {
      const n = Number(code);
      return n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
    })
    // Spaces collapse; tabs do not. The tab is the cell boundary this parser
    // just went to the trouble of inserting, and collapsing it away is how a
    // whole table turns back into unparseable prose.
    .replace(/[  ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Field matchers                                                      */
/* ------------------------------------------------------------------ */

const PERCENT = String.raw`(\d{1,3}(?:\.\d{1,2})?)\s*%`;

/**
 * One matcher per field, keyed by the label Edgenuity uses.
 *
 * Kept as data rather than inline regexes so that adapting to a real report is
 * editing a table, not rewriting a parser — and so a test can assert that
 * every field LockIn claims to read has exactly one matcher.
 */
export const MATCHERS: Record<string, RegExp> = {
  actualProgressPercent: new RegExp(
    String.raw`(?:course\s+)?(?:completed|completion|progress)\s*(?:\(%\))?\s*[:\t]?\s*` + PERCENT,
    'i',
  ),
  targetProgressPercent: new RegExp(
    String.raw`target\s*(?:completion|progress|%)?\s*(?:\(%\))?\s*[:\t]?\s*` + PERCENT,
    'i',
  ),
  overallGrade: new RegExp(String.raw`overall\s*grade\s*[:\t]?\s*` + PERCENT, 'i'),
  actualGrade: new RegExp(String.raw`actual\s*grade\s*[:\t]?\s*` + PERCENT, 'i'),
  relativeGrade: new RegExp(String.raw`relative\s*grade\s*[:\t]?\s*` + PERCENT, 'i'),
};

const DATE_MATCHERS: Record<string, RegExp> = {
  startDate: /start\s*date\s*[:\t]?\s*([0-9]{1,4}[/\-][0-9]{1,2}[/\-][0-9]{1,4})/i,
  targetEndDate: /(?:target|end|completion)\s*date\s*[:\t]?\s*([0-9]{1,4}[/\-][0-9]{1,2}[/\-][0-9]{1,4})/i,
};

/**
 * `Course: Algebra I` in a labelled block.
 *
 * A colon is required. Without it, the header row of a table — `Course` in the
 * first cell, `Completed` in the second — parses as a course called
 * "Completed". Table rows are recognised by `rowCourseName` instead, which
 * demands a percentage and so cannot match a header.
 */
const COURSE_LABEL = /course(?:\s*name)?\s*:\s*([^\t\n]{2,80})/i;

/**
 * `3/12/2026` or `2026-03-12` → `2026-03-12`.
 *
 * US order is assumed for slash dates, because that is what an Edgenuity
 * report in a US district emits. An ambiguous value that would be invalid as
 * US order (`25/03/2026`) is read the other way round rather than discarded.
 */
export function normaliseDate(raw: string): string | undefined {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;

  const slash = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(raw);
  if (!slash) return undefined;
  let [, a, b, y] = slash;
  let month = Number(a);
  let day = Number(b);
  if (month > 12 && day <= 12) [month, day] = [day, month];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const year = y.length === 2 ? Number(y) + 2000 : Number(y);
  if (year < 2000 || year > 2100) return undefined;
  return `${year}-${pad(String(month))}-${pad(String(day))}`;
}

function pad(v: string): string {
  return v.padStart(2, '0');
}

function percentIn(text: string, matcher: RegExp): number | undefined {
  const match = matcher.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return Math.round(value * 10) / 10;
}

/**
 * Which Edgenuity product produced this report.
 *
 * Only ever decided from what the report says about itself. Guessing would
 * defeat the point: the whole reason `product` exists is that the pacing rules
 * differ, so an incorrect guess produces a confident wrong verdict.
 */
export function detectProduct(text: string): CourseProduct {
  if (/\bedgeex\b/i.test(text)) return 'EDGEEX';
  if (/\bedgenuity\b/i.test(text) || /imagine\s+learning/i.test(text)) return 'EDGENUITY';
  return 'UNKNOWN';
}

/** A status the report published in words, normalised. Never inferred. */
export function readOfficialStatus(text: string): ParsedCourseProgress['officialStatus'] {
  if (/\bahead\s+of\s+(?:pace|schedule)\b|\bahead\b/i.test(text)) return 'AHEAD';
  if (/\bbehind\s+(?:pace|schedule)\b|\bbehind\b/i.test(text)) return 'BEHIND';
  if (/\bon\s+(?:track|pace|schedule)\b/i.test(text)) return 'ON_TRACK';
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Reports come in two shapes, and neither is a variant of the other:
 *
 *  - a **table**, where the labels are a header row and each course is a row of
 *    positional cells;
 *  - **labelled blocks**, where every course repeats `Completed: 61.7%`.
 *
 * A single parser for both ends up guessing. So there are two, tried in order,
 * and each is simple enough to be obviously right.
 */

/** Column roles a progress table can carry, matched against its header row. */
const TABLE_COLUMNS: Record<string, RegExp> = {
  courseName: /^course(\s*name)?$/i,
  actualProgressPercent: /^(completed|completion|course\s*completed|progress)(\s*\(%\))?$/i,
  targetProgressPercent: /^target(\s*(completion|progress))?(\s*\(%\))?$/i,
  overallGrade: /^overall\s*grade$/i,
  actualGrade: /^actual\s*grade$/i,
  relativeGrade: /^relative\s*grade$/i,
  status: /^(status|pace)$/i,
  startDate: /^start\s*date$/i,
  targetEndDate: /^(target|end|completion)\s*date$/i,
};

function cells(line: string): string[] {
  return line.split('\t').map((c) => c.trim());
}

/** Maps a header row to column indices, or null when it is not a header. */
export function mapProgressHeader(line: string): Record<string, number> | null {
  const parts = cells(line);
  if (parts.length < 2) return null;
  const map: Record<string, number> = {};
  parts.forEach((cell, index) => {
    for (const [role, matcher] of Object.entries(TABLE_COLUMNS)) {
      if (map[role] === undefined && matcher.test(cell)) map[role] = index;
    }
  });
  // A header has to name the course column and at least one metric, or a row
  // of ordinary prose with two tabs in it would be read as a table.
  if (map.courseName === undefined) return null;
  const metrics = Object.keys(map).filter((k) => k !== 'courseName');
  return metrics.length > 0 ? map : null;
}

function percentAt(row: string[], index: number | undefined): number | undefined {
  if (index === undefined) return undefined;
  const raw = (row[index] ?? '').replace('%', '').trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return Math.round(value * 10) / 10;
}

function readTableCourses(text: string, product: CourseProduct): ParsedCourseProgress[] {
  const lines = text.split('\n');
  const headerIndex = lines.findIndex((line) => mapProgressHeader(line) !== null);
  if (headerIndex === -1) return [];
  const columns = mapProgressHeader(lines[headerIndex]);
  if (!columns) return [];

  const out: ParsedCourseProgress[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const row = cells(line);
    const name = (row[columns.courseName] ?? '').trim();
    if (!name || name.length > 120) continue;
    // A repeated header, or a total row, is not a course.
    if (TABLE_COLUMNS.courseName.test(name) || /^total$/i.test(name)) continue;

    const parsed: ParsedCourseProgress = {
      courseName: name,
      actualProgressPercent: percentAt(row, columns.actualProgressPercent),
      targetProgressPercent: percentAt(row, columns.targetProgressPercent),
      overallGrade: percentAt(row, columns.overallGrade),
      actualGrade: percentAt(row, columns.actualGrade),
      relativeGrade: percentAt(row, columns.relativeGrade),
      officialStatus:
        columns.status !== undefined ? readOfficialStatus(row[columns.status] ?? '') : undefined,
      product,
    };
    if (columns.startDate !== undefined) {
      parsed.startDate = normaliseDate((row[columns.startDate] ?? '').trim());
    }
    if (columns.targetEndDate !== undefined) {
      parsed.targetEndDate = normaliseDate((row[columns.targetEndDate] ?? '').trim());
    }
    out.push(parsed);
  }
  return out;
}

/** Splits a labelled report into one chunk per `Course: …` heading. */
export function splitCourses(text: string): { name: string; body: string }[] {
  const chunks: { name: string; body: string }[] = [];
  let current: { name: string; body: string } | null = null;

  for (const line of text.split('\n')) {
    const labelled = COURSE_LABEL.exec(line);
    if (labelled) {
      if (current) chunks.push(current);
      current = { name: labelled[1].trim().slice(0, 120), body: line };
    } else if (current) {
      current.body += '\n' + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function readBlockCourses(text: string, product: CourseProduct): ParsedCourseProgress[] {
  return splitCourses(text).map((chunk) => {
    const parsed: ParsedCourseProgress = {
      courseName: chunk.name,
      actualProgressPercent: percentIn(chunk.body, MATCHERS.actualProgressPercent),
      targetProgressPercent: percentIn(chunk.body, MATCHERS.targetProgressPercent),
      overallGrade: percentIn(chunk.body, MATCHERS.overallGrade),
      actualGrade: percentIn(chunk.body, MATCHERS.actualGrade),
      relativeGrade: percentIn(chunk.body, MATCHERS.relativeGrade),
      officialStatus: readOfficialStatus(chunk.body),
      product,
    };
    for (const [field, matcher] of Object.entries(DATE_MATCHERS)) {
      const match = matcher.exec(chunk.body);
      const date = match ? normaliseDate(match[1]) : undefined;
      if (date) (parsed as unknown as Record<string, string>)[field] = date;
    }
    return parsed;
  });
}

/** The timestamp a report states about itself, when it states one. */
export function readReportTimestamp(text: string): string | undefined {
  const match =
    /(?:report(?:ed)?|generated|as\s+of|week\s+ending)\s*(?:on|date)?\s*[:\t]?\s*([0-9]{1,4}[/\-][0-9]{1,2}[/\-][0-9]{1,4})/i.exec(
      text,
    );
  if (!match) return undefined;
  const date = normaliseDate(match[1]);
  return date ? `${date}T00:00:00.000Z` : undefined;
}

/**
 * Parses one progress report.
 *
 * Accepts HTML or plain text; the caller does not have to know which. Never
 * throws, and never invents: a field with no confident match is simply absent,
 * and the Pace Engine treats an absent target as UNKNOWN rather than as zero.
 */
export function parseProgressEmail(input: string): ProgressEmailResult {
  const warnings: string[] = [];
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { ok: false, courses: [], error: 'That file was empty.', warnings };
  }
  if (input.length > MAX_INPUT) {
    return { ok: false, courses: [], error: 'That file is too large to be a progress report.', warnings };
  }

  const text = /<[a-z!][\s\S]*>/i.test(input) ? htmlToText(input) : input;
  const product = detectProduct(text);
  const reportedAt = readReportTimestamp(text);

  // Table first: when a report has a header row, positional cells are exactly
  // what it means, and label matching over a row would pick up the neighbouring
  // column's number.
  const fromTable = readTableCourses(text, product);
  const candidates = fromTable.length > 0 ? fromTable : readBlockCourses(text, product);

  // A course with no readable metric at all is a heading, a footer, or a
  // mention in passing. Keeping it would put an empty card on the Progress page
  // for something LockIn knows nothing about.
  const courses = candidates.filter(
    (c) =>
      c.actualProgressPercent !== undefined ||
      c.targetProgressPercent !== undefined ||
      c.overallGrade !== undefined ||
      c.actualGrade !== undefined ||
      c.relativeGrade !== undefined,
  );

  if (courses.length === 0) {
    return {
      ok: false,
      courses: [],
      error: 'No course progress could be read from that file.',
      warnings,
    };
  }

  if (product === 'UNKNOWN') {
    warnings.push(
      'This report does not say which Edgenuity product it is from, so pacing is shown as LockIn’s own estimate.',
    );
  }

  return { ok: true, courses, reportedAt, warnings };
}
