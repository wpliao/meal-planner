import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, jsonMutation } from './api';
import { AddToPlanDialog } from './MealPlanDialogs';
import { AdjustableRecipeBody } from './RecipeAmounts';
import { RecipeNutritionSection } from './RecipeNutrition';
import { instantDayLabel } from './meal-plan-client';
import {
  notNowActive,
  type RecipePreferenceChange,
  type RecipePreferencesResponse,
} from '../shared/recipe-preferences';
import {
  RecipeNotice,
  RecipePage,
  RecipeUnavailable,
  SourceLink,
} from './RecipeParts';
import {
  conflictFrom,
  RECIPES_BACK_LINK,
  failureMessage,
  isNotFound,
  safeRecipeLink,
  safeSourceHref,
  setRecipeFlash,
  useRecipe,
  useRecipeFlash,
} from './recipe-client';

export function RecipeDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const {
    state,
    setState,
    load,
    preferences,
    setPreferences,
    nutrition,
    setNutrition,
  } = useRecipe(id);
  const [notice, setNotice] = useRecipeFlash();
  const [confirming, setConfirming] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const planTrigger = useRef<HTMLButtonElement>(null);

  if (state.kind !== 'ready') {
    return <RecipeUnavailable retry={() => void load()} state={state} />;
  }
  const { recipe } = state;

  const cancelDelete = () => {
    setConfirming(false);
    deleteTrigger.current?.focus();
  };

  const remove = async () => {
    setPending(true);
    setNotice(null);
    try {
      await api<void>(
        `/api/recipes/${encodeURIComponent(recipe.id)}`,
        jsonMutation('DELETE', { version: recipe.version }),
      );
      setRecipeFlash({
        tone: 'success',
        message: `“${recipe.title}” was deleted.`,
      });
      void navigate('/recipes', { replace: true });
    } catch (error: unknown) {
      const current = conflictFrom(error);
      if (current) {
        // Nothing was deleted. Show what the other member saved; deleting
        // again now applies to that version.
        setState({ kind: 'ready', recipe: current });
        setConfirming(false);
        setNotice({
          tone: 'error',
          message:
            'Another member changed this recipe since you opened it, so it was not deleted. The latest version is shown; delete again if you still want to.',
        });
      } else if (isNotFound(error)) {
        setRecipeFlash({
          tone: 'success',
          message: `“${recipe.title}” had already been deleted.`,
        });
        void navigate('/recipes', { replace: true });
      } else {
        setConfirming(false);
        setNotice({
          tone: 'error',
          message: failureMessage(
            error,
            'The recipe could not be deleted. Check your connection and try again.',
          ),
        });
      }
    } finally {
      setPending(false);
    }
  };

  const href = safeSourceHref(recipe.source);
  const link = safeRecipeLink(recipe.link);

  /** Sets or clears a household preference; the recipe itself is untouched. */
  const changePreference = async (
    change: RecipePreferenceChange,
    done?: string,
  ) => {
    setSaving(true);
    setNotice(null);
    try {
      const response = await api<RecipePreferencesResponse>(
        `/api/recipes/${encodeURIComponent(recipe.id)}/preferences`,
        jsonMutation('PUT', change),
      );
      setPreferences(response.preferences);
      if (done) setNotice({ tone: 'success', message: done });
    } catch (error: unknown) {
      setNotice({
        tone: 'error',
        message: failureMessage(error, 'That could not be saved. Try again.'),
      });
    } finally {
      setSaving(false);
    }
  };
  const hiddenUntil =
    preferences.notNowUntil && notNowActive(preferences.notNowUntil, new Date())
      ? preferences.notNowUntil
      : null;

  return (
    <RecipePage
      back={RECIPES_BACK_LINK}
      title={recipe.title}
      titleId="recipe-title"
    >
      <RecipeNotice notice={notice} />

      <Stack gap="xs" mb="lg">
        {recipe.source.kind === 'website' ? (
          <>
            <Text c="dimmed" fz="sm">
              Copied from {recipe.source.host} on{' '}
              {new Date(recipe.source.importedAt).toLocaleDateString()}
            </Text>
            {href && <SourceLink host={recipe.source.host} href={href} />}
          </>
        ) : (
          <>
            <Text c="dimmed" fz="sm">
              Entered by hand
            </Text>
            {link && <SourceLink host={link.host} href={link.href} />}
          </>
        )}
        {recipe.servings !== null && (
          <Text c="dimmed" fz="sm">
            Serves {recipe.servings}
          </Text>
        )}
        <Text c="dimmed" fz="sm">
          Last changed {new Date(recipe.updatedAt).toLocaleDateString()}
        </Text>
      </Stack>

      {hiddenUntil && (
        <Group data-testid="recipe-not-now" gap="sm" mb="lg">
          <Text fz="sm">
            Hidden from suggestions until {instantDayLabel(hiddenUntil)}.
          </Text>
          <Button
            disabled={saving}
            onClick={() =>
              void changePreference(
                { notNow: false },
                `“${recipe.title}” can be suggested again.`,
              )
            }
            size="sm"
            variant="default"
          >
            Show in suggestions
          </Button>
        </Group>
      )}

      <AdjustableRecipeBody
        afterIngredients={
          nutrition && (
            <RecipeNutritionSection
              nutrition={nutrition}
              onRecipeChanged={() => void load()}
              onSaved={setNutrition}
              recipeId={recipe.id}
            />
          )
        }
        idPrefix="recipe"
        recipe={recipe}
      />

      <Group gap="sm" mt="xl">
        <Button onClick={() => setPlanning(true)} ref={planTrigger}>
          Add to plan
        </Button>
        {/* One name in both states, so the pressed state is what changes. */}
        <Button
          aria-label="Mark as favourite"
          aria-pressed={preferences.favourite}
          disabled={saving}
          leftSection={
            <span aria-hidden="true">{preferences.favourite ? '★' : '☆'}</span>
          }
          onClick={() =>
            void changePreference({ favourite: !preferences.favourite })
          }
          variant={preferences.favourite ? 'light' : 'default'}
        >
          {preferences.favourite ? 'Favourite' : 'Mark as favourite'}
        </Button>
        <Button
          component={Link}
          state={{ from: 'detail' }}
          to="edit"
          variant="default"
        >
          Edit recipe
        </Button>
        <Button
          color="clay"
          onClick={() => setConfirming(true)}
          ref={deleteTrigger}
          variant="outline"
        >
          Delete recipe
        </Button>
      </Group>

      {/*
        Mantine's Modal traps focus inside the dialog while it is open. Its own
        focus return is off: it returns to whatever was focused on opening,
        and Safari does not focus a button on click, so Cancel and Escape put
        focus back on the Delete button explicitly. A result closes the
        dialog too, and then the result message takes focus instead.
      */}
      <Modal
        centered
        closeOnClickOutside={!pending}
        closeOnEscape={!pending}
        onClose={cancelDelete}
        opened={confirming}
        returnFocus={false}
        title={`Delete “${recipe.title}”?`}
      >
        <Stack aria-busy={pending} gap="md">
          <Text>
            This deletes the recipe from the shared family library for everyone.
            It cannot be undone. Meals already planned with it stay on the plan
            under its title.
          </Text>
          <Group justify="flex-end">
            <Button
              color="clay"
              disabled={pending}
              onClick={() => void remove()}
            >
              Delete recipe
            </Button>
            <Button disabled={pending} onClick={cancelDelete} variant="default">
              Cancel
            </Button>
          </Group>
        </Stack>
      </Modal>
      {planning && (
        <AddToPlanDialog
          onClose={() => {
            setPlanning(false);
            planTrigger.current?.focus();
          }}
          recipe={recipe}
        />
      )}
    </RecipePage>
  );
}
