import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach } from 'vitest';

afterEach(() => cleanup());

/**
 * Mantine can leave a transition timer running after its component has gone
 * (#71). Its exit transition starts in an animation frame that calls
 * `flushSync`; if that flush unmounts the component, the frame still goes on
 * to schedule the exit timer, after the unmount cleanup, so nothing clears it.
 * Vitest's jsdom `window.setTimeout` is
 * Node's, so tearing jsdom down does not stop the timer either. If it fires
 * after teardown, React reads `window` and the run fails with "window is not
 * defined" even though every test passed.
 *
 * Waiting past Mantine's longest exit transition before each test file ends
 * lets any such timer fire while `window` still exists. It hides nothing: an
 * error thrown by the timer is still reported. The app sets no
 * `transitionProps`; if it ever sets a longer duration, raise this.
 */
const LONGEST_MANTINE_EXIT_MS = 250;
// Taken now, before any test can install fake timers.
const realSetTimeout = globalThis.setTimeout;
afterAll(
  () =>
    new Promise<void>((resolve) => {
      realSetTimeout(resolve, LONGEST_MANTINE_EXIT_MS + 50);
    }),
);

/**
 * jsdom implements neither of these, and Mantine uses both — matchMedia for
 * colour-scheme and responsive props, ResizeObserver for overlay positioning.
 * Without them every component render throws.
 */
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
