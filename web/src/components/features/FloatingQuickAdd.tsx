import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { QuickAdd } from './QuickAdd';

export function FloatingQuickAdd() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="lk-quick-add fixed right-5 bottom-24 z-30 grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-900/30 lg:right-7 lg:bottom-7"
        aria-label="Quick add assignment or thought"
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size={21} />
      </button>
      <Modal open={open} title="Quick add" subtitle="Capture it before it leaves your head." onClose={() => setOpen(false)}>
        <QuickAdd autoFocus />
      </Modal>
    </>
  );
}
