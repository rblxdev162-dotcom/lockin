/**
 * Focus Guard — the honest thing a website can do about distraction.
 *
 * LockIn cannot block websites from a web page. There is no browser permission
 * for it: `navigator.permissions` reaches the camera, the microphone, location
 * and notifications, and nothing that can touch another origin. Real blocking
 * needs the extension. That is a browser security boundary, not a gap.
 *
 * What a page *can* do is notice that it stopped being looked at, using the
 * Page Visibility API. Two states, no permission, and — this is the important
 * part — it reports only `visible` / `hidden`. It cannot report *why* the page
 * is hidden or *where* the student went. That limitation is why this feature
 * is acceptable at all: LockIn can say "you were away for four minutes" and
 * also say, truthfully, "I have no idea where you were."
 *
 * ## Why not the Idle Detection API
 *
 * Chrome ships one. It would tell us whether the student is physically at the
 * machine. **Mozilla declared it harmful** — "user-surveillance and
 * user-control concerns … can be used for monitoring a user's usage patterns,
 * and manipulating them accordingly" — and will not implement it. WebKit
 * refused it on the same grounds. Two browser vendors independently called it
 * a surveillance vector, and an app whose position is "accountability, not
 * surveillance" does not get to use it. Do not add it later.
 *
 * ## Why this is soft, and why that is deliberate
 *
 * The digital-self-control literature is consistent that hard blocking works
 * and is *abandoned*, because being overridden reads as paternalistic and
 * provokes reactance. Commitment-device studies show soft pledges get far
 * higher take-up while enforced restriction is stronger for the minority who
 * accept it — neither dominates. So LockIn offers both: Focus Guard needs no
 * setup and admits it cannot stop you, and the extension enforces for real.
 *
 * Everything here is therefore **observation, not obstruction**. Nothing in
 * this file prevents an action, and nothing in it may. See
 * `docs/research/2026-08-ethical-self-control-design.md`.
 */

/** One stretch of the student being somewhere other than this tab. */
export interface AwayPeriod {
  /** Epoch ms when the tab became hidden. */
  leftAt: number;
  /** Epoch ms when it became visible again; absent while still away. */
  returnedAt?: number;
}

export interface FocusGuardTally {
  /** Completed trips away. An in-progress one is not counted until it ends. */
  count: number;
  /** Total milliseconds away, including any trip still in progress. */
  totalMs: number;
  /** True while the student is away right now. */
  away: boolean;
  /** Milliseconds of the current trip, or 0 when present. */
  currentMs: number;
}

/**
 * A trip shorter than this is not counted at all.
 *
 * Switching tabs to check a due date, answering a notification, or an OS
 * window flicker are not distraction, and counting them would make the tally
 * noise — which is how a well-meant metric turns into something the student
 * learns to ignore. Five seconds is long enough to exclude the flicker and
 * short enough to catch a real departure.
 */
export const AWAY_GRACE_MS = 5_000;

/** Ignores trips under the grace period; open trips count from `leftAt`. */
export function tally(periods: readonly AwayPeriod[], now: number): FocusGuardTally {
  let count = 0;
  let totalMs = 0;
  let currentMs = 0;
  let away = false;

  for (const period of periods) {
    if (period.returnedAt === undefined) {
      // An open period: the student is away as we compute this.
      away = true;
      currentMs = Math.max(0, now - period.leftAt);
      if (currentMs >= AWAY_GRACE_MS) totalMs += currentMs;
      continue;
    }
    const duration = Math.max(0, period.returnedAt - period.leftAt);
    if (duration < AWAY_GRACE_MS) continue;
    count += 1;
    totalMs += duration;
  }

  return { count, totalMs, away, currentMs };
}

/**
 * Folds a visibility change into the list.
 *
 * Written as a pure reducer over the periods so the same function serves the
 * hook, the store and the tests, and so a missed event cannot corrupt the
 * list: going hidden while already hidden, or visible while already visible,
 * are both no-ops rather than a second open period.
 */
export function applyVisibility(
  periods: readonly AwayPeriod[],
  visible: boolean,
  now: number,
): AwayPeriod[] {
  const last = periods[periods.length - 1];
  const openPeriod = last && last.returnedAt === undefined ? last : null;

  if (!visible) {
    if (openPeriod) return periods as AwayPeriod[];
    return [...periods, { leftAt: now }];
  }

  if (!openPeriod) return periods as AwayPeriod[];
  return [...periods.slice(0, -1), { ...openPeriod, returnedAt: now }];
}

/**
 * How LockIn talks about a tally.
 *
 * Deliberately flat. The research on friction-based tools is that reactance —
 * "this is annoying, I'm turning it off" — is the main failure mode, and guilt
 * is the fastest route to it. Forest's mechanism is the model: make the cost
 * *visible*, never punish. So: no "you failed", no "you wasted", no red, no
 * exclamation marks. A number, and a fact.
 */
export function describeTally(t: FocusGuardTally): string {
  if (t.away) return 'You’re away from LockIn right now.';
  if (t.count === 0) return 'You’ve stayed on this tab the whole session.';
  const minutes = Math.round(t.totalMs / 60_000);
  const trips = `${t.count} time${t.count === 1 ? '' : 's'}`;
  if (minutes < 1) return `You left ${trips}, for under a minute in total.`;
  return `You left ${trips}, for about ${minutes} minute${minutes === 1 ? '' : 's'} in total.`;
}

/** `4m 05s`, for a live counter. */
export function formatAway(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
