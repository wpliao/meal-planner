import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Mantine's per-component stylesheets are not independent. A `Button` is also
 * an `UnstyledButton`, a `Card` is also a `Paper`: the rules share a root
 * element and have equal specificity, so the sheet imported last wins.
 *
 * Importing them alphabetically put `UnstyledButton.css` after `Button.css`
 * and stripped the background, padding and border from every button on the
 * site. Nothing failed — not the behaviour tests, and not the visual suite,
 * whose baselines were regenerated against the broken rendering.
 *
 * So the order is checked against Mantine's own: `@mantine/core/styles.css` is
 * the components concatenated in the order they must be applied.
 */

const CORE = resolve(process.cwd(), 'node_modules/@mantine/core');
const combined = `${CORE}/styles.css`;

/** Sheets that define variables or reset the page; they lead, in this order. */
const PREAMBLE = ['baseline', 'default-css-variables', 'global'];

const imported = readFileSync(
  resolve(process.cwd(), 'src/client/mantine.ts'),
  'utf8',
)
  .split('\n')
  .flatMap((line) => {
    const match = /^import '@mantine\/core\/styles\/(.+)\.css';$/u.exec(line);
    return match ? [match[1]] : [];
  });

/** Where Mantine itself places a component's rules in the combined sheet. */
const positionOf = (name: string): number => {
  const sheet = readFileSync(`${CORE}/styles/${name}.css`, 'utf8');
  const firstSelector = /\.m_[a-z0-9]+/u.exec(sheet);
  expect(firstSelector, `no hashed selector in ${name}.css`).not.toBeNull();
  const position = readFileSync(combined, 'utf8').indexOf(firstSelector![0]);
  expect(position, `${name}.css is not part of styles.css`).toBeGreaterThan(-1);
  return position;
};

describe('Mantine stylesheet imports', () => {
  it('leads with the baseline and variables', () => {
    expect(imported.slice(0, PREAMBLE.length)).toEqual(PREAMBLE);
  });

  it('orders components the way Mantine concatenates them', () => {
    const components = imported.slice(PREAMBLE.length);
    expect(components.length).toBeGreaterThan(0);

    const positions = components.map(positionOf);
    const sorted = components
      .map((name, index) => ({ name, at: positions[index] }))
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.name);

    expect(components).toEqual(sorted);
  });
});
