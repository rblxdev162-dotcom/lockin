/**
 * The planner's actions, in one place.
 *
 * Every one of these is a dispatch plus (at most) a navigation. Nothing here
 * decides what to schedule — that lives in `lib/planner/`, which is pure and
 * has no idea React exists.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/context';
import type { PlannedWorkItem } from '../types';
import { sourceKey } from '../types/planner';
import { todayISO } from '../lib/time';
import { orderKeys, selectTodayPlan } from '../lib/planner';
import { toast } from '../components/ui/Toast';

export function usePlanner() {
  const { state, dispatch, now } = useApp();
  const navigate = useNavigate();
  const today = todayISO(new Date(now));

  /**
   * Starts the existing focus timer on a planned item.
   *
   * The planner never runs a timer of its own; it pre-fills the one the app
   * already has with the assignment (or exam) and the planned length.
   */
  const startItem = useCallback(
    (item: PlannedWorkItem) => {
      dispatch({
        type: 'START_SESSION',
        assignmentId: item.sourceType === 'assignment' ? item.sourceId : null,
        examId: item.sourceType === 'exam' ? item.sourceId : null,
        plannedItemId: item.id,
        minutes: Math.min(240, Math.max(1, item.plannedMinutes)),
      });
      navigate('/focus');
      toast(`${item.plannedMinutes}-minute session started on “${item.title}”.`, 'success');
    },
    [dispatch, navigate],
  );

  /** "I can't do this today" — planning, not restriction avoidance. No PIN. */
  const skipItem = useCallback(
    (item: PlannedWorkItem) => {
      dispatch({
        type: 'PLANNER_SKIP_ITEM',
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        date: item.scheduledDate,
      });
      toast('Moved off today. The rest of the plan was updated.', 'info');
    },
    [dispatch],
  );

  const reorderToday = useCallback(
    (item: PlannedWorkItem, direction: -1 | 1) => {
      const day = selectTodayPlan(state, new Date(now));
      if (!day) return;
      const keys = orderKeys(day.items);
      const key = sourceKey(item.sourceType, item.sourceId);
      const index = keys.indexOf(key);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= keys.length) return;
      const next = [...keys];
      [next[index], next[target]] = [next[target], next[index]];
      dispatch({ type: 'PLANNER_SET_ORDER', date: day.date, order: next });
    },
    [dispatch, state, now],
  );

  /**
   * Starts Focus Mode from today's plan.
   *
   * The planner decides *what* should be done; Focus Mode decides *what is
   * blocked*. This is the one place they meet, and it only passes assignment
   * ids: exam revision is measured in minutes and cannot be "completed", so
   * counting it as a required task would create a way to unlock by sitting
   * through a timer.
   */
  const startFocusFromPlan = useCallback(() => {
    const day = selectTodayPlan(state, new Date(now));
    const ids = [
      ...new Set(
        (day?.items ?? [])
          .filter((i) => i.sourceType === 'assignment' && i.status !== 'completed')
          .map((i) => i.sourceId),
      ),
    ];
    if (ids.length === 0) {
      toast('Today’s plan has no assignment work to require.', 'info');
      return false;
    }
    dispatch({
      type: 'START_FOCUS_MODE',
      requiredTaskIds: ids,
      requiredCompletionCount: ids.length,
    });
    toast('Focus Mode is on. Distractions are blocked until today’s work is done.', 'success');
    return true;
  }, [dispatch, state, now]);

  const rebuild = useCallback(() => {
    dispatch({ type: 'PLANNER_REBUILD' });
  }, [dispatch]);

  const setLock = useCallback(
    (locked: boolean) => dispatch({ type: 'PLANNER_SET_LOCK', date: today, locked }),
    [dispatch, today],
  );

  return {
    today,
    locked: state.planner.lockedDates.includes(today),
    startItem,
    skipItem,
    reorderToday,
    startFocusFromPlan,
    rebuild,
    setLock,
  };
}
