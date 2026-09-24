import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The open modal, once it has settled: visible, its opening transition
 * finished, and focus inside it.
 *
 * Mantine animates a modal in and moves focus into it on a timer after it
 * mounts. Until both have happened, a click can land on a button that is
 * still moving, and a key can go to the control that opened the modal; a
 * Mantine menu item keeps Escape to itself. Under the load of the full gate,
 * WebKit lost an Escape and a click in exactly that gap (#65), so a test waits
 * here before it acts on a modal it has just opened.
 */
export const openedDialog = async (page: Page): Promise<Locator> => {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) =>
          element.contains(document.activeElement) &&
          // Only finite animations: a loader spins forever by design.
          element
            .getAnimations({ subtree: true })
            .every(
              (animation) =>
                animation.playState !== 'running' ||
                animation.effect?.getTiming().iterations === Infinity,
            ),
      ),
    )
    .toBe(true);
  return dialog;
};
