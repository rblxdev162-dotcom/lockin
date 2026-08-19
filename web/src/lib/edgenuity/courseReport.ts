/**
 * Importing an Edgenuity course report the student downloaded themselves.
 *
 * A course report is the structured half of the picture: it carries the
 * activity schedule and the pacing plan, where a progress email carries
 * today's numbers. Neither replaces the other, which is why `merge.ts` exists.
 *
 * ## Rules
 *
 *  - **The student supplies the file.** LockIn never fetches a report, never
 *    opens a background tab, never asks Edgenuity for anything. This parser
 *    reads a file that is already on the machine.
 *  - **Nothing is retained.** The file is parsed and dropped; only the fields
 *    below are stored, and `rawDataRetained` is `false` everywhere.
 *  - **Ambiguity is not resolved, it is reported.** A blank status cell is not
 *    "not completed" — it is a blank cell, and `completed` stays undefined so
 *    nothing downstream can count it either way.
 *  - **Deterministic text parsing only.** CSV, TSV and HTML tables, all by
 *    exact column labels. No layout heuristics, no OCR.
 */
import type { CourseActivity, CourseProduct } from '../../types/integrations';
import { detectProduct, htmlToText, normaliseDate, readReportTimestamp } from './progressEmail';

export interface ParsedCourseReport {
  ok: boolean;
  courseName?: string;
  product: CourseProduct;
  activities: CourseActivity[];
  /** Percentages, when the report states them alongside the schedule. */
  actualProgressPercent?: number;
  targetProgressPercent?: number;
  reportedAt?: string;
  error?: string;
  warnings: string[];
}

const MAX_INPUT = 2 * 1024 * 1024;
const MAX_ROWS = 2000;

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

/**
 * A CSV reader that handles quoted fields, embedded commas and doubled quotes.
 *
 * Written out rather than split on commas because an activity called
 * `"Systems of Equations, Part 2"` is completely ordinary, and a naive split
 * turns it into two columns and shifts every value after it.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
      if (rows.length >= MAX_ROWS) break;
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/** Picks the delimiter by counting candidates in the header line. */
export function sniffDelimiter(text: string): string {
  const head = text.slice(0, 4000).split('\n').slice(0, 5).join('\n');
  const tabs = (head.match(/\t/g) ?? []).length;
  const commas = (head.match(/,/g) ?? []).length;
  const semis = (head.match(/;/g) ?? []).length;
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t';
  if (semis > commas) return ';';
  return ',';
}

/**
 * Column labels, by role.
 *
 * Matched case-insensitively against the header row, longest first, so
 * `Target Completion Date` is not claimed by the `date` matcher before the
 * more specific one gets a chance.
 */
const COLUMNS: Record<string, RegExp> = {
  activity: /^(activity|activity\s*name|lesson|assignment|title)$/i,
  scheduledDate: /^(scheduled|scheduled\s*date|due|due\s*date|target\s*date|date)$/i,
  status: /^(status|state|completion|completed)$/i,
  score: /^(score|grade|points)$/i,
  course: /^(course|course\s*name|class)$/i,
};

export function mapHeader(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((cell, index) => {
    const label = cell.replace(/\s+/g, ' ').trim();
    for (const [role, matcher] of Object.entries(COLUMNS)) {
      if (map[role] === undefined && matcher.test(label)) map[role] = index;
    }
  });
  return map;
}

/**
 * Reads a status cell into a tri-state.
 *
 * The `undefined` branch is the important one. Edgenuity reports use several
 * words for "not yet", and some leave the cell blank for activities that are
 * simply not due — treating any of those as an explicit "not completed" would
 * let LockIn report a course as behind on the strength of an empty cell.
 */
export function readCompletion(cell: string | undefined): boolean | undefined {
  if (cell === undefined) return undefined;
  const value = cell.trim().toLowerCase();
  if (!value) return undefined;
  if (/^(complete|completed|done|passed|100%?|yes|y)$/.test(value)) return true;
  if (/^(not\s*started|in\s*progress|incomplete|assigned|pending|no|n)$/.test(value)) return false;
  // A percentage is a score, not a status, and a score of 0 is not a claim
  // that nothing was done.
  return undefined;
}

/** Stable per-course id: name plus scheduled date, slugified. */
function activityId(name: string, date?: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return date ? `${slug}@${date}` : slug;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parses a downloaded course report.
 *
 * Accepts CSV, TSV and HTML — an exported table, a saved page, or a report
 * pasted as text. A PDF must be converted to text before it reaches here; see
 * `readReportFile`.
 */
export function parseCourseReport(input: string): ParsedCourseReport {
  const warnings: string[] = [];
  const empty: ParsedCourseReport = { ok: false, product: 'UNKNOWN', activities: [], warnings };

  if (typeof input !== 'string' || input.trim().length === 0) {
    return { ...empty, error: 'That file was empty.' };
  }
  if (input.length > MAX_INPUT) {
    return { ...empty, error: 'That file is too large to be a course report.' };
  }

  const isHtml = /<[a-z!][\s\S]*>/i.test(input);
  const text = isHtml ? htmlToText(input) : input;
  const product = detectProduct(text);
  const reportedAt = readReportTimestamp(text);

  const rows = parseDelimited(isHtml ? text : input, isHtml ? '\t' : sniffDelimiter(input));
  if (rows.length < 2) {
    return { ...empty, product, error: 'No activity table could be found in that file.' };
  }

  // The header is the first row that names an activity column. Reports carry
  // a title block above the table, and assuming row 0 reads that instead.
  const headerIndex = rows.findIndex((row) => mapHeader(row).activity !== undefined);
  if (headerIndex === -1) {
    return { ...empty, product, error: 'That file has no activity column LockIn recognises.' };
  }

  const columns = mapHeader(rows[headerIndex]);
  const activities: CourseActivity[] = [];
  const courseNames = new Set<string>();

  for (const row of rows.slice(headerIndex + 1)) {
    const name = (row[columns.activity] ?? '').trim();
    if (!name || name.length > 200) continue;
    // A repeated header row (reports paginate) is not an activity.
    if (COLUMNS.activity.test(name)) continue;

    const rawDate = columns.scheduledDate !== undefined ? row[columns.scheduledDate] : undefined;
    const scheduledDate = rawDate ? normaliseDate(rawDate.trim()) : undefined;
    const completed = readCompletion(
      columns.status !== undefined ? row[columns.status] : undefined,
    );

    if (columns.course !== undefined && row[columns.course]) {
      courseNames.add(row[columns.course].trim().slice(0, 120));
    }

    activities.push({ id: activityId(name, scheduledDate), name: name.slice(0, 160), scheduledDate, completed });
    if (activities.length >= MAX_ROWS) {
      warnings.push('The report had more activities than LockIn imports.');
      break;
    }
  }

  if (activities.length === 0) {
    return { ...empty, product, error: 'No activities could be read from that file.' };
  }

  if (courseNames.size > 1) {
    warnings.push(
      `That report covers ${courseNames.size} courses. Import them one at a time so pacing stays per-course.`,
    );
  }

  const courseName =
    courseNames.size === 1 ? [...courseNames][0] : readCourseHeading(text) ?? undefined;
  if (!courseName) {
    warnings.push('LockIn could not tell which course this report is for — you will be asked.');
  }

  const percentages = readReportPercentages(text);

  return {
    ok: true,
    courseName,
    product,
    activities,
    reportedAt,
    ...percentages,
    warnings,
  };
}

/** A course named in the report's own heading block. */
function readCourseHeading(text: string): string | null {
  const match = /course(?:\s*name)?\s*[:\t]\s*([^\t\n]{2,80})/i.exec(text);
  return match ? match[1].trim() : null;
}

/** Percentages stated in the report header, when it has them. */
function readReportPercentages(text: string): {
  actualProgressPercent?: number;
  targetProgressPercent?: number;
} {
  const read = (matcher: RegExp) => {
    const match = matcher.exec(text);
    if (!match) return undefined;
    const value = Number(match[1]);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 10) / 10 : undefined;
  };
  return {
    actualProgressPercent: read(
      /(?:course\s+)?(?:completed|completion|progress)\s*(?:\(%\))?\s*[:\t]?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%/i,
    ),
    targetProgressPercent: read(
      /target\s*(?:completion|progress|%)?\s*(?:\(%\))?\s*[:\t]?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%/i,
    ),
  };
}

/**
 * Reads a report file.
 *
 * PDFs are refused with an instruction rather than guessed at. LockIn has no
 * PDF text extractor bundled, and OCR-ing a PDF that contains perfectly good
 * text would be the worst of both worlds: slow, lossy, and confidently wrong
 * about numbers. Exporting the same report as CSV, or saving it as text, is
 * one step for the student and gives a parse LockIn can stand behind.
 */
export async function readReportFile(file: File): Promise<ParsedCourseReport> {
  const warnings: string[] = [];
  if (file.size > MAX_INPUT) {
    return { ok: false, product: 'UNKNOWN', activities: [], warnings, error: 'That file is too large.' };
  }
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    return {
      ok: false,
      product: 'UNKNOWN',
      activities: [],
      warnings,
      error:
        'PDF reports are not read yet. Export the same report as CSV or Excel and import that instead.',
    };
  }
  return parseCourseReport(await file.text());
}
