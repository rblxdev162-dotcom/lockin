/**
 * Minimal toast system. A module-level emitter means any module (including
 * non-React helpers) can call `toast(...)` without threading a context.
 */
import { useEffect, useState } from 'react';
import { cx } from '../../lib/cx';

export type ToastTone = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l(items));
}

export function toast(
  message: string,
  tone: ToastTone = 'info',
  action?: { label: string; run: () => void },
) {
  const item = { id: nextId++, message, tone, action };
  items = [...items, item];
  emit();
  window.setTimeout(() => {
    items = items.filter((i) => i.id !== item.id);
    emit();
  }, 4000);
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'animate-pop pointer-events-auto max-w-sm rounded-2xl border px-4 py-3 text-sm font-semibold shadow-lg backdrop-blur',
            t.tone === 'success' && 'border-mint-500/40 bg-mint-500/95 text-white',
            t.tone === 'error' && 'border-flame-500/40 bg-flame-600/95 text-white',
            t.tone === 'info' && 'lk-border lk-raised lk-strong',
          )}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="ml-3 rounded-lg border border-current/30 px-2 py-1 text-xs font-extrabold hover:bg-black/10"
              onClick={() => {
                t.action?.run();
                items = items.filter((item) => item.id !== t.id);
                emit();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
