/**
 * Reminder escalation.
 *
 * LIMITATION (documented in the README): a website can only run timers while
 * one of its tabs is alive. There is no server and no push subscription, so
 * reminders fire when a LockIn tab is open — background throttling in Chrome
 * also slows timers in hidden tabs to roughly once a minute, which is why the
 * scheduler is written as "check what is overdue now" rather than "sleep until
 * exactly 6:10 PM". Each stage fires at most once per assignment, recorded in
 * `remindersFired`, so a reopened tab does not replay old reminders.
 *
 * In Strict mode the final stage arms Focus Mode automatically.
 */
import { useEffect, useRef } from 'react';
import { useApp } from '../store/context';
import { parseDueDate, todayISO } from '../lib/time';
import { isComplete } from '../lib/selectors';
import type { Assignment } from '../types';
import { toast } from '../components/ui/Toast';

const CHECK_INTERVAL_MS = 30_000;

type Stage = 'first' | 'escalation' | 'warning' | 'activated';

function notify(title: string, body: string) {
  toast(body, 'info');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: 'lockin-reminder' });
    } catch {
      /* Some platforms require a service-worker notification; the toast still shows. */
    }
  }
}

export function useReminders(): void {
  const { state, dispatch } = useApp();
  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  /** Planned sessions already announced this session; not persisted. */
  const firedPlanItems = useRef(new Set<string>());

  useEffect(() => {
    const check = () => {
      const s = stateRef.current;
      if (!s.profile?.onboarded) return;
      const now = Date.now();
      const mode = s.settings.reminderMode;

      /**
       * Planned sessions (Phase 7).
       *
       * The planner produces a start time; this reuses the same notifier the
       * due-date reminders use rather than adding a second notification
       * engine. Fired ids live in a ref, not in state: a nudge that was
       * already shown does not need to survive a reload, and persisting it
       * would mean writing to storage on a timer.
       *
       * The browser limitation from the top of this file applies unchanged —
       * this only fires while a LockIn tab is open.
       */
      const today = todayISO(new Date(now));
      const plannedToday = s.planner.plan?.days.find((d) => d.date === today);
      for (const item of plannedToday?.items ?? []) {
        if (!item.startTime || firedPlanItems.current.has(item.id)) continue;
        const at = parseDueDate(today, item.startTime);
        if (!at) continue;
        const minutesUntil = (at.getTime() - now) / 60_000;
        // A window, not an instant: hidden tabs are throttled to about a
        // minute, so "exactly 5:00 PM" would simply never be observed.
        if (minutesUntil > 0 || minutesUntil < -10) continue;
        const source =
          item.sourceType === 'assignment'
            ? s.assignments.find((a) => a.id === item.sourceId)
            : s.exams.find((e) => e.id === item.sourceId);
        if (!source) continue;
        if (item.sourceType === 'assignment' && isComplete(source as Assignment)) continue;
        firedPlanItems.current.add(item.id);
        notify(
          'Planned study session',
          `${item.title} — ${item.plannedMinutes} min, from your plan.`,
        );
      }

      for (const a of s.assignments) {
        if (isComplete(a) || !a.reminders.enabled) continue;
        const due = parseDueDate(a.dueDate, a.dueTime);
        if (!due) continue;
        const minutesLeft = (due.getTime() - now) / 60_000;
        if (minutesLeft < -720) continue; // more than 12h overdue: stop nagging

        const stages: { stage: Stage; at: number; title: string; body: string }[] = [
          {
            stage: 'first',
            at: a.reminders.firstReminderMinutes,
            title: 'Study reminder',
            body: `“${a.title}” is due soon. Estimated ${a.estimatedMinutes} min.`,
          },
          {
            stage: 'escalation',
            at: a.reminders.escalationMinutes,
            title: 'Still unfinished',
            body: `“${a.title}” is still unfinished — want to start a focus session?`,
          },
          {
            stage: 'warning',
            at: a.reminders.focusWarningMinutes,
            title: 'Focus Mode warning',
            body:
              mode === 'Strict'
                ? `“${a.title}” is close to due. Focus Mode will turn on shortly.`
                : `“${a.title}” is close to due.`,
          },
        ];

        for (const s2 of stages) {
          if (minutesLeft <= s2.at && !a.remindersFired.includes(s2.stage)) {
            notify(s2.title, s2.body);
            dispatchRef.current({ type: 'MARK_REMINDER_FIRED', id: a.id, stage: s2.stage });
          }
        }

        // Strict mode: five minutes past the focus warning, arm Focus Mode.
        const activateAt = a.reminders.focusWarningMinutes - 5;
        if (
          mode === 'Strict' &&
          !s.focusMode.active &&
          minutesLeft <= activateAt &&
          !a.remindersFired.includes('activated')
        ) {
          dispatchRef.current({ type: 'MARK_REMINDER_FIRED', id: a.id, stage: 'activated' });
          dispatchRef.current({
            type: 'START_FOCUS_MODE',
            requiredTaskIds: [a.id],
            requiredCompletionCount: 1,
          });
          notify('Focus Mode activated', `Strict mode turned on Focus Mode for “${a.title}”.`);
          break;
        }
      }
    };

    check();
    const id = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);
}

/** Called from Settings / after onboarding — never on first paint. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}
