import { useEffect } from 'react';
import { useApp } from '../store/context';
import { EXPERIENCE_EVENT, readExperience, readToolkit } from '../lib/localExperience';

/** Applies the `dark` class to <html>, following the OS when set to `system`. */
export function useTheme(): void {
  const { state } = useApp();
  const theme = state.settings.theme;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      const toolkit = readToolkit();
      const hour = new Date().getHours();
      const scheduled = hour < 8 ? 'aurora' : hour < 15 ? 'ocean' : hour < 19 ? 'sunset' : 'midnight';
      document.documentElement.dataset.background = toolkit.autoTheme ? scheduled : readExperience().background.toLowerCase();
    };
    apply();
    window.addEventListener(EXPERIENCE_EVENT, apply);
    if (theme === 'system') media.addEventListener('change', apply);
    return () => {
      if (theme === 'system') media.removeEventListener('change', apply);
      window.removeEventListener(EXPERIENCE_EVENT, apply);
    };
  }, [theme]);
}
