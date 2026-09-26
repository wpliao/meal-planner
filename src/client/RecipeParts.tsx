import {
  Alert,
  Anchor,
  Button,
  Card,
  List,
  Stack,
  Text,
  Title,
  type TitleOrder,
} from '@mantine/core';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Notice } from './api';
import {
  RECIPES_BACK_LINK,
  touchLink,
  type RecipeLoadState,
} from './recipe-client';
import type { Recipe } from '../shared/recipes';

/**
 * Recipe text is always rendered as React text children. Nothing in these
 * components passes recipe content to `innerHTML` or a markup renderer: an
 * imported title such as `<b>x</b>` must read literally, and the Content
 * Security Policy allows inline styles, so injected markup is not harmless.
 */

const wrap = { overflowWrap: 'anywhere' } as const;

/** The shared frame of every recipe screen. */
export function RecipePage({
  titleId,
  title,
  eyebrow = 'Recipes',
  back,
  children,
}: Readonly<{
  titleId: string;
  title: ReactNode;
  eyebrow?: string;
  back?: { to: string; label: string };
  children: ReactNode;
}>) {
  return (
    <Card
      aria-labelledby={titleId}
      component="section"
      data-testid="recipe-panel"
      padding="lg"
      radius="lg"
      withBorder
    >
      {back && (
        <Anchor component={Link} fz="sm" style={touchLink} to={back.to}>
          <span aria-hidden="true">←&nbsp;</span>
          {back.label}
        </Anchor>
      )}
      <Text c="clay.8" fw={700} fz="xs" tt="uppercase">
        {eyebrow}
      </Text>
      <Title id={titleId} mb="md" order={1} style={wrap}>
        {title}
      </Title>
      {children}
    </Card>
  );
}

/**
 * A result message. It takes focus when it appears so a screen reader hears
 * it and a phone scrolls to it; see DESIGN_SYSTEM.md rule 7.
 */
export function RecipeNotice({ notice }: Readonly<{ notice: Notice }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) ref.current?.focus();
  }, [notice]);
  if (!notice) return null;
  return (
    <Alert
      color={notice.tone === 'success' ? 'sage' : 'clay'}
      data-testid="recipe-result"
      mb="md"
      ref={ref}
      role="status"
      style={wrap}
      tabIndex={-1}
    >
      {notice.message}
    </Alert>
  );
}

/** Ingredients in their entered order, numbered steps, and notes. */
export function RecipeBody({
  recipe,
  headingOrder = 2,
  idPrefix,
  afterIngredients,
}: Readonly<{
  recipe: Pick<Recipe, 'ingredients' | 'steps' | 'notes'>;
  headingOrder?: TitleOrder;
  idPrefix: string;
  /** Shown between the ingredients and the steps, such as nutrition. */
  afterIngredients?: ReactNode;
}>) {
  return (
    <Stack gap="lg">
      <section aria-labelledby={`${idPrefix}-ingredients`}>
        <Title id={`${idPrefix}-ingredients`} mb="xs" order={headingOrder}>
          Ingredients
        </Title>
        <List data-testid="recipe-ingredients" spacing="xs">
          {recipe.ingredients.map((line, index) => (
            <List.Item key={`${index}-${line}`} style={wrap}>
              {line}
            </List.Item>
          ))}
        </List>
      </section>
      {afterIngredients}
      <section aria-labelledby={`${idPrefix}-steps`}>
        <Title id={`${idPrefix}-steps`} mb="xs" order={headingOrder}>
          Steps
        </Title>
        <List data-testid="recipe-steps" spacing="sm" type="ordered">
          {recipe.steps.map((step, index) => (
            <List.Item key={`${index}-${step}`} style={wrap}>
              {step}
            </List.Item>
          ))}
        </List>
      </section>
      {recipe.notes && (
        <section aria-labelledby={`${idPrefix}-notes`}>
          <Title id={`${idPrefix}-notes`} mb="xs" order={headingOrder}>
            Notes
          </Title>
          <Text
            data-testid="recipe-notes"
            style={{ ...wrap, whiteSpace: 'pre-wrap' }}
          >
            {recipe.notes}
          </Text>
        </section>
      )}
    </Stack>
  );
}

/**
 * A link to the website a recipe was copied from. It opens a new tab without
 * giving the page a handle on this one or a referrer, and its name says where
 * it goes and that it opens a new tab.
 */
export function SourceLink({
  href,
  host,
}: Readonly<{ href: string; host: string }>) {
  return (
    <Anchor
      href={href}
      rel="noopener noreferrer"
      style={{ ...touchLink, ...wrap }}
      target="_blank"
    >
      Open the original recipe on {host} (opens in a new tab)
    </Anchor>
  );
}

/** The loading, missing, and failure states of a single-recipe screen. */
export function RecipeUnavailable({
  state,
  retry,
}: Readonly<{
  state: Exclude<RecipeLoadState, { kind: 'ready' }>;
  retry: () => void;
}>) {
  if (state.kind === 'loading') {
    return (
      <RecipePage
        back={RECIPES_BACK_LINK}
        title="Recipe"
        titleId="recipe-title"
      >
        <Text component="output">Opening the recipe…</Text>
      </RecipePage>
    );
  }
  if (state.kind === 'not-found') {
    return (
      <RecipePage
        back={RECIPES_BACK_LINK}
        title="Recipe not found"
        titleId="recipe-title"
      >
        <Text>
          This recipe is not in your family’s library. It may have been deleted.
        </Text>
      </RecipePage>
    );
  }
  return (
    <RecipePage back={RECIPES_BACK_LINK} title="Recipe" titleId="recipe-title">
      <Stack align="flex-start" gap="sm">
        <Text component="output">
          We could not load this recipe. Please try again.
        </Text>
        <Button onClick={retry} variant="default">
          Retry
        </Button>
      </Stack>
    </RecipePage>
  );
}
