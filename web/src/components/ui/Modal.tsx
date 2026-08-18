import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/**
 * The one dialog in LockIn. Every modal, confirmation and PIN prompt goes
 * through it, which is why the accessibility work lives here rather than being
 * repeated (and forgotten) at eleven call sites.
 *
 * What it guarantees:
 *   - focus moves into the dialog when it opens
 *   - Tab and Shift+Tab stay inside it
 *   - Escape closes it
 *   - focus returns to whatever opened it
 *   - it is announced with its own title, and its subtitle as the description
 *
 * Escape closing is safe for every dialog LockIn has: none of them is a
 * destructive step that a stray key should complete, and the parent PIN
 * prompts fail closed — dismissing one grants nothing.
 */
/**
 * Where focus goes when a dialog closes.
 *
 * Module-level, and deferred, because two things make the obvious
 * component-level ref wrong:
 *
 *  1. **StrictMode double-invokes effects in development.** Setup runs, is
 *     torn down, and runs again immediately. A naive implementation records
 *     the opener on the first setup, gives focus back on the first teardown,
 *     and then re-records "the dialog's own first field" on the second setup
 *     — so closing the dialog for real returns focus to nothing.
 *  2. **Call sites swap components while a dialog is open.** `PinModal`
 *     switches between a PIN prompt and a "set a new PIN" form; `DataPanel`
 *     replaces a confirmation with a PIN prompt. A remount gives the component
 *     fresh refs and loses the opener, stranding keyboard users on `<body>`.
 *
 * Both are the same shape — a teardown immediately followed by a setup — so
 * both are handled the same way: the restore is *scheduled* rather than done,
 * and an incoming dialog can claim the pending target as its own opener.
 */
let pendingRestore: { target: HTMLElement | null; frame: number } | null = null;

/** Claims a scheduled restore, cancelling it. Returns its target if there was one. */
function claimPendingRestore(): { claimed: boolean; target: HTMLElement | null } {
  if (!pendingRestore) return { claimed: false, target: null };
  clearTimeout(pendingRestore.frame);
  const { target } = pendingRestore;
  pendingRestore = null;
  return { claimed: true, target };
}

function scheduleRestore(target: HTMLElement | null, allowed: () => boolean) {
  // A timeout rather than `requestAnimationFrame`: rAF does not fire in a
  // backgrounded or hidden tab, and a dialog closed just before the tab loses
  // focus would then never give focus back. The delay only needs to outlast
  // React's own teardown-then-setup, which is synchronous.
  const frame = window.setTimeout(() => {
    pendingRestore = null;
    // Only take focus back if it is still ours to take, and the element is
    // still on the page. If something else has claimed focus since, stealing
    // it would be the rude option.
    if (allowed() && target?.isConnected) target.focus?.();
  }, 0);
  pendingRestore = { target, frame };
}

export function Modal({ open, title, subtitle, onClose, children, footer, wide }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  /**
   * `onClose` is almost always an inline arrow at the call site, so its
   * identity changes on every render of the parent. Depending on it directly
   * would tear this effect down and set it up again constantly. Keeping it in
   * a ref lets the effect depend on `open` alone.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /**
   * The element to give focus back to, captured during *render*.
   *
   * This cannot wait for the effect. Several LockIn dialogs put `autoFocus` on
   * their first field — which is the right thing for a student typing a PIN —
   * and React applies `autoFocus` while committing the DOM, before passive
   * effects run. By the time an effect could look, `document.activeElement` is
   * already the dialog's own input, and the dialog would "return" focus to
   * itself. Render is the last moment the opener is still focused.
   *
   * Reading `document.activeElement` here is a read of browser state, not a
   * mutation, and the `wasOpenRef` guard makes it idempotent under StrictMode's
   * double render.
   */
  const wasOpenRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  if (open && !wasOpenRef.current) {
    wasOpenRef.current = true;
    const pending = claimPendingRestore();
    openerRef.current = pending.claimed
      ? pending.target
      : (document.activeElement as HTMLElement | null);
  } else if (!open && wasOpenRef.current) {
    wasOpenRef.current = false;
  }

  useEffect(() => {
    if (!open) return;

    const opener = openerRef.current;

    // Captured for the cleanup closure: by the time it runs, `panelRef.current`
    // is already null, so reading it there would skip the containment check and
    // steal focus back from whatever legitimately has it.
    const panel = panelRef.current;

    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      // Wrap at both ends. Without this, Tab walks out of the dialog and into
      // the page behind it, which is still rendered and still focusable.
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Prefer the first control over the panel itself: a screen-reader user
    // lands on something actionable, and a keyboard user's first Tab does not
    // skip the primary field. A field with `autoFocus` has already claimed
    // focus by now, and it knows better than we do — leave it alone.
    if (!panel?.contains(document.activeElement)) {
      const items = focusable();
      (items[0] ?? panel)?.focus();
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      scheduleRestore(opener, () => {
        const active = document.activeElement;
        return !active || active === document.body || !!panel?.contains(active);
      });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        className={cx(
          'lk-raised animate-rise max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border lk-border p-6 shadow-2xl outline-none sm:rounded-3xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="mb-5">
          <h2 id={titleId} className="text-lg font-bold tracking-tight lk-strong">
            {title}
          </h2>
          {subtitle && (
            <p id={subtitleId} className="mt-1 text-sm lk-muted">
              {subtitle}
            </p>
          )}
        </div>
        {children}
        {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm lk-muted">{message}</div>
    </Modal>
  );
}
