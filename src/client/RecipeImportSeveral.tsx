import {
  Anchor,
  Box,
  Button,
  Group,
  List,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiRequestError, jsonMutation } from './api';
import {
  importContextFrom,
  importFailureMessage,
  touchLink,
} from './recipe-client';
import { ImportSites } from './RecipeImport';
import { RecipePage } from './RecipeParts';
import type { ApiErrorResponse } from '../shared/api';
import {
  planBulkImport,
  RECIPE_BULK_IMPORT_MAX_LINKS,
  type BulkImportLine,
  type CreateRecipeRequest,
  type RecipeDuplicateSourceResponse,
  type RecipeImportPreviewRequest,
  type RecipeImportPreviewResponse,
  type RecipeResponse,
  type RecipeUrlProblem,
} from '../shared/recipes';

type RowState =
  | { kind: 'waiting' }
  | { kind: 'importing' }
  | { kind: 'saved'; id: string; title: string; shortened: boolean }
  | { kind: 'existing'; id: string; title: string }
  | { kind: 'failed'; reason: string; retry: boolean }
  | { kind: 'repeat' }
  | { kind: 'skipped' };

interface Row {
  /** What the row shows: the link's host and path, or the pasted text. */
  label: string;
  /** The normalized link, or null for a line that is not one. */
  url: string | null;
  state: RowState;
}

/** Why a pasted line was refused before any request, as a row says it. */
const REFUSED: Readonly<Record<RecipeUrlProblem, string>> = {
  malformed: 'this link is not a web address',
  not_allowed: 'not a link from a supported site',
  too_long: 'this link is too long to import',
};

const UNREACHABLE = 'the app could not be reached';

const rowFor = (line: BulkImportLine): Row => {
  if (line.kind === 'refused') {
    return {
      label: line.line,
      url: null,
      state: { kind: 'failed', reason: REFUSED[line.problem], retry: false },
    };
  }
  const url = new URL(line.url);
  return {
    label: `${url.hostname}${url.pathname}`,
    url: line.url,
    state: line.kind === 'repeat' ? { kind: 'repeat' } : { kind: 'waiting' },
  };
};

const errorCode = (error: ApiRequestError): string | undefined =>
  (error.body as Partial<ApiErrorResponse> | undefined)?.error?.code;

/** A failed import preview: the single import's message for its class. */
const previewFailure = (error: unknown): RowState => ({
  kind: 'failed',
  reason:
    error instanceof ApiRequestError
      ? importFailureMessage(error)
      : UNREACHABLE,
  retry: true,
});

/**
 * Exactly what the single import sends when its unedited preview is saved,
 * plus the request to skip a link the library already has.
 */
const createRequestFrom = (
  preview: RecipeImportPreviewResponse,
): CreateRecipeRequest => ({
  title: preview.draft.title,
  notes: null,
  ingredients: preview.draft.ingredients,
  steps: preview.draft.steps,
  servings: preview.draft.servings,
  source: importContextFrom(preview).source,
  onlyIfNewSource: true,
});

/** Imports one link; `stop` is set when the library is full. */
const importLink = async (
  url: string,
): Promise<{ state: RowState; stop?: boolean }> => {
  let preview: RecipeImportPreviewResponse;
  try {
    const body: RecipeImportPreviewRequest = { url };
    preview = await api<RecipeImportPreviewResponse>(
      '/api/recipes/import-preview',
      jsonMutation('POST', body),
    );
  } catch (error: unknown) {
    return { state: previewFailure(error) };
  }

  try {
    const { recipe } = await api<RecipeResponse>(
      '/api/recipes',
      jsonMutation('POST', createRequestFrom(preview)),
    );
    return {
      state: {
        kind: 'saved',
        id: recipe.id,
        title: recipe.title,
        shortened: preview.notices.length > 0,
      },
    };
  } catch (error: unknown) {
    if (!(error instanceof ApiRequestError)) {
      return { state: { kind: 'failed', reason: UNREACHABLE, retry: true } };
    }
    const code = errorCode(error);
    if (code === 'duplicate_source') {
      const { existing } = error.body as RecipeDuplicateSourceResponse;
      return { state: { kind: 'existing', ...existing } };
    }
    if (code === 'limit_reached') {
      return {
        state: { kind: 'failed', reason: error.message, retry: false },
        stop: true,
      };
    }
    return { state: { kind: 'failed', reason: error.message, retry: true } };
  }
};

const summaryOf = (rows: readonly Row[]): string => {
  const count = (kind: RowState['kind']) =>
    rows.filter((row) => row.state.kind === kind).length;
  const parts = [
    `Saved ${count('saved')}`,
    ...(
      [
        ['already in the library', count('existing')],
        ['failed', count('failed')],
        ['listed twice', count('repeat')],
        ['not imported', count('skipped')],
      ] as const
    )
      .filter(([, total]) => total > 0)
      .map(([label, total]) => `${label} ${total}`),
  ];
  return `${parts.join(', ')}.`;
};

/** One row's state, in words; never colour alone. */
function RowResult({ state }: Readonly<{ state: RowState }>) {
  switch (state.kind) {
    case 'waiting':
      return <Text c="dimmed">Waiting</Text>;
    case 'importing':
      return <Text fw={600}>Importing…</Text>;
    case 'saved':
      return (
        <Stack gap={0}>
          <Text>
            Saved:{' '}
            <Anchor
              component={Link}
              style={touchLink}
              to={`/recipes/${state.id}`}
            >
              {state.title}
            </Anchor>
          </Text>
          {state.shortened && (
            <Text c="dimmed" fz="sm">
              Some text was shortened to fit.
            </Text>
          )}
        </Stack>
      );
    case 'existing':
      return (
        <Text>
          Already in the library:{' '}
          <Anchor
            component={Link}
            style={touchLink}
            to={`/recipes/${state.id}`}
          >
            {state.title}
          </Anchor>
        </Text>
      );
    case 'failed':
      return <Text c="clay.8">Failed: {state.reason}</Text>;
    case 'repeat':
      return <Text c="dimmed">Listed twice</Text>;
    case 'skipped':
      return <Text c="dimmed">Not imported</Text>;
  }
}

type Phase = 'entry' | 'running' | 'stopping' | 'done';

/**
 * `/recipes/import/several` (#116). A member pastes up to 20 links and the
 * screen imports them one at a time through the same preview as a single
 * link, saving each draft without review. The Worker refuses a link the
 * library already has, so a repeated batch saves nothing twice.
 *
 * The loop runs in this page: closing the page or leaving the screen stops it
 * after the link in flight, and what was saved stays saved.
 */
export function RecipeImportSeveral() {
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [phase, setPhase] = useState<Phase>('entry');
  const [status, setStatus] = useState('');
  const [retryLinks, setRetryLinks] = useState<string[]>([]);
  const stopRequested = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const running = phase === 'running' || phase === 'stopping';

  // Leaving the screen stops the batch after the link in flight.
  useEffect(
    () => () => {
      stopRequested.current = true;
    },
    [],
  );

  useEffect(() => {
    if (!running) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  useEffect(() => {
    if (phase === 'done') summary.current?.focus();
  }, [phase]);

  const run = async (planned: Row[]) => {
    const current = [...planned];
    const show = () => setRows([...current]);
    const queue = current
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.state.kind === 'waiting');

    for (const [position, { row, index }] of queue.entries()) {
      if (stopRequested.current) break;
      current[index] = { ...row, state: { kind: 'importing' } };
      show();
      setStatus(`Importing ${position + 1} of ${queue.length}`);
      const outcome = await importLink(row.url ?? '');
      current[index] = { ...row, state: outcome.state };
      show();
      if (outcome.stop) break;
    }

    current.forEach((row, index) => {
      if (row.state.kind === 'waiting') {
        current[index] = { ...row, state: { kind: 'skipped' } };
      }
    });
    show();
    setRetryLinks(
      current.flatMap((row) =>
        row.state.kind === 'failed' && row.state.retry && row.url
          ? [row.url]
          : [],
      ),
    );
    setStatus(summaryOf(current));
    setText('');
    setPhase('done');
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running) return;

    const plan = planBulkImport(text);
    if (!plan.ok) {
      setFieldError(
        plan.problem === 'empty'
          ? 'Paste at least one recipe link.'
          : `Paste up to ${RECIPE_BULK_IMPORT_MAX_LINKS} links at a time. You pasted ${plan.count}.`,
      );
      field.current?.focus();
      return;
    }
    setFieldError(undefined);
    stopRequested.current = false;
    const planned = plan.lines.map(rowFor);
    setRows(planned);
    setRetryLinks([]);
    setStatus('');
    setPhase('running');
    void run(planned);
  };

  const stop = () => {
    stopRequested.current = true;
    setPhase('stopping');
  };

  const retry = () => {
    setText(retryLinks.join('\n'));
    setRetryLinks([]);
    setFieldError(undefined);
    field.current?.focus();
  };

  return (
    <RecipePage
      back={{ to: '/recipes/import', label: 'Import a recipe' }}
      title="Import several links"
      titleId="recipe-import-several-title"
    >
      <form aria-busy={running} noValidate onSubmit={submit}>
        <Stack gap="lg">
          <Stack gap="xs">
            <Text>
              Paste links to recipe pages. This app will contact each website,
              one at a time, and save a copy of each recipe’s title,
              ingredients, and steps.
            </Text>
            <ImportSites />
          </Stack>

          <Textarea
            description={`One link per line, up to ${RECIPE_BULK_IMPORT_MAX_LINKS}. Each recipe is saved without a review step; you can edit it later.`}
            error={fieldError}
            label="Recipe links"
            onChange={(event) => setText(event.currentTarget.value)}
            readOnly={running}
            ref={field}
            rows={6}
            spellCheck={false}
            value={text}
          />

          <Stack gap="xs">
            <Group gap="sm">
              {running ? (
                <Button
                  disabled={phase === 'stopping'}
                  onClick={stop}
                  variant="default"
                >
                  {phase === 'stopping' ? 'Stopping…' : 'Stop'}
                </Button>
              ) : (
                <Button type="submit">Import links</Button>
              )}
              {phase === 'done' && retryLinks.length > 0 && (
                <Button onClick={retry} variant="default">
                  Retry failed links
                </Button>
              )}
            </Group>
            {running && (
              <Text c="dimmed" fz="sm">
                Keep this page open until the import finishes.
              </Text>
            )}
          </Stack>

          <Box
            aria-live="polite"
            data-testid="bulk-import-status"
            fw={phase === 'done' ? 600 : undefined}
            ref={summary}
            role="status"
            tabIndex={-1}
          >
            {status}
          </Box>

          {rows.length > 0 && (
            <List
              component="ol"
              data-testid="bulk-import-results"
              listStyleType="decimal"
              spacing="sm"
            >
              {rows.map((row, index) => (
                // Rows never reorder, and the same link can appear twice.
                <List.Item data-testid="bulk-import-row" key={index}>
                  <Text
                    fz="sm"
                    style={{ overflowWrap: 'anywhere' }}
                    title={row.url ?? row.label}
                    truncate="end"
                  >
                    {row.label}
                  </Text>
                  <RowResult state={row.state} />
                </List.Item>
              ))}
            </List>
          )}
        </Stack>
      </form>
    </RecipePage>
  );
}
