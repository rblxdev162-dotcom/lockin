import { classSwitchLabel } from './classNames';

export const SCHOOL_DAYS = [
  { id: 1, short: 'M', label: 'Monday' },
  { id: 2, short: 'T', label: 'Tuesday' },
  { id: 3, short: 'W', label: 'Wednesday' },
  { id: 4, short: 'T', label: 'Thursday' },
  { id: 5, short: 'F', label: 'Friday' },
] as const;

export const CLASS_COLORS = ['brand', 'mint', 'sky', 'amber', 'violet', 'rose'] as const;
export type ClassColor = (typeof CLASS_COLORS)[number];

export interface ScheduledClass {
  id: string;
  name: string;
  days: number[];
  color: ClassColor;
  icon: string;
}

export interface SchoolBreak {
  id: string;
  label: string;
  start: string;
  end: string;
  days: number[];
}

export interface SchoolSchedule {
  configured: boolean;
  schoolStart: string;
  schoolEnd: string;
  classes: ScheduledClass[];
  breaks: SchoolBreak[];
  quietMode: boolean;
}

export function defaultSchoolSchedule(): SchoolSchedule {
  return {
    configured: false,
    schoolStart: '07:30',
    schoolEnd: '15:30',
    classes: [],
    breaks: [],
    quietMode: false,
  };
}

const hhmm = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
const days = (value: unknown) =>
  Array.isArray(value)
    ? [...new Set(value.map(Number))].filter((day) => Number.isInteger(day) && day >= 1 && day <= 5)
    : [];

export function normalizeSchoolSchedule(value: unknown): SchoolSchedule {
  const base = defaultSchoolSchedule();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Record<string, unknown>;
  const classes = Array.isArray(raw.classes)
    ? raw.classes.flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
        if (!name) return [];
        const color = CLASS_COLORS.includes(item.color as ClassColor)
          ? (item.color as ClassColor)
          : CLASS_COLORS[index % CLASS_COLORS.length];
        return [{
          id: typeof item.id === 'string' ? item.id.slice(0, 80) : `class-${index}`,
          name,
          days: days(item.days),
          color,
          icon: typeof item.icon === 'string' ? item.icon.slice(0, 3) : name.slice(0, 1).toUpperCase(),
        }];
      }).slice(0, 30)
    : [];
  const breaks = Array.isArray(raw.breaks)
    ? raw.breaks.flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Record<string, unknown>;
        const label = typeof item.label === 'string' ? item.label.trim().slice(0, 50) : '';
        if (!label) return [];
        return [{
          id: typeof item.id === 'string' ? item.id.slice(0, 80) : `break-${index}`,
          label,
          start: hhmm(item.start, '12:00'),
          end: hhmm(item.end, '12:30'),
          days: days(item.days),
        }];
      }).slice(0, 20)
    : [];
  return {
    configured: raw.configured === true,
    schoolStart: hhmm(raw.schoolStart, base.schoolStart),
    schoolEnd: hhmm(raw.schoolEnd, base.schoolEnd),
    classes,
    breaks,
    quietMode: raw.quietMode === true,
  };
}

export function classStyle(schedule: SchoolSchedule, subject: string) {
  const full = subject.toLowerCase();
  const short = classSwitchLabel(subject).toLowerCase();
  return schedule.classes.find((item) => {
    const itemFull = item.name.toLowerCase();
    return itemFull === full || itemFull === short || classSwitchLabel(item.name).toLowerCase() === short;
  });
}
