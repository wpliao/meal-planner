import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, jsonMutation, type Notice } from './api';
import { RecipeEditor } from './RecipeEditor';
import { RecipeBody, RecipePage, RecipeUnavailable } from './RecipeParts';
import {
  changedFields,
  conflictFrom,
  RECIPES_BACK_LINK,
  draftFromRecipe,
  EMPTY_RECIPE_DRAFT,
  failureMessage,
  isNotFound,
  setRecipeFlash,
  useRecipe,
  type RecipeEditorDraft,
  type RecipeImportContext,
} from './recipe-client';
import type {
  CreateRecipeRequest,
  Recipe,
  RecipeContent,
  RecipeResponse,
  UpdateRecipeRequest,
} from '../shared/recipes';

const SAVE_FALLBACK =
  'The recipe could not be saved. Check your connection and try again; your changes are still here.';

/** Where the member came from, so Cancel and Save can go back rather than forward. */
const cameFrom = (state: unknown): string | null =>
  typeof state === 'object' && state !== null && 'from' in state
    ? String(state.from)
    : null;

export interface RecipeCreateProps {
  /** Pre-fills the form, for example with an import preview. */
  initialDraft?: RecipeEditorDraft;
  /** Website provenance of an imported draft; sent with the create request. */
  importContext?: RecipeImportContext;
}

/**
 * `/recipes/new`. A website import renders this with the extracted draft and
 * its source, so manual and imported recipes share one form and one save.
 */
export function RecipeCreate({
  initialDraft = EMPTY_RECIPE_DRAFT,
  importContext,
}: RecipeCreateProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const save = async (content: RecipeContent) => {
    setPending(true);
    setNotice(null);
    const body: CreateRecipeRequest = {
      ...content,
      ...(importContext ? { source: importContext.source } : {}),
    };
    try {
      const { recipe } = await api<RecipeResponse>(
        '/api/recipes',
        jsonMutation('POST', body),
      );
      setRecipeFlash({
        tone: 'success',
        message: `“${recipe.title}” was saved to the family recipes.`,
      });
      // Replace the form in history: going back from the new recipe returns
      // to where the member started, not to an empty form.
      void navigate(`/recipes/${recipe.id}`, { replace: true });
    } catch (error: unknown) {
      setPending(false);
      setNotice({
        tone: 'error',
        message: failureMessage(error, SAVE_FALLBACK),
      });
    }
  };

  const cancel = () => {
    if (cameFrom(location.state) === 'list') {
      void navigate(-1);
    } else {
      void navigate('/recipes');
    }
  };

  return (
    <RecipePage
      back={RECIPES_BACK_LINK}
      title={importContext ? 'Review imported recipe' : 'New recipe'}
      titleId="recipe-editor-title"
    >
      <RecipeEditor
        importContext={importContext}
        initialDraft={initialDraft}
        notice={notice}
        onCancel={cancel}
        onSubmit={(content) => void save(content)}
        pending={pending}
        submitLabel="Save recipe"
      />
    </RecipePage>
  );
}

const fieldList = (fields: string[]): string => {
  if (fields.length <= 1) return fields.join('');
  return `${fields.slice(0, -1).join(', ')} and ${fields.at(-1)}`;
};

/**
 * Shown when a save was refused because another member saved first. The
 * member's draft stays in the form below; this shows what is saved now.
 */
function ConflictPanel({
  current,
  draft,
  onKeep,
  onDiscard,
}: {
  current: Recipe;
  draft: RecipeContent;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [current]);
  const changed = changedFields(draft, current);

  return (
    <Card
      aria-labelledby="recipe-conflict-title"
      bg="clay.0"
      component="section"
      data-testid="recipe-conflict"
      padding="md"
      radius="md"
      ref={ref}
      tabIndex={-1}
      withBorder
    >
      <Title id="recipe-conflict-title" order={2}>
        Another member changed this recipe
      </Title>
      <Text mt="xs">
        Your changes have not been saved. The latest saved version is below;
        your draft is still in the form.
        {changed.length > 0 &&
          ` Your draft differs in its ${fieldList(changed)}.`}
      </Text>

      <Card mt="md" padding="md" radius="md" withBorder>
        <Text c="dimmed" fz="sm">
          Latest saved version
        </Text>
        <Title order={3} style={{ overflowWrap: 'anywhere' }}>
          {current.title}
        </Title>
        <Stack mt="sm">
          <RecipeBody headingOrder={4} idPrefix="conflict" recipe={current} />
        </Stack>
      </Card>

      <Group gap="sm" mt="md">
        <Button onClick={onKeep}>Keep my changes</Button>
        <Button onClick={onDiscard} variant="default">
          Discard my changes
        </Button>
      </Group>
    </Card>
  );
}

/** `/recipes/:id/edit`. */
export function RecipeEdit() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, load } = useRecipe(id);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [conflict, setConflict] = useState<{
    current: Recipe;
    draft: RecipeContent;
  } | null>(null);

  if (state.kind !== 'ready') {
    return <RecipeUnavailable retry={() => void load()} state={state} />;
  }
  const { recipe } = state;
  const version = baseVersion ?? recipe.version;

  // Back to the recipe: a step back in history when the member came from
  // it, so the device back button does not return to the form.
  const leave = (flash: Notice) => {
    setRecipeFlash(flash);
    if (cameFrom(location.state) === 'detail') {
      void navigate(-1);
    } else {
      void navigate(`/recipes/${recipe.id}`, { replace: true });
    }
  };

  const save = async (content: RecipeContent) => {
    setPending(true);
    setNotice(null);
    const body: UpdateRecipeRequest = { version, ...content };
    try {
      await api<RecipeResponse>(
        `/api/recipes/${encodeURIComponent(recipe.id)}`,
        jsonMutation('PATCH', body),
      );
      leave({ tone: 'success', message: 'Your changes were saved.' });
    } catch (error: unknown) {
      setPending(false);
      const current = conflictFrom(error);
      if (current) {
        setConflict({ current, draft: content });
      } else if (isNotFound(error)) {
        setNotice({
          tone: 'error',
          message:
            'This recipe was deleted by another member, so your changes could not be saved. Your draft is still here if you want to copy it.',
        });
      } else {
        setNotice({
          tone: 'error',
          message: failureMessage(error, SAVE_FALLBACK),
        });
      }
    }
  };

  const keepMine = () => {
    if (!conflict) return;
    // The draft now builds on the version the other member saved, so the
    // next save is an informed replacement rather than a silent one.
    setBaseVersion(conflict.current.version);
    setConflict(null);
    setNotice({
      tone: 'success',
      message:
        'Your changes are kept. Choose Save changes to replace the latest version with them.',
    });
  };

  return (
    <RecipePage
      back={{ to: `/recipes/${recipe.id}`, label: 'Back to the recipe' }}
      title={`Edit “${recipe.title}”`}
      titleId="recipe-editor-title"
    >
      <RecipeEditor
        blockedReason={
          conflict
            ? 'Choose whether to keep or discard your changes first.'
            : undefined
        }
        initialDraft={draftFromRecipe(recipe)}
        notice={notice}
        onCancel={() => leave(null)}
        onSubmit={(content) => void save(content)}
        pending={pending}
        submitLabel="Save changes"
      >
        {conflict && (
          <ConflictPanel
            current={conflict.current}
            draft={conflict.draft}
            onDiscard={() =>
              leave({
                tone: 'success',
                message:
                  'Your changes were discarded. This is the latest version.',
              })
            }
            onKeep={keepMine}
          />
        )}
      </RecipeEditor>
    </RecipePage>
  );
}
