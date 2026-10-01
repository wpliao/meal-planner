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
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SubmitEvent,
} from 'react';
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
  mealCount,
  leadingReason,
  placeLabel,
  planFailure,
  planningReason,
  suggestionsHeading,
  suggestionsQuery,
  today,
  weekConflictFrom,
  weekHeading,
  weekPath,
  type EntryFieldErrors,
} from './meal-plan-client';
import {
  isMealSlot,
  isWithinPlanWindow,
  validateMealPlanTitle,
  MEAL_PLAN_NOTE_MAX_LENGTH,
  MEAL_PLAN_TITLE_MAX_LENGTH,
  planWeekStart,
  type ClearMealPlanWeekRequest,
  type MealPlanEntry,
  type MealPlanEntryResponse,
  type MealSlot,
  type PlanDateWindow,
  type UpdateMealPlanEntryRequest,
} from '../shared/meal-plan';
import type {
  MealSuggestion,
  MealSuggestionsResponse,
} from '../shared/meal-suggestions';
import {
  RECIPE_NOT_NOW_DAYS,
  type RecipePreferencesResponse,
} from '../shared/recipe-preferences';
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
 * Moves focus into the field once it appears, unless the member is already
 * typing somewhere else. The recipes load after the dialog opens, so the
 * modal's own `data-autofocus` has run before the field exists (#117).
 */
const useFocusOnArrival = (enabled: boolean) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!enabled) return;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement &&
        active.type !== 'radio' &&
        active !== ref.current);
    if (!typing) ref.current?.focus();
  }, [enabled]);
  return ref;
};

/**
 * One searchable field rather than a list of every recipe: the dropdown
 * shows only what matches the typing and scrolls within a fixed height, so
 * the dialog stays the same size however large the library grows (owner
 * review, V-DEV-P1). It comes before the suggestions and takes focus, so a
 * member who knows the meal can type straight away (#117).
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
  const ready = list.kind === 'ready' && list.recipes.length > 0;
  const fieldRef = useFocusOnArrival(ready);
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
      // A short landscape viewport can still put the field at the modal's
      // bottom edge, where a dropdown has no room and is hidden as detached
      // (#73). Focus brings the field to the middle of the modal first; jsdom
      // has no scrollIntoView.
      onFocus={(event) =>
        event.currentTarget.scrollIntoView?.({ block: 'center' })
      }
      // Focus on arrival must not open the list over the suggestions; a
      // click, typing, or the arrow keys still open it (#117 AC-04).
      openOnFocus={false}
      // The modal's focus trap picks this field when it is already there as
      // the trap starts; the hook covers a field that arrives later.
      data-autofocus
      ref={fieldRef}
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
// Suggestions for the picker

type SuggestionList =
  | { kind: 'loading' }
  | { kind: 'ready'; suggestions: MealSuggestion[] }
  | { kind: 'unavailable' };

/**
 * Loads suggestions for one meal date, separately from the recipe list, so
 * neither waits for the other and a failure here never stops the picker.
 */
const useSuggestions = (active: boolean, date: string) => {
  const [list, setList] = useState<SuggestionList>({ kind: 'loading' });
  const load = useCallback(async () => {
    setList({ kind: 'loading' });
    try {
      const response = await api<MealSuggestionsResponse>(
        suggestionsQuery(date),
      );
      if (!Array.isArray(response?.suggestions)) {
        throw new TypeError('Unexpected suggestions response.');
      }
      setList({ kind: 'ready', suggestions: response.suggestions });
    } catch {
      setList({ kind: 'unavailable' });
    }
  }, [date]);
  useEffect(() => {
    if (active) queueMicrotask(() => void load());
  }, [active, load]);
  return { list, load };
};

function SuggestionOption({
  suggestion,
  mealDate,
  checked,
  pending,
  focus,
  onFocused,
  onNotNow,
}: Readonly<{
  suggestion: MealSuggestion;
  mealDate: string;
  checked: boolean;
  pending: boolean;
  /** Move focus to this option's radio once it is shown. */
  focus: boolean;
  onFocused: () => void;
  onNotNow: () => void;
}>) {
  const id = useId();
  const radio = useRef<HTMLInputElement>(null);
  const leading = leadingReason(suggestion);
  useEffect(() => {
    if (!focus) return;
    radio.current?.focus();
    onFocused();
  }, [focus, onFocused]);
  // The card holds the radio and, beside it, Not now. The radio's label is
  // the rest of the card, so all of it is a touch target; its accessible name
  // is the title alone, and the reasons are its description. Not now sits
  // outside the label, so tapping it never chooses the recipe.
  return (
    <Group
      align="stretch"
      gap={0}
      style={{
        border: `1px solid var(--mantine-color-${checked ? 'sage-6' : 'paper-3'})`,
        borderRadius: 'var(--mantine-radius-md)',
      }}
      wrap="nowrap"
    >
      <Radio
        aria-describedby={`${id}-reasons`}
        aria-labelledby={`${id}-title`}
        label={
          <>
            <Text component="span" display="block" fw={600} id={`${id}-title`}>
              {suggestion.title}
            </Text>
            <Text
              c="dimmed"
              component="span"
              display="block"
              fz="sm"
              id={`${id}-reasons`}
            >
              {leading && (
                <Text component="span" display="block" inherit>
                  {leading}
                </Text>
              )}
              <Text component="span" display="block" inherit>
                {planningReason(suggestion, mealDate)}
              </Text>
            </Text>
          </>
        }
        ref={radio}
        styles={{
          root: {
            flex: 1,
            minWidth: 0,
            paddingInlineStart: 'var(--mantine-spacing-sm)',
          },
          body: { alignItems: 'center', height: '100%' },
          labelWrapper: { flex: 1 },
          label: {
            cursor: 'pointer',
            minHeight: 'var(--mp-touch-target)',
            paddingBlock: 'var(--mantine-spacing-xs)',
            paddingInlineEnd: 'var(--mantine-spacing-xs)',
            ...wrap,
          },
        }}
        value={suggestion.recipeId}
      />
      <Button
        aria-label={`Not now: ${suggestion.title}`}
        disabled={pending}
        onClick={onNotNow}
        px="sm"
        style={{ alignSelf: 'center', flexShrink: 0 }}
        variant="subtle"
      >
        Not now
      </Button>
    </Group>
  );
}

/** The result of the last Not now or Undo, shown above the suggestions. */
type NotNowStatus =
  | { kind: 'hidden'; recipeId: string; title: string }
  | { kind: 'failed' }
  | null;

const saveNotNow = (recipeId: string, notNow: boolean) =>
  api<RecipePreferencesResponse>(
    `/api/recipes/${encodeURIComponent(recipeId)}/preferences`,
    jsonMutation('PUT', { notNow }),
  );

/**
 * Up to five recipes ranked for this meal, above the search field (the #73
 * design). Choosing one selects it exactly as searching for it would, and
 * Add to plan plans it. Not now hides one from the household's suggestions
 * for 7 days, with Undo (the #78 design); the search still lists it.
 */
function MealSuggestions({
  list,
  reload,
  heading,
  mealDate,
  selected,
  onSelect,
  onHidden,
}: Readonly<{
  list: SuggestionList;
  reload: () => void;
  heading: string;
  mealDate: string;
  selected: string;
  onSelect: (id: string) => void;
  /** A recipe left the suggestions; the dialog clears it if it was chosen. */
  onHidden: (id: string) => void;
}>) {
  const [status, setStatus] = useState<NotNowStatus>(null);
  const [pending, setPending] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const undo = useRef<HTMLButtonElement>(null);
  const clearFocus = useCallback(() => setFocusId(null), []);

  useEffect(() => {
    if (status?.kind === 'hidden') undo.current?.focus();
  }, [status]);

  const change = async (
    suggestion: { recipeId: string; title: string },
    notNow: boolean,
  ) => {
    setPending(true);
    try {
      await saveNotNow(suggestion.recipeId, notNow);
      if (notNow) {
        setStatus({ kind: 'hidden', ...suggestion });
        onHidden(suggestion.recipeId);
      } else {
        setStatus(null);
        setFocusId(suggestion.recipeId);
      }
      reload();
    } catch {
      setStatus({ kind: 'failed' });
    } finally {
      setPending(false);
    }
  };

  let notice: ReactNode = null;
  if (status?.kind === 'hidden') {
    notice = (
      <Group gap="xs">
        <Text component="output" data-testid="not-now-status" style={wrap}>
          “{status.title}” is hidden from suggestions for {RECIPE_NOT_NOW_DAYS}{' '}
          days.
        </Text>
        <Button
          disabled={pending}
          onClick={() => void change(status, false)}
          ref={undo}
          size="sm"
          variant="default"
        >
          Undo
        </Button>
      </Group>
    );
  } else if (status?.kind === 'failed') {
    notice = (
      <Text component="output" data-testid="not-now-status">
        That could not be saved. Try again.
      </Text>
    );
  }

  let body: ReactNode = null;
  if (list.kind === 'loading') {
    body = <Text component="output">Finding suggestions…</Text>;
  } else if (list.kind === 'unavailable') {
    body = (
      <Stack align="flex-start" data-testid="suggestions-unavailable" gap="xs">
        <Text component="output">Suggestions are not available right now.</Text>
        <Button
          aria-label="Retry suggestions"
          onClick={reload}
          size="sm"
          variant="default"
        >
          Retry
        </Button>
      </Stack>
    );
  } else if (list.suggestions.length > 0) {
    const value = list.suggestions.some(({ recipeId }) => recipeId === selected)
      ? selected
      : null;
    body = (
      <Radio.Group
        data-testid="meal-suggestions"
        label={heading}
        onChange={onSelect}
        value={value}
      >
        <Stack gap="xs" mt="xs">
          {list.suggestions.map((suggestion) => (
            <SuggestionOption
              checked={suggestion.recipeId === value}
              focus={suggestion.recipeId === focusId}
              key={suggestion.recipeId}
              mealDate={mealDate}
              onFocused={clearFocus}
              onNotNow={() => void change(suggestion, true)}
              pending={pending}
              suggestion={suggestion}
            />
          ))}
        </Stack>
      </Radio.Group>
    );
  }
  if (!notice && !body) return null;
  return (
    <Stack gap="xs">
      {notice}
      {body}
    </Stack>
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
  // A date outside the write window cannot be planned, so nothing is
  // suggested for it; adding there fails as it always has.
  const suggestable = isWithinPlanWindow(target.date, clientWriteWindow());
  const suggestions = useSuggestions(
    mode === 'recipe' && suggestable,
    target.date,
  );

  const where = placeLabel(target.date, target.slot);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
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
        if (suggestable) void suggestions.load();
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
            <>
              <RecipePicker
                error={errors.recipe}
                list={list}
                onSelect={setRecipeId}
                retry={() => void load()}
                selected={recipeId}
              />
              {suggestable && (
                <MealSuggestions
                  heading={suggestionsHeading(target.date, target.slot)}
                  list={suggestions.list}
                  mealDate={target.date}
                  onHidden={(id) => {
                    if (id === recipeId) setRecipeId('');
                  }}
                  onSelect={setRecipeId}
                  reload={() => void suggestions.load()}
                  selected={recipeId}
                />
              )}
            </>
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

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
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

// ---------------------------------------------------------------------------
// Clear a week that has ended

/** The member kept the week as someone else left it. */
const KEPT_WEEK: DialogOutcome = {
  kind: 'saved',
  message: 'The week was left as it is now.',
  left: false,
};

/**
 * Clears a past week, naming the week and how many planned meals go. The
 * request names every entry on screen at its version, so only what the member
 * saw can be removed. If the week changed meanwhile, nothing is removed: the
 * week behind reloads, and the dialog offers to clear the latest version or
 * keep it (decision 1 of the #56 design).
 */
export function ClearWeekDialog({
  weekStart,
  entries,
  onChanged,
  onClose,
}: Readonly<{
  weekStart: string;
  entries: readonly MealPlanEntry[];
  onChanged: () => void;
  onClose: (outcome: DialogOutcome) => void;
}>) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [latest, setLatest] = useState<MealPlanEntry[] | null>(null);
  const heading = weekHeading(weekStart);
  const count = (latest ?? entries).length;

  const clear = async (target: readonly MealPlanEntry[]) => {
    setPending(true);
    setFailure(null);
    try {
      const body: ClearMealPlanWeekRequest = {
        entries: target.map(({ id, version }) => ({ id, version })),
      };
      await api<void>(
        `/api/meal-plan/weeks/${weekStart}`,
        jsonMutation('DELETE', body),
      );
      onClose({
        kind: 'saved',
        message: `Cleared ${mealCount(target.length)} from ${heading}.`,
        left: true,
      });
    } catch (error: unknown) {
      const current = weekConflictFrom(error);
      if (current === null) {
        setFailure(
          planFailure(
            error,
            'The week could not be cleared. Check your connection and try again.',
          ),
        );
      } else if (current.length === 0) {
        onClose({ kind: 'gone' });
      } else {
        setLatest(current);
        onChanged();
      }
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
      title={`Clear ${heading}?`}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void clear(entries);
        }}
      >
        <Stack aria-busy={pending} gap="md">
          <Text>
            This removes{' '}
            {count === 1 ? 'the 1 planned meal' : `all ${mealCount(count)}`} in
            this week for everyone. It cannot be undone.
          </Text>
          {latest && (
            <Alert
              color="clay"
              data-testid="week-conflict"
              role="alert"
              style={wrap}
              title="This week changed"
            >
              <Stack gap="xs">
                <Text fz="sm">
                  This week changed after you opened it, so nothing was removed.
                  It now has {mealCount(latest.length)}.
                </Text>
                <Group gap="xs">
                  <Button
                    color="clay"
                    disabled={pending}
                    onClick={() => void clear(latest)}
                    size="sm"
                  >
                    {latest.length === 1
                      ? 'Clear the 1 planned meal'
                      : `Clear all ${latest.length.toLocaleString('en')}`}
                  </Button>
                  <Button
                    disabled={pending}
                    onClick={() => onClose(KEPT_WEEK)}
                    size="sm"
                    variant="default"
                  >
                    Keep them
                  </Button>
                </Group>
              </Stack>
            </Alert>
          )}
          <DialogError message={failure} />
          {!latest && (
            <DialogButtons
              danger
              onCancel={() => onClose({ kind: 'cancelled' })}
              pending={pending}
              saveLabel="Clear week"
            />
          )}
        </Stack>
      </form>
    </Modal>
  );
}
