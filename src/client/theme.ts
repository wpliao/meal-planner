import {
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from '@mantine/core';

/**
 * Design tokens for the family interface.
 *
 * The palette approximates what the application already looked like, so the
 * migration to a component library does not also change how the product reads
 * to the family. Deliberate visual design is a separate, later change — taken
 * before visual-regression baselines settle further.
 *
 * Every colour here is a token. Components must take colour, spacing and
 * radius from the theme rather than hard-coding values, which is how the
 * destructive action came to be invisible in Phase 2: a local rule outranked
 * the shared one and nothing noticed.
 */

/** Deep kitchen green: primary actions and the current section. */
const sage: MantineColorsTuple = [
  '#eef4f0',
  '#dbe7e0',
  '#b5cec1',
  '#8db4a0',
  '#6c9e85',
  '#579073',
  '#4a8969',
  '#3a7658',
  '#31684d',
  '#215b41',
];

/** Warm terracotta: destructive actions and eyebrows. */
const clay: MantineColorsTuple = [
  '#fbeeeb',
  '#f2dbd6',
  '#e6b4ab',
  '#da8b7d',
  '#d06a57',
  '#cb553f',
  '#c94a32',
  '#b23b26',
  '#9f3320',
  '#8b2818',
];

/** Paper neutrals, biased warm so they sit on the cream ground. */
const paper: MantineColorsTuple = [
  '#faf7f1',
  '#f2ede4',
  '#e4dccf',
  '#d5caba',
  '#c8bba7',
  '#c0b19b',
  '#bcab93',
  '#a59580',
  '#938471',
  '#7f7260',
];

export const theme = createTheme({
  primaryColor: 'sage',
  primaryShade: 9,
  colors: { sage, clay, paper },
  white: '#fffdf9',
  black: '#2b2924',
  defaultRadius: 'md',
  radius: { sm: '0.4rem', md: '0.55rem', lg: '0.9rem', xl: '1.25rem' },
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  headings: {
    fontFamily:
      "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
    sizes: {
      h1: { fontSize: 'clamp(1.6rem, 4vw, 2.1rem)', lineHeight: '1.15' },
      h2: { fontSize: '1.45rem', lineHeight: '1.2' },
    },
  },
  components: {
    // Touch targets stay at least 44px, which the family uses on phones.
    Button: { defaultProps: { size: 'md' } },
    TextInput: { defaultProps: { size: 'md' } },
    Radio: { defaultProps: { size: 'md' } },
  },
});

/**
 * Mantine's default secondary text colour is `gray-6`, which measures 3.11:1
 * against this cream ground — below the 4.5:1 WCAG AA minimum for body text.
 * The visual suite's computed-contrast assertion caught it; nothing about the
 * page looked wrong.
 *
 * Secondary text gets its own token rather than borrowing the darkest paper
 * shade, because even `paper.9` only reaches 4.39:1 on the page background.
 * `#6f6454` measures 5.70:1 on a card and 5.42:1 on the page.
 */
const DIMMED = '#6f6454';

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: { '--mantine-color-dimmed': DIMMED },
  // Also in the light block: Mantine's own light value is written under a
  // colour-scheme selector, which outranks the scheme-independent one.
  light: { '--mantine-color-dimmed': DIMMED },
  dark: {},
});
