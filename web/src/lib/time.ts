/** Date/time helpers. All dates are local-time `YYYY-MM-DD` strings. */

export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parses `YYYY-MM-DD` + `HH:MM` into a local Date; null if unparseable. */
export function parseDueDate(dateISO: string, timeHHMM = '23:59'): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const [y, m, d] = dateISO.split('-').map(Number);
  let hh = 23;
  let mm = 59;
  if (/^\d{1,2}:\d{2}$/.test(timeHHMM)) {
    const parts = timeHHMM.split(':').map(Number);
    hh = parts[0];
    mm = parts[1];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  const date = new Date(y, m - 1, d, hh, mm, 0, 0);
  // Rejects 2026-02-31 style overflow.
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Whole days from today until `dateISO`. Negative when in the past. */
export function daysUntil(dateISO: string, now: Date = new Date()): number | null {
  const target = parseDueDate(dateISO, '00:00');
  if (!target) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function formatDaysRemaining(days: number | null): string {
  if (days === null) return 'Date unknown';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days remaining`;
}

export function formatDue(dateISO: string, timeHHMM: string): string {
  const date = parseDueDate(dateISO, timeHHMM);
  if (!date) return 'No due date';
  const days = daysUntil(dateISO);
  const time = formatTime(timeHHMM);
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  if (days !== null && days < 0) return `Overdue · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  return `${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

export function formatTime(timeHHMM: string): string {
  if (!/^\d{1,2}:\d{2}$/.test(timeHHMM)) return timeHHMM;
  const [h, m] = timeHHMM.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = now.getTime() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Splits an ISO timestamp into LockIn's local `YYYY-MM-DD` + `HH:MM` pair.
 * Canvas sends UTC instants; students think in local time, so convert once
 * here rather than scattering timezone maths through the UI.
 */
export function splitIsoToLocal(iso: string): { date: string; time: string } | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
}

/* ------------------------------------------------------------------ */
/* Calendar helpers (Phase 7 planner)                                  */
/* ------------------------------------------------------------------ */

/**
 * Adds whole days to a local `YYYY-MM-DD` date.
 *
 * Deliberately built through the local-time Date constructor rather than
 * `+ n * 86_400_000`: on a DST boundary a day is 23 or 25 hours long, and
 * millisecond arithmetic silently lands on the wrong calendar day. The
 * constructor normalises overflow (day 32 → the 1st of the next month) for us.
 */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateISO;
  return todayISO(new Date(y, m - 1, d + days, 12, 0, 0, 0));
}

/** `YYYY-MM-DD` → local midday Date. Midday keeps DST shifts off the date. */
export function dateFromISO(dateISO: string): Date | null {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/** Day of week for a local `YYYY-MM-DD`, 0 = Sunday. Null if unparseable. */
export function weekdayOf(dateISO: string): number | null {
  return dateFromISO(dateISO)?.getDay() ?? null;
}

/** `HH:MM` → minutes since local midnight. Null if unparseable. */
export function minutesOfDay(timeHHMM: string): number | null {
  if (!/^\d{1,2}:\d{2}$/.test(timeHHMM)) return null;
  const [h, m] = timeHHMM.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Minutes since local midnight → `HH:MM`, clamped to the day. */
export function hhmmFromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Whole days between two local `YYYY-MM-DD` dates (`to - from`). */
export function daysBetween(fromISO: string, toISO: string): number | null {
  const from = dateFromISO(fromISO);
  const to = dateFromISO(toISO);
  if (!from || !to) return null;
  // Both are local midday, so a DST hour can never push the quotient past .5.
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function uid(prefix = 'id'): string {
  const rand = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
