import {
  Alert,
  Button,
  Checkbox,
  Fieldset,
  Group,
  Modal,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { api, ApiRequestError, jsonMutation, type Notice } from './api';
import {
  fetchNutrition,
  isLineReady,
  parseQuantity,
  reviewGrams,
  reviewLines,
  toMatchInput,
  type ReviewLine,
  type ReviewMode,
} from './nutrition-client';
import { RecipeNotice } from './RecipeParts';
import { failureMessage, isNotFound } from './recipe-client';
import {
  foodSearchQuery,
  isMatchUnit,
  MAX_MATCH_GRAMS,
  MAX_MATCH_QUANTITY,
  toGrams,
  unitLabel,
  unitsFor,
  type FoodChoice,
  type FoodSearchResponse,
  type MatchUnit,
  type RecipeNutrition,
  type RecipeNutritionResponse,
} from '../shared/nutrition';

type SearchResult =
  | { query: string; kind: 'done'; foods: FoodChoice[] }
  | { query: string; kind: 'failed' };

const RESULT_STYLE = {
  display: 'block',
  width: '100%',
  minHeight: 'var(--mp-touch-target)',
  padding: 'var(--mantine-spacing-xs)',
  borderRadius: 'var(--mantine-radius-sm)',
  border: '1px solid var(--mantine-color-paper-2)',
  textAlign: 'start',
} as const;

/** Searches the bundled USDA foods as the member types. */
function FoodSearch({
  onChoose,
  onKeep,
}: Readonly<{ onChoose: (food: FoodChoice) => void; onKeep?: () => void }>) {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query.trim(), 300);
  const [result, setResult] = useState<SearchResult | null>(null);
  const listId = useId();
  const searchable = foodSearchQuery(debounced) !== null;

  useEffect(() => {
    if (!searchable) return;
    let current = true;
    api<FoodSearchResponse>(
      `/api/nutrition/foods?q=${encodeURIComponent(debounced)}`,
    )
      .then(({ foods }) => {
        if (current) setResult({ query: debounced, kind: 'done', foods });
      })
      .catch(() => {
        if (current) setResult({ query: debounced, kind: 'failed' });
      });
    return () => {
      current = false;
    };
  }, [debounced, searchable]);

  const shown = searchable && result?.query === debounced ? result : null;
  let status = '';
  if (searchable && !shown) status = 'Searching…';
  else if (shown?.kind === 'failed') {
    status = 'Search isn’t available right now. Try again.';
  } else if (shown?.kind === 'done' && shown.foods.length === 0) {
    status = `No foods match “${shown.query}”. Try fewer or different words.`;
  }

  return (
    <Stack gap="xs">
      <TextInput
        aria-controls={listId}
        description="Type part of a food’s name, such as “soy sauce”."
        label="Search foods"
        onChange={(event) => setQuery(event.currentTarget.value)}
        value={query}
      />
      <Text aria-live="polite" c="dimmed" component="output" fz="sm">
        {status}
      </Text>
      <Stack
        component="ul"
        gap={4}
        id={listId}
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {shown?.kind === 'done' &&
          shown.foods.map((food) => (
            <li key={food.fdcId}>
              <UnstyledButton
                onClick={() => onChoose(food)}
                style={RESULT_STYLE}
              >
                <Text fz="sm">{food.name}</Text>
                <Text c="dimmed" fz="xs">
                  {food.category}
                </Text>
              </UnstyledButton>
            </li>
          ))}
      </Stack>
      {onKeep && (
        <Group>
          <Button onClick={onKeep} size="sm" variant="subtle">
            Keep the current food
          </Button>
        </Group>
      )}
    </Stack>
  );
}

const gramsMessage = (line: ReviewLine, food: FoodChoice): string => {
  const grams = reviewGrams(line);
  if (grams !== null) return `= ${grams} g`;
  if (line.quantity.trim() === '') return 'Enter an amount.';
  const quantity = parseQuantity(line.quantity);
  if (quantity === null) {
    return `Enter a number above 0 and up to ${MAX_MATCH_QUANTITY.toLocaleString('en-NZ')}, such as 2 or 1.5.`;
  }
  return toGrams(quantity, line.unit, food) === null
    ? 'This unit can’t be used for this food. Choose another, such as g.'
    : `That’s over ${MAX_MATCH_GRAMS.toLocaleString('en-NZ')} g.`;
};

function AmountFields({
  line,
  food,
  onChange,
  amountRef,
}: Readonly<{
  line: ReviewLine;
  food: FoodChoice;
  onChange: (line: ReviewLine) => void;
  amountRef: RefObject<HTMLInputElement | null>;
}>) {
  const ready = reviewGrams(line) !== null;
  return (
    <Group align="flex-end" gap="sm" wrap="wrap">
      <TextInput
        inputMode="decimal"
        label="Amount"
        onChange={(event) =>
          onChange({ ...line, quantity: event.currentTarget.value })
        }
        ref={amountRef}
        value={line.quantity}
        w="7rem"
      />
      <NativeSelect
        data={unitsFor(food).map((unit) => ({
          value: unit,
          label: unitLabel(unit, food),
        }))}
        label="Unit"
        // The same size as the app's text fields (theme.ts), so the labels
        // match and the select meets the touch-target height.
        size="md"
        onChange={(event) => {
          const unit = event.currentTarget.value;
          if (isMatchUnit(unit)) onChange({ ...line, unit });
        }}
        value={line.unit}
        w="14rem"
      />
      <Text
        c={ready ? undefined : 'clay.8'}
        data-testid="review-grams"
        fz="sm"
        mb={8}
      >
        {gramsMessage(line, food)}
      </Text>
    </Group>
  );
}

/** A unit the new food can use: the current one if it can, else grams. */
const unitFor = (unit: MatchUnit, food: FoodChoice): MatchUnit =>
  unitsFor(food).includes(unit) ? unit : 'g';

function ReviewCard({
  line,
  onChange,
}: Readonly<{ line: ReviewLine; onChange: (line: ReviewLine) => void }>) {
  const [searching, setSearching] = useState(line.food === null);
  const amountRef = useRef<HTMLInputElement>(null);
  const choosing = searching || line.food === null;

  const choose = (food: FoodChoice) => {
    onChange({ ...line, food, unit: unitFor(line.unit, food) });
    setSearching(false);
    queueMicrotask(() => amountRef.current?.focus());
  };

  let foodPart = null;
  if (!line.dontCount && choosing) {
    foodPart = (
      <FoodSearch
        onChoose={choose}
        onKeep={line.food ? () => setSearching(false) : undefined}
      />
    );
  } else if (!line.dontCount && line.food) {
    foodPart = (
      <>
        <Group align="center" gap="sm" justify="space-between" wrap="nowrap">
          <Text fw={600} fz="sm">
            {line.food.name}
          </Text>
          <Button
            aria-label={`Change food for ${line.text}`}
            onClick={() => setSearching(true)}
            size="sm"
            style={{ flexShrink: 0 }}
            variant="default"
          >
            Change
          </Button>
        </Group>
        <AmountFields
          amountRef={amountRef}
          food={line.food}
          line={line}
          onChange={onChange}
        />
      </>
    );
  }

  return (
    <Fieldset
      data-position={line.position}
      data-testid="review-line"
      legend={line.text}
      pb="md"
      pt="xs"
      px="sm"
      radius="md"
      styles={{ legend: { fontWeight: 700, overflowWrap: 'anywhere' } }}
    >
      <Stack gap="sm">
        {foodPart}
        <Checkbox
          checked={line.dontCount}
          label="Don’t count"
          onChange={(event) =>
            onChange({ ...line, dontCount: event.currentTarget.checked })
          }
        />
      </Stack>
    </Fieldset>
  );
}

export interface NutritionReviewProps {
  recipeId: string;
  nutrition: RecipeNutrition;
  mode: ReviewMode;
  onClose: () => void;
  onSaved: (nutrition: RecipeNutrition) => void;
  onRecipeChanged: () => void;
}

/**
 * "Check the matches": the member chooses a food and amount for each
 * ingredient line, or marks it "Don't count", and saves. Nothing is stored
 * until they save, and a save for lines that changed meanwhile is refused.
 */
export function NutritionReview({
  recipeId,
  nutrition,
  mode,
  onClose,
  onSaved,
  onRecipeChanged,
}: Readonly<NutritionReviewProps>) {
  const phone = useMediaQuery('(max-width: 36em)');
  const [base, setBase] = useState(nutrition);
  const [lines, setLines] = useState(() => reviewLines(nutrition, mode));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [recipeChanged, setRecipeChanged] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const remainingId = useId();
  const body = useRef<HTMLDivElement>(null);

  const remaining = lines.filter((line) => !isLineReady(line)).length;
  const others = base.lines.length - lines.length;

  const update = (next: ReviewLine) =>
    setLines((current) =>
      current.map((line) => (line.position === next.position ? next : line)),
    );

  const close = () => {
    if (pending) return;
    onClose();
    if (recipeChanged) onRecipeChanged();
  };

  const refresh = async () => {
    setRecipeChanged(true);
    const fresh = await fetchNutrition(recipeId);
    setBase(fresh);
    setLines(reviewLines(fresh, mode));
    setNotice({
      tone: 'error',
      message:
        'Someone changed this recipe while you were checking it. The list now shows its current ingredients.',
    });
  };

  /**
   * Save stays enabled, so a member can always reach it and learn what is
   * missing. With lines left, it says so and moves to the first of them.
   */
  const trySave = () => {
    const first = lines.find((line) => !isLineReady(line));
    if (!first) {
      void save();
      return;
    }
    setAttempted(true);
    body.current
      ?.querySelector<HTMLElement>(
        `[data-position="${first.position}"] input, [data-position="${first.position}"] select`,
      )
      ?.focus();
  };

  const save = async () => {
    setPending(true);
    setNotice(null);
    try {
      const response = await api<RecipeNutritionResponse>(
        `/api/recipes/${encodeURIComponent(recipeId)}/nutrition`,
        jsonMutation('PUT', {
          recipeVersion: base.recipeVersion,
          matches: lines.map(toMatchInput),
        }),
      );
      onSaved(response.nutrition);
      if (recipeChanged) onRecipeChanged();
    } catch (error: unknown) {
      if (error instanceof ApiRequestError && error.status === 409) {
        await refresh().catch(() =>
          setNotice({
            tone: 'error',
            message: 'The recipe changed. Close this and open it again.',
          }),
        );
      } else if (isNotFound(error)) {
        setNotice({
          tone: 'error',
          message: 'This recipe was deleted by another member.',
        });
      } else {
        setNotice({
          tone: 'error',
          message: failureMessage(
            error,
            'The matches could not be saved. Check your connection and try again.',
          ),
        });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      fullScreen={phone}
      onClose={close}
      opened
      returnFocus={false}
      size="lg"
      title="Check the matches"
    >
      <Stack aria-busy={pending} gap="md" ref={body}>
        <Text fz="sm">
          Choose the food and amount for each ingredient, or mark it “Don’t
          count”. Values come from USDA FoodData Central.
        </Text>
        {mode === 'changed' && others > 0 && (
          <Text c="dimmed" fz="sm">
            {others === 1
              ? '1 other ingredient is already checked.'
              : `${others} other ingredients are already checked.`}{' '}
            Use Edit matches to change them.
          </Text>
        )}
        <RecipeNotice notice={notice} />
        {lines.length === 0 ? (
          <Alert color="sage">Every ingredient is already checked.</Alert>
        ) : (
          lines.map((line) => (
            <ReviewCard
              key={`${base.recipeVersion}-${line.position}`}
              line={line}
              onChange={update}
            />
          ))
        )}
        {lines.length > 0 && (
          <Text
            aria-live="polite"
            c={attempted && remaining > 0 ? 'clay.8' : undefined}
            fz="sm"
            id={remainingId}
          >
            {remaining === 0
              ? 'Every ingredient is ready to save.'
              : `${remaining} left: choose a food and amount, or “Don’t count”.`}
          </Text>
        )}
        <Group gap="sm">
          {lines.length > 0 && (
            <Button
              aria-describedby={remainingId}
              disabled={pending}
              onClick={trySave}
            >
              Save matches
            </Button>
          )}
          <Button disabled={pending} onClick={close} variant="default">
            Cancel
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
