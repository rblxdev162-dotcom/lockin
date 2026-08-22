import type { CourseGrade } from '../types/grades';

export const EXPERIENCE_EVENT = 'lockin:experience-change';
const PREFS_KEY = 'lockin.experience.v1';
const GRADE_HISTORY_KEY = 'lockin.grade-history.v1';
const TOOLKIT_KEY = 'lockin.toolkit.v1';

export const BACKGROUNDS = ['Aurora', 'Midnight', 'Sunset', 'Ocean', 'Minimal', 'Neon'] as const;
export type BackgroundTheme = (typeof BACKGROUNDS)[number];

export interface ExperiencePrefs {
  background: BackgroundTheme;
  sounds: boolean;
}

const defaults: ExperiencePrefs = { background: 'Aurora', sounds: false };

export function readExperience(): ExperiencePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    return {
      background: BACKGROUNDS.includes(raw.background as BackgroundTheme)
        ? (raw.background as BackgroundTheme)
        : defaults.background,
      sounds: raw.sounds === true,
    };
  } catch {
    return defaults;
  }
}

export function updateExperience(patch: Partial<ExperiencePrefs>): ExperiencePrefs {
  const next = { ...readExperience(), ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* stays in memory */ }
  window.dispatchEvent(new Event(EXPERIENCE_EVENT));
  return next;
}

/** Tiny local oscillator cues: no files, downloads, tracking, or audio until enabled. */
export function playLocalSound(kind: 'start' | 'complete' | 'timer'): void {
  if (!readExperience().sounds || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const notes = kind === 'start' ? [392, 523] : kind === 'timer' ? [523, 659] : [523, 659, 784];
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = context.currentTime + index * 0.08;
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.035, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.2);
  });
  window.setTimeout(() => void context.close(), 700);
}

let stopAmbience: (() => void) | null = null;

/** Optional synthesized ambience. It uses Web Audio only—no files or requests. */
export function setLocalAmbience(kind: FocusAmbience): void {
  stopAmbience?.();
  stopAmbience = null;
  if (kind === 'silence') return;
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const seconds = 3;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    data[index] = kind === 'brown' || kind === 'library' ? brown * 3.2 : white;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  source.loop = true;
  filter.type = kind === 'rain' ? 'highpass' : kind === 'fireplace' ? 'bandpass' : 'lowpass';
  filter.frequency.value = kind === 'rain' ? 1800 : kind === 'fireplace' ? 650 : kind === 'library' ? 280 : 520;
  gain.gain.value = kind === 'library' ? 0.018 : 0.035;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
  stopAmbience = () => { try { source.stop(); } catch { /* already stopped */ } void context.close(); };
}

export interface GradeHistoryPoint {
  courseId: string;
  score: number;
  readAt: string;
}

export type EnergyLevel = 'low' | 'normal' | 'high';
export type SessionIntention = 'start' | 'progress' | 'finish';
export type FocusKind = 'standard' | 'reading' | 'practice';
export type FocusAmbience = 'silence' | 'rain' | 'library' | 'fireplace' | 'brown';
export type SubmissionConfidence = 'drafting' | 'reviewed' | 'submitted' | 'verified';
export interface AssignmentToolState {
  requirements: { id: string; text: string; done: boolean }[];
  materials: string;
  dependencies: string;
  uncertainty: string;
  submissionConfidence: SubmissionConfidence;
  waitingOnTeacher: boolean;
  postmortem: string;
  target: string;
  snapshots: { at: string; title: string; dueDate: string; status: string }[];
}
export interface RoutineState { id: string; name: string; steps: string[] }
export interface ToolkitState {
  archivedClasses: string[];
  focusQueue: string[];
  focusNotes: { id: string; text: string; at: string }[];
  focusPresets: Record<string, number>;
  classNotes: Record<string, string>;
  teacherContacts: Record<string, { name: string; email: string; officeHours: string }>;
  examTopics: Record<string, { id: string; text: string; status: 'not_reviewed' | 'learning' | 'comfortable' }[]>;
  gradeNotes: Record<string, string>;
  reflection: { weekOf: string; worked: string; heavy: string; change: string } | null;
  energy: Record<string, EnergyLevel>;
  bedtime: string;
  sessionIntention: SessionIntention;
  topThree: string[];
  assignmentTools: Record<string, AssignmentToolState>;
  routines: RoutineState[];
  bagItems: Record<string, { id: string; text: string; done: boolean }[]>;
  noSchoolDays: string[];
  commuteMode: boolean;
  zenMode: boolean;
  autoTheme: boolean;
  focusKind: FocusKind;
  focusAmbience: FocusAmbience;
  focusRitual: boolean;
  softLandings: Record<string, string>;
  wins: { id: string; text: string; at: string }[];
  examConfidence: Record<string, string>;
}

const toolkitDefaults: ToolkitState = {
  archivedClasses: [], focusQueue: [], focusNotes: [], focusPresets: {}, classNotes: {},
  teacherContacts: {}, examTopics: {}, gradeNotes: {}, reflection: null, energy: {},
  bedtime: '22:30', sessionIntention: 'progress', topThree: [], assignmentTools: {}, routines: [],
  bagItems: {}, noSchoolDays: [], commuteMode: false, zenMode: false, autoTheme: false,
  focusKind: 'standard', focusAmbience: 'silence', focusRitual: true, softLandings: {}, wins: [], examConfidence: {},
};

const safeRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function readToolkit(): ToolkitState {
  try {
    const raw = safeRecord(JSON.parse(localStorage.getItem(TOOLKIT_KEY) ?? '{}'));
    const strings = (value: unknown, cap: number) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 120)).slice(0, cap) : [];
    const stringRecord = (value: unknown, valueCap: number) => Object.fromEntries(Object.entries(safeRecord(value)).flatMap(([key, item]) => typeof item === 'string' ? [[key.slice(0, 120), item.slice(0, valueCap)]] : []).slice(0, 80));
    const energy = Object.fromEntries(Object.entries(safeRecord(raw.energy)).flatMap(([key, value]) => ['low', 'normal', 'high'].includes(String(value)) ? [[key.slice(0, 12), value as EnergyLevel]] : []).slice(0, 7));
    const intention = ['start', 'progress', 'finish'].includes(String(raw.sessionIntention)) ? raw.sessionIntention as SessionIntention : toolkitDefaults.sessionIntention;
    const focusKind = ['standard', 'reading', 'practice'].includes(String(raw.focusKind)) ? raw.focusKind as FocusKind : toolkitDefaults.focusKind;
    const focusAmbience = ['silence', 'rain', 'library', 'fireplace', 'brown'].includes(String(raw.focusAmbience)) ? raw.focusAmbience as FocusAmbience : toolkitDefaults.focusAmbience;
    const assignmentTools = Object.fromEntries(Object.entries(safeRecord(raw.assignmentTools)).map(([key, value]) => {
      const item = safeRecord(value);
      const confidence = ['drafting', 'reviewed', 'submitted', 'verified'].includes(String(item.submissionConfidence)) ? item.submissionConfidence as SubmissionConfidence : 'drafting';
      const requirements = Array.isArray(item.requirements) ? item.requirements.flatMap((entry) => { const requirement = safeRecord(entry); return typeof requirement.text === 'string' ? [{ id: typeof requirement.id === 'string' ? requirement.id.slice(0, 80) : crypto.randomUUID(), text: requirement.text.slice(0, 180), done: requirement.done === true }] : []; }).slice(0, 30) : [];
      const snapshots = Array.isArray(item.snapshots) ? item.snapshots.flatMap((entry) => { const snapshot = safeRecord(entry); return typeof snapshot.at === 'string' ? [{ at: snapshot.at.slice(0, 40), title: typeof snapshot.title === 'string' ? snapshot.title.slice(0, 180) : '', dueDate: typeof snapshot.dueDate === 'string' ? snapshot.dueDate.slice(0, 10) : '', status: typeof snapshot.status === 'string' ? snapshot.status.slice(0, 40) : '' }] : []; }).slice(-12) : [];
      return [key.slice(0, 100), { requirements, materials: typeof item.materials === 'string' ? item.materials.slice(0, 800) : '', dependencies: typeof item.dependencies === 'string' ? item.dependencies.slice(0, 800) : '', uncertainty: typeof item.uncertainty === 'string' ? item.uncertainty.slice(0, 500) : '', submissionConfidence: confidence, waitingOnTeacher: item.waitingOnTeacher === true, postmortem: typeof item.postmortem === 'string' ? item.postmortem.slice(0, 500) : '', target: typeof item.target === 'string' ? item.target.slice(0, 180) : '', snapshots } satisfies AssignmentToolState];
    }).slice(0, 300));
    const routines = Array.isArray(raw.routines) ? raw.routines.flatMap((entry) => { const item = safeRecord(entry); return typeof item.name === 'string' ? [{ id: typeof item.id === 'string' ? item.id.slice(0, 80) : crypto.randomUUID(), name: item.name.slice(0, 100), steps: strings(item.steps, 12) }] : []; }).slice(0, 20) : [];
    const bagItems = Object.fromEntries(Object.entries(safeRecord(raw.bagItems)).map(([key, value]) => [key.slice(0, 10), Array.isArray(value) ? value.flatMap((entry) => { const item = safeRecord(entry); return typeof item.text === 'string' ? [{ id: typeof item.id === 'string' ? item.id.slice(0, 80) : crypto.randomUUID(), text: item.text.slice(0, 140), done: item.done === true }] : []; }).slice(0, 30) : []]).slice(0, 14));
    return {
      ...toolkitDefaults,
      archivedClasses: strings(raw.archivedClasses, 60),
      focusQueue: strings(raw.focusQueue, 12),
      focusNotes: Array.isArray(raw.focusNotes) ? raw.focusNotes.flatMap((entry) => { const item = safeRecord(entry); return typeof item.text === 'string' ? [{ id: typeof item.id === 'string' ? item.id.slice(0, 80) : crypto.randomUUID(), text: item.text.slice(0, 240), at: typeof item.at === 'string' ? item.at : new Date().toISOString() }] : []; }).slice(-40) : [],
      focusPresets: Object.fromEntries(Object.entries(safeRecord(raw.focusPresets)).flatMap(([key, value]) => typeof value === 'number' && Number.isFinite(value) ? [[key.slice(0, 120), Math.min(240, Math.max(5, Math.round(value)))]] : []).slice(0, 60)),
      classNotes: stringRecord(raw.classNotes, 3000),
      teacherContacts: Object.fromEntries(Object.entries(safeRecord(raw.teacherContacts)).map(([key, value]) => { const item = safeRecord(value); return [key.slice(0, 120), { name: typeof item.name === 'string' ? item.name.slice(0, 100) : '', email: typeof item.email === 'string' ? item.email.slice(0, 160) : '', officeHours: typeof item.officeHours === 'string' ? item.officeHours.slice(0, 160) : '' }]; }).slice(0, 60)),
      examTopics: Object.fromEntries(Object.entries(safeRecord(raw.examTopics)).map(([key, value]) => [key.slice(0, 80), Array.isArray(value) ? value.flatMap((entry) => { const item = safeRecord(entry); const status = ['not_reviewed', 'learning', 'comfortable'].includes(String(item.status)) ? item.status as 'not_reviewed' | 'learning' | 'comfortable' : 'not_reviewed'; return typeof item.text === 'string' ? [{ id: typeof item.id === 'string' ? item.id.slice(0, 80) : crypto.randomUUID(), text: item.text.slice(0, 160), status }] : []; }).slice(0, 40) : []]).slice(0, 80)),
      gradeNotes: stringRecord(raw.gradeNotes, 300),
      reflection: (() => { const item = safeRecord(raw.reflection); return typeof item.weekOf === 'string' ? { weekOf: item.weekOf.slice(0, 10), worked: typeof item.worked === 'string' ? item.worked.slice(0, 500) : '', heavy: typeof item.heavy === 'string' ? item.heavy.slice(0, 500) : '', change: typeof item.change === 'string' ? item.change.slice(0, 500) : '' } : null; })(),
      energy,
      bedtime: typeof raw.bedtime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.bedtime) ? raw.bedtime : toolkitDefaults.bedtime,
      sessionIntention: intention,
      topThree: strings(raw.topThree, 3),
      assignmentTools,
      routines,
      bagItems,
      noSchoolDays: strings(raw.noSchoolDays, 60).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
      commuteMode: raw.commuteMode === true,
      zenMode: raw.zenMode === true,
      autoTheme: raw.autoTheme === true,
      focusKind,
      focusAmbience,
      focusRitual: raw.focusRitual !== false,
      softLandings: stringRecord(raw.softLandings, 500),
      wins: Array.isArray(raw.wins) ? raw.wins.flatMap((entry) => { const item = safeRecord(entry); return typeof item.text === 'string' ? [{ id: typeof item.id === 'string' ? item.id.slice(0, 80) : crypto.randomUUID(), text: item.text.slice(0, 240), at: typeof item.at === 'string' ? item.at.slice(0, 40) : new Date().toISOString() }] : []; }).slice(-60) : [],
      examConfidence: stringRecord(raw.examConfidence, 240),
    };
  } catch {
    return toolkitDefaults;
  }
}

export function updateToolkit(patch: Partial<ToolkitState>): ToolkitState {
  const next = { ...readToolkit(), ...patch };
  try { localStorage.setItem(TOOLKIT_KEY, JSON.stringify(next)); } catch { /* optional local tools stay in memory */ }
  window.dispatchEvent(new Event(EXPERIENCE_EVENT));
  return next;
}

export function readGradeHistory(courseId?: string): GradeHistoryPoint[] {
  try {
    const value = JSON.parse(localStorage.getItem(GRADE_HISTORY_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    const safe = value.flatMap((entry): GradeHistoryPoint[] => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      if (typeof item.courseId !== 'string' || typeof item.score !== 'number' || !Number.isFinite(item.score) || typeof item.readAt !== 'string') return [];
      return [{ courseId: item.courseId.slice(0, 80), score: item.score, readAt: item.readAt }];
    }).slice(-300);
    return courseId ? safe.filter((point) => point.courseId === courseId) : safe;
  } catch {
    return [];
  }
}

export function recordGradeHistory(grades: CourseGrade[], readAt: string | null): void {
  if (!readAt) return;
  const previous = readGradeHistory();
  const additions = grades.flatMap((grade): GradeHistoryPoint[] => {
    if (grade.currentScore === null || !Number.isFinite(grade.currentScore)) return [];
    if (previous.some((point) => point.courseId === grade.externalCourseId && point.readAt === readAt)) return [];
    return [{ courseId: grade.externalCourseId, score: grade.currentScore, readAt }];
  });
  if (additions.length === 0) return;
  try { localStorage.setItem(GRADE_HISTORY_KEY, JSON.stringify([...previous, ...additions].slice(-300))); } catch { /* history is optional */ }
}

export function clearLocalExperienceData(): void {
  try {
    localStorage.removeItem(PREFS_KEY);
    localStorage.removeItem(GRADE_HISTORY_KEY);
    localStorage.removeItem(TOOLKIT_KEY);
    localStorage.removeItem('lockin.home-order.v1');
    localStorage.removeItem('lockin.dismissed.teacherChanges');
    localStorage.removeItem('lockin.assignments.layout');
    localStorage.removeItem('lockin.assignments.tabs');
  } catch { /* the reducer reset still clears the core state */ }
}
