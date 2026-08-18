import { useApp } from '../../store/context';
import { Icon } from '../ui/Icon';
import { cx } from '../../lib/cx';

const OPTIONS = [
  { value: 'light', icon: 'sun', label: 'Light' },
  { value: 'dark', icon: 'moon', label: 'Dark' },
  { value: 'system', icon: 'bolt', label: 'Auto' },
] as const;

export function ThemeToggle() {
  const { state, dispatch } = useApp();
  return (
    <div className="lk-sunken flex rounded-xl border lk-border p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          title={`${o.label} theme`}
          aria-label={`${o.label} theme`}
          aria-pressed={state.settings.theme === o.value}
          onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { theme: o.value } })}
          className={cx(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-colors',
            state.settings.theme === o.value
              ? 'lk-raised lk-strong shadow-sm'
              : 'lk-muted hover:lk-strong',
          )}
        >
          <Icon name={o.icon} size={15} />
          {o.label}
        </button>
      ))}
    </div>
  );
}
