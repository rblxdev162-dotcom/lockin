import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon';

const PHASES = [
  'Planning study sessions',
  'Organizing deadlines',
  'Preparing your focus space',
] as const;

/**
 * Shown once per page load, tracked in module scope rather than
 * `sessionStorage`.
 *
 * LockIn writes exactly one key to browser storage — the state itself — and
 * `parent-e2e` pins that as a privacy invariant, checking that nothing else
 * accumulates anywhere a page can read. A cosmetic "already played" flag is
 * not worth being the exception that makes the invariant untrue, and it is not
 * worth a reader of that test having to decide whether this one is harmless.
 *
 * The only behavioural difference: reloading the tab plays the animation
 * again, where the old flag suppressed it. That is the more honest reading of
 * "first load" anyway — a reload *is* a first load.
 */
let bootPlayed = false;

export function BootSequence() {
  const [visible, setVisible] = useState(() => !bootPlayed);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!visible) return;
    bootPlayed = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      const end = window.setTimeout(() => setVisible(false), 500);
      return () => window.clearTimeout(end);
    }
    const ticker = window.setInterval(() => setPhase((value) => Math.min(PHASES.length - 1, value + 1)), 520);
    const end = window.setTimeout(() => setVisible(false), 1850);
    return () => { window.clearInterval(ticker); window.clearTimeout(end); };
  }, [visible]);

  if (!visible) return null;
  return (
    <div className="lk-boot fixed inset-0 z-[100] grid place-items-center overflow-hidden p-6" role="status" aria-live="polite" aria-label={`Locking In. ${PHASES[phase]}`}>
      <div className="lk-boot-orbit" aria-hidden="true"><i/><i/><i/></div>
      <div className="relative z-10 text-center">
        <span className="lk-boot-mark mx-auto grid h-16 w-16 place-items-center rounded-[1.35rem] text-white"><Icon name="lock" size={29}/></span>
        <p className="mt-6 text-[clamp(2rem,7vw,3.5rem)] font-black tracking-[-0.045em] text-white">Locking In</p>
        <p key={phase} className="lk-boot-phase mt-2 text-body font-semibold text-white/65">{PHASES[phase]}</p>
        <div className="mx-auto mt-6 h-1 w-44 overflow-hidden rounded-full bg-white/10" aria-hidden="true"><span className="lk-boot-progress block h-full rounded-full bg-white"/></div>
      </div>
    </div>
  );
}
