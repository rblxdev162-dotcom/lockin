import { useState } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { TextInput } from '../ui/Field';
import { Badge } from '../ui/Badge';
import { normalizeDomain, prettyDomain } from '../../lib/domains';
import { cx } from '../../lib/cx';

export function DomainListEditor({
  domains,
  placeholder,
  emptyHint,
  protectedDomains = [],
  shadowed = [],
  onAdd,
  onRemove,
  suggestions = [],
}: {
  domains: string[];
  placeholder: string;
  emptyHint: string;
  /** Removing one of these prompts a warning first (handled by the caller). */
  protectedDomains?: string[];
  /** Blocklist entries neutralised by the allowlist. */
  shadowed?: string[];
  onAdd: (domain: string) => void;
  onRemove: (domain: string) => void;
  suggestions?: string[];
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = normalizeDomain(value);
    if (!result.ok || !result.domain) {
      setError(result.error);
      return;
    }
    if (domains.includes(result.domain)) {
      setError(`${result.domain} is already on this list.`);
      return;
    }
    setError(undefined);
    setValue('');
    onAdd(result.domain);
  };

  const unusedSuggestions = suggestions.filter((s) => !domains.includes(s));

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <div className="flex-1">
          <TextInput
            value={value}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => {
              setValue(e.target.value);
              setError(undefined);
            }}
          />
        </div>
        <Button type="submit" icon={<Icon name="plus" size={16} />}>
          Add
        </Button>
      </form>
      {error && (
        <p className="text-sm font-semibold text-flame-600 dark:text-flame-400">{error}</p>
      )}

      {domains.length === 0 ? (
        <p className="rounded-2xl border border-dashed lk-border p-4 text-center text-sm lk-muted">
          {emptyHint}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {domains.map((d) => {
            const isDefault = protectedDomains.includes(d);
            const isShadowed = shadowed.includes(d);
            return (
              <li
                key={d}
                className={cx(
                  'lk-sunken flex items-center justify-between gap-3 rounded-xl border lk-border px-3.5 py-2.5',
                  isShadowed && 'opacity-70',
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold lk-strong">{prettyDomain(d)}</p>
                  <p className="truncate text-xs lk-muted">{d}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isDefault && <Badge tone="brand">Default</Badge>}
                  {isShadowed && <Badge tone="amber">Allowed — never blocked</Badge>}
                  <button
                    onClick={() => onRemove(d)}
                    aria-label={`Remove ${d}`}
                    className="rounded-lg p-1.5 lk-muted hover:bg-flame-400/15 hover:text-flame-600"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {unusedSuggestions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold tracking-wide lk-muted uppercase">Suggestions</p>
          <div className="flex flex-wrap gap-2">
            {unusedSuggestions.map((s) => (
              <button
                key={s}
                onClick={() => onAdd(s)}
                className="rounded-full border border-dashed lk-border px-3 py-1.5 text-sm font-semibold lk-muted transition-colors hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300"
              >
                + {prettyDomain(s)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
