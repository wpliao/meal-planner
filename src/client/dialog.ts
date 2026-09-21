import type { KeyboardEvent, RefObject } from 'react';

export const DIALOG_FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const dialogControls = (dialog: HTMLElement | null): HTMLElement[] =>
  Array.from(dialog?.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE) ?? []);

/**
 * Keeps a modal confirmation usable from the keyboard: Escape dismisses it
 * before submission, and Tab cycles within it so focus cannot reach the
 * still-rendered page behind an aria-modal dialog.
 */
export const handleDialogKeyDown = (
  event: KeyboardEvent<HTMLElement>,
  options: {
    dialog: RefObject<HTMLElement | null>;
    pending: boolean;
    onDismiss: () => void;
  },
): void => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (!options.pending) options.onDismiss();
    return;
  }
  if (event.key !== 'Tab') return;

  const controls = dialogControls(options.dialog.current);
  if (!controls.length) {
    event.preventDefault();
    options.dialog.current?.focus();
    return;
  }

  const [first] = controls;
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};
