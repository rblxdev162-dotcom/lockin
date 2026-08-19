/**
 * An iCalendar (RFC 5545) parser, scoped to what a school calendar feed
 * actually contains.
 *
 * ## Treat every byte of this as hostile
 *
 * A feed URL points at a server LockIn does not control, and an assignment
 * title is written by a teacher — or by anyone who can create an event on a
 * shared calendar. So:
 *
 *  - hard caps on input size, event count and every string length;
 *  - `Object.create(null)` for property maps, because a feed containing
 *    `__proto__:` as a property name must not reach `Object.prototype`;
 *  - no regular expression that can backtrack catastrophically over long lines;
 *  - nothing here ever produces HTML, and nothing downstream may render a
 *    parsed field with `innerHTML`.
 *
 * ## What it does not do
 *
 * No VTIMEZONE arithmetic from the feed's own definitions: named zones are
 * resolved with `Intl`, which is correct and current, where a feed's embedded
 * VTIMEZONE may be years out of date. Recurrence is expanded only for the
 * simple, bounded cases a school feed uses — see `expandRecurrence`.
 */

/** Refuses a feed bigger than this outright. Real school feeds are ~10–200KB. */
export const MAX_FEED_BYTES = 4 * 1024 * 1024;
/** Beyond this many events, the feed is not a personal calendar. */
export const MAX_EVENTS = 2000;
const MAX_LINE = 8192;
const MAX_VALUE = 2000;

export interface IcsProperty {
  name: string;
  value: string;
  params: Record<string, string>;
}

export interface IcsEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  /** `CONFIRMED` | `TENTATIVE` | `CANCELLED`, upper-cased. */
  status?: string;
  categories: string[];
  /** Epoch ms, UTC. */
  start?: number;
  end?: number;
  /** True when DTSTART was `VALUE=DATE` — an all-day event with no clock time. */
  allDay: boolean;
  /** Epoch ms of DTSTAMP / LAST-MODIFIED, whichever is newer. */
  changedAt?: number;
  /** Raw RRULE, unexpanded. */
  rrule?: string;
  /** Set on an instance produced by recurrence expansion. */
  recurrenceId?: string;
  /** Everything else, for adapters that need a field this type does not name. */
  properties: Record<string, IcsProperty>;
}

export interface IcsParseResult {
  events: IcsEvent[];
  /** Calendar-level `X-WR-CALNAME`, when present. */
  calendarName?: string;
  /** Non-fatal problems, for the UI to report without failing the sync. */
  warnings: string[];
  /** True when the payload was not iCalendar at all. */
  fatal?: string;
}

/* ------------------------------------------------------------------ */
/* Unfolding and tokenising                                            */
/* ------------------------------------------------------------------ */

/**
 * RFC 5545 folds long lines by inserting CRLF + a single space or tab.
 * Unfolding has to happen before anything else, or a URL split across two
 * lines parses as a truncated URL and a stray property.
 */
export function unfold(text: string): string[] {
  const lines: string[] = [];
  // Normalise line endings first: real feeds arrive with CRLF, LF and — from
  // at least one LMS — a mix of both in the same file.
  for (const raw of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      const merged = lines[lines.length - 1] + raw.slice(1);
      lines[lines.length - 1] = merged.slice(0, MAX_LINE);
    } else {
      lines.push(raw.slice(0, MAX_LINE));
    }
  }
  return lines;
}

/**
 * `DTSTART;TZID=America/Los_Angeles:20260310T235900` →
 * `{ name: 'DTSTART', params: { TZID: 'America/Los_Angeles' }, value: '...' }`
 *
 * Written as a hand-rolled scan rather than a regex: parameter values may be
 * quoted and may contain a colon, which is exactly the case a regex gets wrong.
 */
export function parseLine(line: string): IcsProperty | null {
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) break;
    i += 1;
  }
  if (i >= line.length) return null;

  const head = line.slice(0, i);
  const value = line.slice(i + 1).slice(0, MAX_VALUE);

  const parts = splitUnquoted(head, ';');
  const name = (parts.shift() ?? '').trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = Object.create(null);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    let val = part.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (key && key !== '__PROTO__') params[key] = val.slice(0, 200);
  }

  return { name, value, params };
}

function splitUnquoted(input: string, separator: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of input) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === separator && !inQuotes) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/**
 * Undoes RFC 5545 text escaping: `\n`, `\,`, `\;`, `\\`.
 *
 * Also strips control characters. A title arriving with an embedded newline or
 * a bidi override is not a formatting choice, it is a way to make a list item
 * read as something it is not.
 */
export function unescapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      i += 1;
      if (next === 'n' || next === 'N') out += '\n';
      else if (next === ',' || next === ';' || next === '\\') out += next;
      else out += next;
    } else {
      out += ch;
    }
  }
  // Control characters, and the bidi overrides that let a title render as
  // something other than what it says. Neither is legitimate in a calendar
  // summary, and both are cheap ways to make a list item lie.
  return out
    // Newlines survive: a DESCRIPTION legitimately has them, and the title
    // mapper collapses whitespace itself. Every other control character goes.
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/**
 * The offset of a named zone at a given instant, in minutes.
 *
 * `Intl` is the only source of truth available in a browser that is actually
 * current — a feed's own VTIMEZONE block is a snapshot of the rules as they
 * were when the server was configured, and school feeds carry stale ones.
 */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return (asUtc - utcMs) / 60_000;
  } catch {
    return null;
  }
}

/**
 * Wall-clock time in a named zone → epoch ms.
 *
 * Two passes: guess with the offset at the naive instant, then correct with
 * the offset that actually applies at the guessed instant. That second pass is
 * what makes the hour either side of a DST transition come out right, and a
 * school calendar crosses two of those a year.
 */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): number | null {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = zoneOffsetMinutes(naive, timeZone);
  if (first === null) return null;
  const guess = naive - first * 60_000;
  const second = zoneOffsetMinutes(guess, timeZone);
  if (second === null) return null;
  return naive - second * 60_000;
}

export interface ParsedDate {
  ms: number;
  allDay: boolean;
}

/**
 * `DTSTART` in any of its three legal shapes.
 *
 * - `20260311T065900Z` — UTC, unambiguous.
 * - `20260310T235900` with `TZID=` — wall time in that zone.
 * - `20260310` with `VALUE=DATE` — an all-day event, anchored at local
 *   midnight so it lands on the day the student sees on their own calendar.
 *
 * A floating time (no `Z`, no `TZID`) is, per spec, local to the viewer, and
 * that is what a student expects for "due at 11:59".
 */
export function parseIcsDate(property: IcsProperty): ParsedDate | null {
  const value = property.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return { ms: new Date(Number(y), Number(mo) - 1, Number(d)).getTime(), allDay: true };
  }

  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!full) return null;
  const [, ys, mos, ds, hs, mis, ss, z] = full;
  const y = Number(ys);
  const mo = Number(mos);
  const d = Number(ds);
  const h = Number(hs);
  const mi = Number(mis);
  const s = Number(ss);

  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;

  if (z) return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };

  const tzid = property.params.TZID;
  if (tzid) {
    const ms = zonedTimeToUtc(y, mo, d, h, mi, s, tzid);
    // An unknown zone name degrades to local time rather than dropping the
    // event: a due date an hour out is a nuisance, a missing assignment is a
    // missed deadline.
    if (ms !== null) return { ms, allDay: false };
  }

  return { ms: new Date(y, mo - 1, d, h, mi, s).getTime(), allDay: false };
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parses a whole feed.
 *
 * Never throws: a malformed feed produces `fatal` or per-event warnings, and
 * the caller keeps whatever it already had. Losing today's assignments because
 * a server returned an error page is the worst outcome available here.
 */
export function parseIcs(text: string): IcsParseResult {
  const warnings: string[] = [];

  if (typeof text !== 'string' || text.length === 0) {
    return { events: [], warnings, fatal: 'The feed was empty.' };
  }
  if (text.length > MAX_FEED_BYTES) {
    return { events: [], warnings, fatal: 'The feed is too large to be a calendar.' };
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    // Almost always an HTML login page or an error document, which is a much
    // more useful thing to say than "0 events".
    return {
      events: [],
      warnings,
      fatal: /<html/i.test(text)
        ? 'That address returned a web page, not a calendar feed.'
        : 'That does not look like a calendar feed.',
    };
  }

  const events: IcsEvent[] = [];
  let calendarName: string | undefined;
  let current: IcsEvent | null = null;
  let depth = 0;

  for (const line of unfold(text)) {
    if (!line) continue;
    const property = parseLine(line);
    if (!property) continue;

    if (property.name === 'BEGIN') {
      const kind = property.value.toUpperCase();
      if (kind === 'VEVENT') {
        current = {
          categories: [],
          allDay: false,
          properties: Object.create(null) as Record<string, IcsProperty>,
        };
        depth = 0;
      } else if (current) {
        // A VALARM inside a VEVENT. Skip its properties entirely rather than
        // letting an alarm's own DTSTART overwrite the event's.
        depth += 1;
      }
      continue;
    }

    if (property.name === 'END') {
      const kind = property.value.toUpperCase();
      if (kind === 'VEVENT' && current) {
        if (events.length < MAX_EVENTS) events.push(current);
        else if (events.length === MAX_EVENTS) warnings.push('The feed had more events than LockIn reads.');
        current = null;
      } else if (depth > 0) {
        depth -= 1;
      }
      continue;
    }

    if (!current) {
      if (property.name === 'X-WR-CALNAME') calendarName = unescapeText(property.value).slice(0, 120);
      continue;
    }
    if (depth > 0) continue;

    applyProperty(current, property);
  }

  if (current) warnings.push('The feed ended mid-event.');
  return { events, calendarName, warnings };
}

function applyProperty(event: IcsEvent, property: IcsProperty): void {
  const value = property.value;
  switch (property.name) {
    case 'UID':
      event.uid = unescapeText(value).slice(0, 256);
      break;
    case 'SUMMARY':
      event.summary = unescapeText(value).slice(0, 300);
      break;
    case 'DESCRIPTION':
      event.description = unescapeText(value).slice(0, 1000);
      break;
    case 'LOCATION':
      event.location = unescapeText(value).slice(0, 200);
      break;
    case 'URL':
      event.url = value.trim().slice(0, 500);
      break;
    case 'STATUS':
      event.status = value.trim().toUpperCase().slice(0, 20);
      break;
    case 'CATEGORIES':
      event.categories = splitUnquoted(value, ',')
        .map((c) => unescapeText(c).slice(0, 60))
        .filter(Boolean)
        .slice(0, 10);
      break;
    case 'DTSTART': {
      const parsed = parseIcsDate(property);
      if (parsed) {
        event.start = parsed.ms;
        event.allDay = parsed.allDay;
      }
      break;
    }
    case 'DTEND': {
      const parsed = parseIcsDate(property);
      if (parsed) event.end = parsed.ms;
      break;
    }
    case 'DTSTAMP':
    case 'LAST-MODIFIED': {
      const parsed = parseIcsDate(property);
      // The newer of the two: DTSTAMP is when the feed was generated,
      // LAST-MODIFIED when the event changed, and either can be the later one.
      if (parsed && (event.changedAt === undefined || parsed.ms > event.changedAt)) {
        event.changedAt = parsed.ms;
      }
      break;
    }
    case 'RRULE':
      event.rrule = value.slice(0, 300);
      break;
    default:
      break;
  }
  if (property.name !== '__PROTO__') event.properties[property.name] = property;
}

/* ------------------------------------------------------------------ */
/* Recurrence                                                          */
/* ------------------------------------------------------------------ */

/**
 * Expands the recurrence shapes a school feed actually uses, and refuses the
 * rest.
 *
 * Supported: `FREQ=DAILY|WEEKLY|MONTHLY` with `INTERVAL`, and a bound —
 * `UNTIL` or `COUNT`. **An unbounded rule is not expanded at all**; the
 * original event is returned unchanged. That is deliberate: an infinite series
 * has no honest end, and generating a thousand assignments from one line of a
 * feed is how a planner becomes unusable.
 *
 * `BYDAY` is not implemented, and an event carrying it is left unexpanded
 * rather than expanded wrongly.
 */
export function expandRecurrence(event: IcsEvent, horizonMs: number, limit = 60): IcsEvent[] {
  if (!event.rrule || event.start === undefined) return [event];

  const rule: Record<string, string> = Object.create(null);
  for (const part of event.rrule.split(';')) {
    const [k, v] = part.split('=');
    if (k && v && k.toUpperCase() !== '__PROTO__') rule[k.trim().toUpperCase()] = v.trim();
  }

  const freq = rule.FREQ?.toUpperCase();
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq)) return [event];
  if (rule.BYDAY || rule.BYMONTHDAY || rule.BYSETPOS) return [event];

  const interval = Math.max(1, Math.min(52, Number(rule.INTERVAL) || 1));
  const count = rule.COUNT ? Math.max(1, Math.min(limit, Number(rule.COUNT))) : undefined;
  let until: number | undefined;
  if (rule.UNTIL) {
    const parsed = parseIcsDate({ name: 'UNTIL', value: rule.UNTIL, params: Object.create(null) });
    if (parsed) until = parsed.ms;
  }
  if (count === undefined && until === undefined) return [event];

  const out: IcsEvent[] = [];
  const duration = event.end !== undefined ? event.end - event.start : 0;
  const first = new Date(event.start);

  for (let n = 0; n < (count ?? limit); n += 1) {
    const occurrence = new Date(first);
    if (freq === 'DAILY') occurrence.setDate(first.getDate() + n * interval);
    else if (freq === 'WEEKLY') occurrence.setDate(first.getDate() + n * 7 * interval);
    else occurrence.setMonth(first.getMonth() + n * interval);

    const ms = occurrence.getTime();
    if (until !== undefined && ms > until) break;
    if (ms > horizonMs) break;

    out.push({
      ...event,
      start: ms,
      end: duration ? ms + duration : undefined,
      rrule: undefined,
      // Instances need distinct identities or they collapse into one another
      // on import. RFC 5545 spells the instance identity RECURRENCE-ID.
      recurrenceId: new Date(ms).toISOString(),
      uid: event.uid ? `${event.uid}::${new Date(ms).toISOString().slice(0, 10)}` : undefined,
    });
    if (out.length >= limit) break;
  }

  return out.length > 0 ? out : [event];
}
