import { useEffect } from 'react';
import { useApp } from '../store/context';

/** Applies the `dark` class to <html>, following the OS when set to `system`. */
export function useTheme(): void {
  const { state } = useApp();
  const theme = state.settings.theme;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
