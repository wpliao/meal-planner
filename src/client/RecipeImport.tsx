import {
  Alert,
  Anchor,
  Button,
  Group,
  List,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useRef, useState, type SubmitEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, jsonMutation } from './api';
import { RecipeCreate } from './RecipeEditPages';
import { RecipePage } from './RecipeParts';
import {
  checkImportUrl,
  draftFromPreview,
  importContextFrom,
  importFailureMessage,
  RECIPES_BACK_LINK,
  touchLink,
} from './recipe-client';
import {
  recipeImportSites,
  RECIPE_IMPORT_TIMEOUT_MS,
  type RecipeImportPreviewRequest,
  type RecipeImportPreviewResponse,
} from '../shared/recipes';

/** How the screen describes its own bound, from the shared constant. */
const TIMEOUT_SECONDS = Math.round(RECIPE_IMPORT_TIMEOUT_MS / 1000);

type ImportState =
  | { kind: 'entry' }
  | { kind: 'contacting'; host: string }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; preview: RecipeImportPreviewResponse };

/** The supported sites, as both import screens list them. */
export function ImportSites() {
  return (
    <>
      <Text c="dimmed" fz="sm">
        Only these sites can be imported, over https:
      </Text>
      <List data-testid="import-sites" fz="sm" spacing={2}>
        {recipeImportSites().map((site) => (
          <List.Item key={site}>{site}</List.Item>
        ))}
      </List>
    </>
  );
}

/** The one place that says the family's application will contact a site. */
function WhatHappens() {
  return (
    <Stack gap="xs">
      <Text>
        Paste the link to a recipe page. This app will contact that website and
        copy the recipe’s title, ingredients, and steps so you can check them.
        Nothing is saved until you review the copy and choose Save.
      </Text>
      <ImportSites />
    </Stack>
  );
}

/**
 * `/recipes/import`. A member submits one link; the Worker fetches and reads
 * the page and returns a draft. On success this becomes the ordinary new
 * recipe form, pre-filled and carrying its provenance, so reviewing an import
 * and writing a recipe by hand are the same screen and the same save.
 *
 * The link is never fetched from the browser: it goes to the Worker, which
 * owns the destination, redirect, and size limits.
 */
export function RecipeImport() {
  const [url, setUrl] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [state, setState] = useState<ImportState>({ kind: 'entry' });
  const field = useRef<HTMLInputElement>(null);

  if (state.kind === 'ready') {
    return (
      <RecipeCreate
        importContext={importContextFrom(state.preview)}
        initialDraft={draftFromPreview(state.preview)}
      />
    );
  }

  const run = async (target: URL) => {
    setState({ kind: 'contacting', host: target.hostname });
    const body: RecipeImportPreviewRequest = { url: target.href };
    try {
      const preview = await api<RecipeImportPreviewResponse>(
        '/api/recipes/import-preview',
        jsonMutation('POST', body),
      );
      setState({ kind: 'ready', preview });
    } catch (error: unknown) {
      setState({ kind: 'failed', message: importFailureMessage(error) });
      // Back to the link, which is still there to correct or replace.
      field.current?.focus();
    }
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind === 'contacting') return;

    const checked = checkImportUrl(url);
    if (!checked.ok) {
      setFieldError(checked.message);
      setState({ kind: 'entry' });
      field.current?.focus();
      return;
    }
    setFieldError(undefined);
    void run(checked.url);
  };

  const contacting = state.kind === 'contacting';

  return (
    <RecipePage
      back={RECIPES_BACK_LINK}
      title="Import a recipe"
      titleId="recipe-import-title"
    >
      <form aria-busy={contacting} noValidate onSubmit={submit}>
        <Stack gap="lg">
          <WhatHappens />

          {state.kind === 'failed' && (
            <Alert
              color="clay"
              data-testid="import-failed"
              role="status"
              style={{ overflowWrap: 'anywhere' }}
              title="That recipe could not be imported"
            >
              {state.message}
            </Alert>
          )}

          <TextInput
            description="The full address of the recipe page, starting with https://."
            error={fieldError}
            inputMode="url"
            label="Recipe page link"
            onChange={(event) => setUrl(event.currentTarget.value)}
            placeholder="https://www.justonecookbook.com/…"
            ref={field}
            type="url"
            value={url}
          />

          <Anchor
            component={Link}
            fz="sm"
            style={touchLink}
            to="/recipes/import/several"
          >
            Import several links
          </Anchor>

          {contacting && (
            <Text component="output" data-testid="import-progress">
              Contacting {state.host}… This can take up to {TIMEOUT_SECONDS}{' '}
              seconds. It stops on its own if the site does not answer.
            </Text>
          )}

          <Stack gap="xs">
            <Group gap="sm">
              <Button disabled={contacting} type="submit">
                {contacting ? 'Contacting the site…' : 'Get the recipe'}
              </Button>
              <Button
                component={Link}
                disabled={contacting}
                state={{ from: 'import' }}
                to="/recipes/new"
                variant="default"
              >
                Enter it by hand
              </Button>
            </Group>
            <Text c="dimmed" fz="sm">
              Importing never changes the website, and the family’s recipes are
              never sent to it.
            </Text>
          </Stack>
        </Stack>
      </form>
    </RecipePage>
  );
}
