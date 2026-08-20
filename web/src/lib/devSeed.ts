/**
 * A realistic profile for developer testing (Phase 8).
 *
 * LockIn ships no sample data — a student's first run is genuinely empty, and
 * "Load demo data" is exactly the kind of button that turns into a bypass.
 * But a developer evaluating the app needs a device that looks lived-in, and
 * building one by hand takes ten minutes every time.
 *
 * So this exists, and three things keep it out of production:
 *
 *  1. It is only imported from a branch guarded by `import.meta.env.DEV`,
 *     which Rollup evaluates to `false` at build time and eliminates.
 *  2. It throws if it somehow runs in a production build.
 *  3. `extension/tests/release.test.mjs` fails the release if the string
 *     `lockinSeed` appears anywhere in `web/dist`.
 *
 * Everything it writes is *unverified*. It cannot create a verified Canvas
 * submission or a verified Edgenuity reading, because those only come from the
 * real detection paths — seeding one would be inventing evidence, which is the
 * single thing LockIn must never do, in any build.
 *
 * Use it from the browser console on a dev server:
 *
 *     lockinSeed()        // write the profile and reload
 *     lockinSeed.clear()  // wipe and start over
 */
import { STORAGE_KEY, defaultState } from './storage';
import { createAssignment, createExam } from '../store/factories';
import { addDaysISO, todayISO } from './time';
import type { AppState } from '../types';

function assertDev() {
  if (!import.meta.env.DEV) {
    throw new Error('The LockIn dev seed is not available in a production build.');
  }
}

function seedState(): AppState {
  const base = defaultState();
  const today = todayISO();
  const now = new Date().toISOString();

  const assignments = [
    { title: 'Chapter 7 problem set', subject: 'Math', platform: 'Canvas' as const, day: 0, minutes: 45 },
    { title: 'Lab report: photosynthesis', subject: 'Science', platform: 'Canvas' as const, day: 1, minutes: 90 },
    { title: 'Read chapters 4–6', subject: 'English', platform: 'Other' as const, day: 2, minutes: 60 },
    { title: 'Algebra I unit 3', subject: 'Math', platform: 'Other' as const, day: 3, minutes: 120 },
    { title: 'Spanish vocab quiz prep', subject: 'Spanish', platform: 'Other' as const, day: -1, minutes: 30 },
  ].map((a, i) =>
    createAssignment({
      title: a.title,
      subject: a.subject,
      platform: a.platform,
      dueDate: addDaysISO(today, a.day),
      dueTime: '23:59',
      estimatedMinutes: a.minutes,
      priority: a.day <= 0 ? 'Urgent' : i % 2 === 0 ? 'Important' : 'Normal',
    }),
  );
  // One assignment part-done, so "remaining = estimate − logged" has something
  // to show rather than always being the whole estimate.
  assignments[0] = { ...assignments[0], loggedMinutes: 20, status: 'In Progress' };

  const exams = [
    createExam({
      name: 'Biology midterm',
      subject: 'Science',
      examDate: addDaysISO(today, 9),
      materialAmount: 'Heavy',
    }),
    createExam({
      name: 'Spanish oral exam',
      subject: 'Spanish',
      examDate: addDaysISO(today, 16),
      materialAmount: 'Medium',
    }),
  ];

  const completedSessions = Array.from({ length: 6 }, (_, i) => ({
    id: `seed_ses_${i}`,
    assignmentId: assignments[i % assignments.length].id,
    examId: null,
    assignmentTitle: assignments[i % assignments.length].title,
    plannedMinutes: 25,
    actualMinutes: 25 - (i % 3) * 5,
    startedAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
    endedAt: new Date(Date.now() - (i + 1) * 86_400_000 + 1_500_000).toISOString(),
  }));

  return {
    ...base,
    profile: { firstName: 'Sam', onboarded: true, createdAt: now },
    assignments,
    exams,
    completedSessions,
    settings: {
      ...base.settings,
      reminderMode: 'Focused',
      blockedDomains: ['youtube.com', 'reddit.com', 'tiktok.com'],
    },
    planner: {
      ...base.planner,
      settings: { ...base.planner.settings, configured: true },
    },
    activity: [
      {
        id: 'seed_evt_1',
        type: 'focus_mode_completed' as const,
        timestamp: new Date(Date.now() - 86_400_000).toISOString(),
        message: 'Focus Mode completed — 2 of 2 required tasks done',
      },
    ],
  };
}

declare global {
  interface Window {
    lockinSeed?: (() => void) & { clear?: () => void };
  }
}

/** Installs `lockinSeed()` on `window`. Called only from a DEV-guarded branch. */
export function installDevSeed(): void {
  assertDev();
  const seed = () => {
    assertDev();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedState()));
    console.info('[LockIn] dev profile seeded — reloading');
    window.location.href = '/home';
  };
  seed.clear = () => {
    assertDev();
    localStorage.removeItem(STORAGE_KEY);
    console.info('[LockIn] local data cleared — reloading');
    window.location.href = '/';
  };
  window.lockinSeed = seed;
  console.info('[LockIn] development build. `lockinSeed()` writes a test profile, `lockinSeed.clear()` wipes it.');
}
