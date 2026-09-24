import {
  Alert,
  Anchor,
  Button,
  Group,
  Modal,
  NativeSelect,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
  type ComboboxItem,
  type OptionsFilter,
} from '@mantine/core';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, jsonMutation } from './api';
import {
  checkDate,
  checkMoveDate,
  checkNote,
  checkTitle,
  clientWriteWindow,
  dayLabel,
  describeEntry,
  entryConflictFrom,
  filterRecipes,
  hasErrors,
  isEntryGone,
  MEAL_SLOT_OPTIONS,
  placeLabel,
  planFailure,
  today,
  weekPath,
  type EntryFieldErrors,
} from './meal-plan-client';
import {
  isMealSlot,
  validateMealPlanTitle,
  MEAL_PLAN_NOTE_MAX_LENGTH,
  MEAL_PLAN_TITLE_MAX_LENGTH,
  planWeekStart,
  type MealPlanEntry,
  type MealPlanEntryResponse,
  type MealSlot,
  type PlanDateWindow,
  type UpdateMealPlanEntryRequest,
} from '../shared/meal-plan';
import type { RecipeSummary, RecipesResponse } from '../shared/recipes';

/**
 * The plan's dialogs. Each is mounted when it opens, so it starts from its
 * props with no stale state. Every one keeps what the member typed when a
 * save fails, shows validation next to its control, and renders plan text only
 * as React text — never as markup.
 */

const wrap = { overflowWrap: 'anywhere' } as const;

/** What a dialog reports back to the week when it closes. */
export type DialogOutcome =
  | { kind: 'cancelled' }
  | { kind: 'saved'; message: string; left: boolean }
  | { kind: 'gone' };

/** The member chose the other member's version; the week reloads to show it. */
const KEPT: DialogOutcome = {
  kind: 'saved',
  message: 'The entry was left as the other member saved it.',
  left: false,
};

function DialogError({ message }: Readonly<{ message: string | null }>) {
  if (!message) return null;
  return (
    <Alert color="clay" data-testid="dialog-error" role="alert" style={wrap}>
      {message}
    </Alert>
  );
}

function DateAndMeal({
  date,
  slot,
  onDate,
  onSlot,
  dateError,
  window,
}: Readonly<{
  date: string;
  slot: MealSlot;
  onDate: (value: string) => void;
  onSlot: (value: MealSlot) => void;
  dateError?: string;
  window: PlanDateWindow;
}>) {
  return (
    <>
      <TextInput
        error={dateError}
        label="Date"
        max={window.latest}
        min={window.earliest}
        onChange={(event) => onDate(event.currentTarget.value)}
        type="date"
        value={date}
      />
      <NativeSelect
        data={MEAL_SLOT_OPTIONS}
        label="Meal"
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (isMealSlot(value)) onSlot(value);
        }}
        value={slot}
      />
    </>
  );
}

function NoteField({
  value,
  onChange,
  error,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  error?: string;
}>) {
  return (
    <TextInput
      description="Optional, such as “double batch”."
      error={error}
      label="Note"
      maxLength={MEAL_PLAN_NOTE_MAX_LENGTH}
      onChange={(event) => onChange(event.currentTarget.value)}
      value={value}
    />
  );
}

/**
 * Someone else changed the entry first. The panel says what it is now, and
 * lets the member apply their own change to that version or keep it.
 */
function ConflictPanel({
  current,
  pending,
  applyLabel,
  keepLabel,
  onApply,
  onKeep,
  lead,
}: Readonly<{
  current: MealPlanEntry;
  pending: boolean;
  applyLabel: string;
  keepLabel: string;
  onApply: () => void;
  onKeep: () => void;
  lead: string;
}>) {
  return (
    <Alert
      color="clay"
      data-testid="entry-conflict"
      role="alert"
      style={wrap}
      title="Someone else changed this entry"
    >
      <Stack gap="xs">
        <Text fz="sm">{lead}</Text>
        <Text fz="sm">
          It is now {describeEntry(current)},{' '}
          {placeLabel(current.date, current.slot)}.
        </Text>
        <Group gap="xs">
          <Button disabled={pending} onClick={onApply} size="sm">
            {applyLabel}
          </Button>
          <Button
            disabled={pending}
            onClick={onKeep}
            size="sm"
            variant="default"
          >
            {keepLabel}
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}

function DialogButtons({
  pending,
  saveLabel,
  onCancel,
  danger = false,
}: Readonly<{
  pending: boolean;
  saveLabel: string;
  onCancel: () => void;
  danger?: boolean;
}>) {
  return (
    <Group justify="flex-end">
      <Button
        color={danger ? 'clay' : undefined}
        disabled={pending}
        type="submit"
      >
        {saveLabel}
      </Button>
      <Button disabled={pending} onClick={onCancel} variant="default">
        Cancel
      </Button>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Recipes for the picker

type RecipeList =
  | { kind: 'loading' }
  | { kind: 'ready'; recipes: RecipeSummary[] }
  | { kind: 'unavailable' };

const useRecipeList = (active: boolean) => {
  const [list, setList] = useState<RecipeList>({ kind: 'loading' });
  const load = useCallback(async () => {
    setList({ kind: 'loading' });
    try {
      const response = await api<RecipesResponse>('/api/recipes');
      setList({
        kind: 'ready',
        recipes: response.recipes
          .slice()
          .sort((a, b) => a.title.localeCompare(b.title)),
      });
    } catch {
      setList({ kind: 'unavailable' });
    }
  }, []);
  useEffect(() => {
    if (active) queueMicrotask(() => void load());
  }, [active, load]);
  return { list, load };
};

/**
 * Mantine's option filter, narrowed to recipes whose title holds every word
 * typed — the same rule as `filterRecipes`.
 */
const filterOptions: OptionsFilter = ({ options, search }) =>
  filterRecipes(
    (options as ComboboxItem[]).map((option) => ({
      ...option,
      title: option.label,
    })),
    search,
  );

/**
 * One searchable field rather than a list of every recipe: the dropdown
 * shows only what matches the typing and scrolls within a fixed height, so
 * the dialog stays the same size however large the library grows (owner
 * review, V-DEV-P1).
 */
function RecipePicker({
  list,
  retry,
  selected,
  onSelect,
  error,
}: Readonly<{
  list: RecipeList;
  retry: () => void;
  selected: string;
  onSelect: (id: string) => void;
  error?: string;
}>) {
  if (list.kind === 'loading') {
    return <Text component="output">Checking your recipes…</Text>;
  }
  if (list.kind === 'unavailable') {
    return (
      <Stack align="flex-start" gap="xs">
        <Text component="output">
          We could not load the recipes. Please try again.
        </Text>
        <Button onClick={retry} size="sm" variant="default">
          Retry
        </Button>
      </Stack>
    );
  }
  if (list.recipes.length === 0) {
    return (
      <Text data-testid="picker-empty">
        The recipe library is empty.{' '}
        <Anchor component={Link} to="/recipes/new">
          Add recipe
        </Anchor>{' '}
        first, or type the meal instead.
      </Text>
    );
  }
  return (
    <Select
      data={list.recipes.map((recipe) => ({
        value: recipe.id,
        label: recipe.title,
      }))}
      description={`Type to search ${list.recipes.length} ${list.recipes.length === 1 ? 'recipe' : 'recipes'}.`}
      error={error}
      filter={filterOptions}
      label="Recipe"
      maxDropdownHeight={240}
      nothingFoundMessage="No recipe matches that search."
      onChange={(value) => onSelect(value ?? '')}
      placeholder="Search the recipe library"
      searchable
      value={selected || null}
    />
  );
}

// ---------------------------------------------------------------------------
// Add an entry to a slot of the week

type AddMode = 'recipe' | 'text';

export function AddEntryDialog({
  target,
  onClose,
}: Readonly<{
  target: { date: string; slot: MealSlot };
  onClose: (outcome: DialogOutcome) => void;
}>) {
  const [mode, setMode] = useState<AddMode>('recipe');
  const [recipeId, setRecipeId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<EntryFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { list, load } = useRecipeList(mode === 'recipe');

  const where = placeLabel(target.date, target.slot);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const noteResult = checkNote(note);
    const next: EntryFieldErrors = {
      note: noteResult.ok ? undefined : noteResult.message,
      recipe: mode === 'recipe' && !recipeId ? 'Choose a recipe.' : undefined,
      title: mode === 'text' ? checkTitle(title) : undefined,
    };
    setErrors(next);
    if (hasErrors(next) || !noteResult.ok) return;

    setPending(true);
    setFailure(null);
    try {
      const body = {
        date: target.date,
        slot: target.slot,
        note: noteResult.value,
        ...(mode === 'recipe' ? { recipeId } : { title }),
      };
      const { entry } = await api<MealPlanEntryResponse>(
        '/api/meal-plan/entries',
        jsonMutation('POST', body),
      );
      onClose({
        kind: 'saved',
        message: `Added “${entry.title}” to ${where}.`,
        left: false,
      });
    } catch (error: unknown) {
      if (mode === 'recipe' && isEntryGone(error)) {
        // The recipe was deleted meanwhile; show the library as it is now.
        setRecipeId('');
        void load();
      }
      setFailure(
        planFailure(
          error,
          'The meal could not be added. Check your connection and try again.',
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      centered
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      onClose={() => onClose({ kind: 'cancelled' })}
      opened
      returnFocus={false}
      title={`Add to ${where}`}
    >
      <form noValidate onSubmit={(event) => void submit(event)}>
        <Stack aria-busy={pending} gap="md">
          <Radio.Group
            label="What to add"
            onChange={(value) => {
              setMode(value === 'text' ? 'text' : 'recipe');
              setErrors({});
            }}
            value={mode}
          >
            <Group gap="lg" mt="xs">
              <Radio label="Pick a recipe" value="recipe" />
              <Radio label="Type a meal" value="text" />
            </Group>
          </Radio.Group>

          {mode === 'recipe' ? (
            <RecipePicker
              error={errors.recipe}
              list={list}
              onSelect={setRecipeId}
              retry={() => void load()}
              selected={recipeId}
            />
          ) : (
            <TextInput
              data-autofocus
              description="Such as “Leftovers” or “Eat out”."
              error={errors.title}
              label="Meal"
              maxLength={MEAL_PLAN_TITLE_MAX_LENGTH}
              onChange={(event) => setTitle(event.currentTarget.value)}
              value={title}
            />
          )}

          <NoteField error={errors.note} onChange={setNote} value={note} />
          <DialogError message={failure} />
          <DialogButtons
            onCancel={() => onClose({ kind: 'cancelled' })}
            pending={pending}
            saveLabel="Add to plan"
          />
        </Stack>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Change an entry: move it, edit it, or remove it

/**
 * Runs one change against `version`, sorting the answer into saved, gone, a
 * conflict to show, or a failure to show. The dialog keeps its input on the
 * last two.
 */
const useEntryChange = (onClose: (outcome: DialogOutcome) => void) => {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MealPlanEntry | null>(null);

  const run = async (
    action: () => Promise<unknown>,
    saved: { message: string; left: boolean },
    fallback: string,
  ) => {
    setPending(true);
    setFailure(null);
    try {
      await action();
      onClose({ kind: 'saved', ...saved });
    } catch (error: unknown) {
      const current = entryConflictFrom(error);
      if (current) {
        setConflict(current);
      } else if (isEntryGone(error)) {
        onClose({ kind: 'gone' });
      } else {
        setFailure(planFailure(error, fallback));
      }
    } finally {
      setPending(false);
    }
  };

  return { pending, failure, conflict, setConflict, run };
};

const patchEntry = (id: string, body: UpdateMealPlanEntryRequest) =>
  api<MealPlanEntryResponse>(
    `/api/meal-plan/entries/${encodeURIComponent(id)}`,
    jsonMutation('PATCH', body),
  );

export function MoveEntryDialog({
  entry,
  onClose,
}: Readonly<{
  entry: MealPlanEntry;
  onClose: (outcome: DialogOutcome) => void;
}>) {
  const [date, setDate] = useState(entry.date);
  const [slot, setSlot] = useState<MealSlot>(entry.slot);
  const [dateError, setDateError] = useState<string | undefined>();
  const change = useEntryChange(onClose);

  const save = (base: MealPlanEntry) => {
    const error = checkMoveDate(date, base.date, clientWriteWindow());
    setDateError(error);
    if (error) return;
    if (date === base.date && slot === base.slot) {
      onClose({ kind: 'cancelled' });
      return;
    }
    const body: UpdateMealPlanEntryRequest = { version: base.version };
    if (date !== base.date) body.date = date;
    if (slot !== base.slot) body.slot = slot;
    change.setConflict(null);
    void change.run(
      () => patchEntry(entry.id, body),
      {
        message: `Moved “${base.title}” to ${placeLabel(date, slot)}.`,
        left: true,
      },
      'The meal could not be moved. Check your connection and try again.',
    );
  };

  return (
    <Modal
      centered
      closeOnClickOutside={!change.pending}
      closeOnEscape={!change.pending}
      onClose={() => onClose({ kind: 'cancelled' })}
      opened
      returnFocus={false}
      title={`Move “${entry.title}”`}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save(entry);
        }}
      >
        <Stack aria-busy={change.pending} gap="md">
          <Text c="dimmed" fz="sm">
            Now planned for {placeLabel(entry.date, entry.slot)}. It moves to
            the end of its new meal.
          </Text>
          <DateAndMeal
            date={date}
            dateError={dateError}
            onDate={setDate}
            onSlot={setSlot}
            slot={slot}
            window={clientWriteWindow()}
          />
          {change.conflict && (
            <ConflictPanel
              applyLabel="Move the latest version"
              current={change.conflict}
              keepLabel="Keep it where it is"
              lead="Your move was not saved."
              onApply={() => change.conflict && save(change.conflict)}
              onKeep={() => onClose(KEPT)}
              pending={change.pending}
            />
          )}
          <DialogError message={change.failure} />
          <DialogButtons
            onCancel={() => onClose({ kind: 'cancelled' })}
            pending={change.pending}
            saveLabel="Move"
          />
        </Stack>
      </form>
    </Modal>
  );
}

export function EditEntryDialog({
  entry,
  onClose,
}: Readonly<{
  entry: MealPlanEntry;
  onClose: (outcome: DialogOutcome) => void;
}>) {
  const [title, setTitle] = useState(entry.title);
  const [note, setNote] = useState(entry.note ?? '');
  const [errors, setErrors] = useState<EntryFieldErrors>({});
  const change = useEntryChange(onClose);
  const isText = entry.kind === 'text';

  const save = (base: MealPlanEntry) => {
    const noteResult = checkNote(note);
    const next: EntryFieldErrors = {
      title: isText ? checkTitle(title) : undefined,
      note: noteResult.ok ? undefined : noteResult.message,
    };
    setErrors(next);
    if (hasErrors(next) || !noteResult.ok) return;

    // Only what the member changed from the entry they opened is sent, so
    // applying it to a newer version keeps the other member's other changes.
    const body: UpdateMealPlanEntryRequest = { version: base.version };
    const cleaned = validateMealPlanTitle(title);
    if (isText && cleaned.ok && cleaned.value !== entry.title) {
      body.title = cleaned.value;
    }
    if (noteResult.value !== entry.note) body.note = noteResult.value;
    if (Object.keys(body).length === 1) {
      onClose({ kind: 'cancelled' });
      return;
    }
    change.setConflict(null);
    void change.run(
      () => patchEntry(entry.id, body),
      { message: 'Your changes to the meal were saved.', left: false },
      'The changes could not be saved. Check your connection and try again.',
    );
  };

  return (
    <Modal
      centered
      closeOnClickOutside={!change.pending}
      closeOnEscape={!change.pending}
      onClose={() => onClose({ kind: 'cancelled' })}
      opened
      returnFocus={false}
      title={`Edit “${entry.title}”`}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save(entry);
        }}
      >
        <Stack aria-busy={change.pending} gap="md">
          {isText ? (
            <TextInput
              error={errors.title}
              label="Meal"
              maxLength={MEAL_PLAN_TITLE_MAX_LENGTH}
              onChange={(event) => setTitle(event.currentTarget.value)}
              value={title}
            />
          ) : (
            <Text c="dimmed" fz="sm">
              A planned recipe shows the recipe’s own title. Edit the recipe to
              change it.
            </Text>
          )}
          <NoteField error={errors.note} onChange={setNote} value={note} />
          {change.conflict && (
            <ConflictPanel
              applyLabel="Apply my change to the latest version"
              current={change.conflict}
              keepLabel="Keep the latest version"
              lead="Your change was not saved."
              onApply={() => change.conflict && save(change.conflict)}
              onKeep={() => onClose(KEPT)}
              pending={change.pending}
            />
          )}
          <DialogError message={change.failure} />
          <DialogButtons
            onCancel={() => onClose({ kind: 'cancelled' })}
            pending={change.pending}
            saveLabel="Save"
          />
        </Stack>
      </form>
    </Modal>
  );
}

export function RemoveEntryDialog({
  entry,
  onClose,
}: Readonly<{
  entry: MealPlanEntry;
  onClose: (outcome: DialogOutcome) => void;
}>) {
  const change = useEntryChange(onClose);

  const remove = (base: MealPlanEntry) => {
    change.setConflict(null);
    void change.run(
      () =>
        api<void>(
          `/api/meal-plan/entries/${encodeURIComponent(entry.id)}`,
          jsonMutation('DELETE', { version: base.version }),
        ),
      {
        message: `Removed “${base.title}” from ${placeLabel(base.date, base.slot)}.`,
        left: true,
      },
      'The meal could not be removed. Check your connection and try again.',
    );
  };

  return (
    <Modal
      centered
      closeOnClickOutside={!change.pending}
      closeOnEscape={!change.pending}
      onClose={() => onClose({ kind: 'cancelled' })}
      opened
      returnFocus={false}
      title={`Remove “${entry.title}”?`}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          remove(entry);
        }}
      >
        <Stack aria-busy={change.pending} gap="md">
          <Text>
            This removes it from {placeLabel(entry.date, entry.slot)} for
            everyone. It cannot be undone.
          </Text>
          {change.conflict && (
            <ConflictPanel
              applyLabel="Remove the latest version"
              current={change.conflict}
              keepLabel="Keep it"
              lead="It was not removed."
              onApply={() => change.conflict && remove(change.conflict)}
              onKeep={() => onClose(KEPT)}
              pending={change.pending}
            />
          )}
          <DialogError message={change.failure} />
          <DialogButtons
            danger
            onCancel={() => onClose({ kind: 'cancelled' })}
            pending={change.pending}
            saveLabel="Remove"
          />
        </Stack>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Add to plan, from a recipe's own page

export function AddToPlanDialog({
  recipe,
  onClose,
}: Readonly<{
  recipe: { id: string; title: string };
  onClose: () => void;
}>) {
  const [date, setDate] = useState(() => today());
  const [slot, setSlot] = useState<MealSlot>('dinner');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<EntryFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<MealPlanEntry | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const noteResult = checkNote(note);
    const next: EntryFieldErrors = {
      date: checkDate(date, clientWriteWindow()),
      note: noteResult.ok ? undefined : noteResult.message,
    };
    setErrors(next);
    if (hasErrors(next) || !noteResult.ok) return;

    setPending(true);
    setFailure(null);
    try {
      const { entry } = await api<MealPlanEntryResponse>(
        '/api/meal-plan/entries',
        jsonMutation('POST', {
          date,
          slot,
          recipeId: recipe.id,
          note: noteResult.value,
        }),
      );
      setSaved(entry);
    } catch (error: unknown) {
      setFailure(
        planFailure(
          error,
          'The recipe could not be added to the plan. Check your connection and try again.',
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      centered
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      onClose={onClose}
      opened
      returnFocus={false}
      title={`Add “${recipe.title}” to the plan`}
    >
      {saved ? (
        <Stack gap="md">
          <Text
            data-autofocus
            data-testid="plan-added"
            role="status"
            style={wrap}
            tabIndex={-1}
          >
            Planned for {placeLabel(saved.date, saved.slot)}.
          </Text>
          <Group justify="flex-end">
            <Button
              component={Link}
              to={weekPath(planWeekStart(saved.date))}
              variant="default"
            >
              Open the week of {dayLabel(planWeekStart(saved.date))}
            </Button>
            <Button onClick={onClose}>Done</Button>
          </Group>
        </Stack>
      ) : (
        <form noValidate onSubmit={(event) => void submit(event)}>
          <Stack aria-busy={pending} gap="md">
            <DateAndMeal
              date={date}
              dateError={errors.date}
              onDate={setDate}
              onSlot={setSlot}
              slot={slot}
              window={clientWriteWindow()}
            />
            <NoteField error={errors.note} onChange={setNote} value={note} />
            <DialogError message={failure} />
            <DialogButtons
              onCancel={onClose}
              pending={pending}
              saveLabel="Add to plan"
            />
          </Stack>
        </form>
      )}
    </Modal>
  );
}
