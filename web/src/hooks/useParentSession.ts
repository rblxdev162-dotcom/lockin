/**
 * The unlocked-Parent-Dashboard session.
 *
 * Deliberately in-memory only. It is not in the reducer, not in `localStorage`
 * and not in `sessionStorage`, which makes three security properties true by
 * construction rather than by remembering to clean up:
 *
 *   - a reload re-locks the dashboard,
 *   - restarting the browser re-locks it,
 *   - "Exit Parent View" is instant and complete.
 *
 * It also idles out, so a dashboard left open on the kitchen table does not
 * stay unlocked. None of this is a security boundary against someone holding
 * the device — see the honesty note in the Privacy panel.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ParentSession } from '../types/parent';
import {
  createParentSession,
  isParentSessionValid,
  touchParentSession,
} from '../types/parent';

export interface ParentSessionView {
  session: ParentSession | null;
  unlocked: boolean;
  /** Seconds until the session idles out; 0 when locked. */
  secondsLeft: number;
  unlock: () => void;
  lock: () => void;
  /** Push the idle timeout out after real interaction. */
  keepAlive: () => void;
}

export function useParentSession(now: number): ParentSessionView {
  const [session, setSession] = useState<ParentSession | null>(null);

  const unlocked = isParentSessionValid(session, now);

  // Drop the expired session object so nothing downstream reads a stale one.
  useEffect(() => {
    if (session && !isParentSessionValid(session, now)) setSession(null);
  }, [session, now]);

  const unlock = useCallback(() => setSession(createParentSession()), []);
  const lock = useCallback(() => setSession(null), []);
  const keepAlive = useCallback(() => {
    setSession((current) =>
      current && isParentSessionValid(current) ? touchParentSession(current) : current,
    );
  }, []);

  return {
    session,
    unlocked,
    secondsLeft: unlocked && session ? Math.max(0, Math.round((session.expiresAt - now) / 1000)) : 0,
    unlock,
    lock,
    keepAlive,
  };
}
