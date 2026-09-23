import {
  Anchor,
  Button,
  Card,
  Group,
  Stack,
  Text,
  VisuallyHidden,
} from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import { RecipeNotice, RecipePage } from './RecipeParts';
import { sourceLabel, touchLink, useRecipeFlash } from './recipe-client';
import type { RecipeSummary, RecipesResponse } from '../shared/recipes';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; recipes: RecipeSummary[] }
  | { kind: 'unavailable' };

/** The household's shared recipe library, most recently changed first. */
export function Recipes() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [notice] = useRecipeFlash();

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const response = await api<RecipesResponse>('/api/recipes');
      setState({ kind: 'ready', recipes: response.recipes });
    } catch {
      setState({ kind: 'unavailable' });
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <RecipePage eyebrow="Kitchen" title="Recipes" titleId="recipes-title">
      <RecipeNotice notice={notice} />

      <Group justify="space-between" mb="md">
        <Text c="dimmed">
          The family’s shared recipes. Everyone in the family can add and change
          them.
        </Text>
        <Button component={Link} state={{ from: 'list' }} to="/recipes/new">
          Add recipe
        </Button>
      </Group>

      {state.kind === 'loading' && (
        <Text component="output">Checking your recipes…</Text>
      )}

      {state.kind === 'unavailable' && (
        <Stack align="flex-start" gap="sm">
          <Text component="output">
            We could not load the recipes. Please try again.
          </Text>
          <Button onClick={() => void load()} variant="default">
            Retry
          </Button>
        </Stack>
      )}

      {state.kind === 'ready' && state.recipes.length === 0 && (
        <Text c="dimmed" data-testid="recipes-empty">
          No recipes yet. Add one the family cooks with a title, its
          ingredients, and its steps.
        </Text>
      )}

      {state.kind === 'ready' && state.recipes.length > 0 && (
        <Stack
          component="ul"
          data-testid="recipe-list"
          gap="sm"
          p={0}
          style={{ listStyle: 'none' }}
        >
          {state.recipes.map((recipe) => (
            <Card
              component="li"
              data-testid="recipe-item"
              key={recipe.id}
              padding="sm"
              radius="md"
              withBorder
            >
              <Anchor
                component={Link}
                fw={600}
                fz="lg"
                style={{ ...touchLink, overflowWrap: 'anywhere' }}
                to={`/recipes/${recipe.id}`}
              >
                {recipe.title}
              </Anchor>
              <Text c="dimmed" fz="sm">
                <VisuallyHidden>Source: </VisuallyHidden>
                {sourceLabel(recipe.source)}
              </Text>
            </Card>
          ))}
        </Stack>
      )}
    </RecipePage>
  );
}
