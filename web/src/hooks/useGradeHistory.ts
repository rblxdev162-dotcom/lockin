import { useEffect } from 'react';
import { useApp } from '../store/context';
import { recordGradeHistory } from '../lib/localExperience';

export function useGradeHistory(): void {
  const { state } = useApp();
  useEffect(() => {
    recordGradeHistory(state.grades.courses, state.grades.lastReadAt);
  }, [state.grades.courses, state.grades.lastReadAt]);
}
