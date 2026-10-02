import {
  Button,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  VisuallyHidden,
} from '@mantine/core';
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  DEFAULT_UNIT_SYSTEM,
  isUnitSystem,
  presentIngredientLine,
  presentStepText,
  type UnitSystem,
} from '../shared/ingredient-amounts';
import type { Recipe } from '../shared/recipes';
import { RecipeBody } from './RecipeParts';

/**
 * Servings and unit controls for the recipe page (#118). Amounts are only
 * re-presented here: the saved recipe text never changes, and the editor
 * still shows it as written.
 */

const UNIT_STORAGE_KEY = 'meal-planner:units';
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 50;

const UNIT_LABELS: Record<UnitSystem, string> = {
  metric: 'Metric',
  imperial: 'Imperial',
};

/** Scale steps offered when a recipe has no servings count. */
const SCALES = [
  { value: '0.5', label: '½×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '3', label: '3×' },
  { value: '4', label: '4×' },
] as const;

const scaleLabel = (scale: string) =>
  SCALES.find(({ value }) => value === scale)?.label ?? scale;

const servingsText = (count: number) =>
  `${count} ${count === 1 ? 'serving' : 'servings'}`;

const readStoredUnits = (): UnitSystem => {
  try {
    const stored = globalThis.localStorage.getItem(UNIT_STORAGE_KEY);
    return isUnitSystem(stored) ? stored : DEFAULT_UNIT_SYSTEM;
  } catch {
    return DEFAULT_UNIT_SYSTEM;
  }
};

/**
 * The unit choice is a per-device preference. A blocked or full store keeps
 * the choice for this visit only.
 */
function useUnitSystem(): [UnitSystem, (system: UnitSystem) => void] {
  const [system, setSystem] = useState(readStoredUnits);
  const choose = useCallback((next: UnitSystem) => {
    setSystem(next);
    try {
      globalThis.localStorage.setItem(UNIT_STORAGE_KEY, next);
    } catch {
      // Remembered for this visit only.
    }
  }, []);
  return [system, choose];
}

const validServings = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= MIN_SERVINGS &&
  value <= MAX_SERVINGS;

const touchLabel = {
  label: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'center',
    minHeight: 'var(--mp-touch-target)',
  },
} as const;

export interface PresentedRecipe {
  ingredients: readonly string[];
  steps: readonly string[];
  /** Shown above the ingredient list. */
  controls: ReactNode;
  /** Shown below the ingredient list. */
  notes: ReactNode;
}

/** The recipe's ingredient and step text for the chosen servings and units. */
function usePresentedRecipe(
  recipe: Pick<Recipe, 'ingredients' | 'steps' | 'servings'>,
): PresentedRecipe {
  const base = validServings(recipe.servings) ? recipe.servings : null;
  const [system, setSystem] = useUnitSystem();
  const [servings, setServings] = useState(base ?? MIN_SERVINGS);
  const [entry, setEntry] = useState<number | string>(base ?? MIN_SERVINGS);
  const [scale, setScale] = useState('1');
  const [announcement, setAnnouncement] = useState('');
  // A newer saved version with another count starts again from its own.
  const [shownBase, setShownBase] = useState(base);
  if (shownBase !== base) {
    setShownBase(base);
    setServings(base ?? MIN_SERVINGS);
    setEntry(base ?? MIN_SERVINGS);
  }
  const ids = useId();

  const factor = base === null ? Number(scale) : servings / base;
  const ingredients = useMemo(
    () =>
      recipe.ingredients.map((line) =>
        presentIngredientLine(line, { factor, system }),
      ),
    [recipe.ingredients, factor, system],
  );
  const steps = useMemo(
    () => recipe.steps.map((text) => presentStepText(text, { system })),
    [recipe.steps, system],
  );

  const amountFor = (count: number, chosenScale: string) =>
    base === null
      ? `at ${scaleLabel(chosenScale)}`
      : `for ${servingsText(count)}`;
  const announce = (count: number, chosenScale: string, units: UnitSystem) =>
    setAnnouncement(
      `Showing amounts ${amountFor(count, chosenScale)}, in ${units}.`,
    );
  const chooseServings = (count: number) => {
    setServings(count);
    setEntry(count);
    announce(count, scale, system);
  };

  const scaled = ingredients.some((line) => line.scaled);
  const converted = [...ingredients, ...steps].some((line) => line.converted);
  const done = [
    scaled &&
      (base === null
        ? `scaled to ${scaleLabel(scale)}`
        : `adjusted ${amountFor(servings, scale)}`),
    converted && `converted to ${system}`,
  ].filter(Boolean);
  const adjusted =
    done.length > 0
      ? `Amounts are ${done.join(', ')}${done.length > 1 ? ',' : ''} and rounded. Edit recipe shows them as written.`
      : null;
  const stepsNote =
    factor !== 1 && recipe.steps.length > 0
      ? `Amounts in the steps are for ${base === null ? 'the original recipe' : servingsText(base)}.`
      : null;

  const controls = (
    <Stack gap="xs" mb="sm">
      <Group align="flex-end" gap="md" wrap="wrap">
        {base === null ? (
          <div>
            <Text component="div" fw={500} fz="sm" id={`${ids}-scale`} mb={4}>
              Scale
            </Text>
            <SegmentedControl
              aria-labelledby={`${ids}-scale`}
              data={SCALES.map((item) => ({ ...item }))}
              onChange={(value) => {
                setScale(value);
                announce(servings, value, system);
              }}
              styles={touchLabel}
              value={scale}
            />
          </div>
        ) : (
          <Group align="flex-end" gap="xs" wrap="nowrap">
            <Button
              aria-label="Fewer servings"
              disabled={servings <= MIN_SERVINGS}
              onClick={() => chooseServings(servings - 1)}
              miw="var(--mp-touch-target)"
              px="sm"
              variant="default"
            >
              <span aria-hidden="true">−</span>
            </Button>
            <NumberInput
              allowDecimal={false}
              allowNegative={false}
              clampBehavior="strict"
              hideControls
              label="Servings"
              max={MAX_SERVINGS}
              min={MIN_SERVINGS}
              onBlur={() => setEntry(servings)}
              onChange={(value) => {
                setEntry(value);
                if (validServings(value) && value !== servings) {
                  setServings(value);
                  announce(value, scale, system);
                }
              }}
              value={entry}
              w="4.5rem"
            />
            <Button
              aria-label="More servings"
              disabled={servings >= MAX_SERVINGS}
              onClick={() => chooseServings(servings + 1)}
              miw="var(--mp-touch-target)"
              px="sm"
              variant="default"
            >
              <span aria-hidden="true">+</span>
            </Button>
            {servings !== base && (
              <Button onClick={() => chooseServings(base)} variant="subtle">
                Reset
              </Button>
            )}
          </Group>
        )}
        <div>
          <Text component="div" fw={500} fz="sm" id={`${ids}-units`} mb={4}>
            Units
          </Text>
          <SegmentedControl
            aria-labelledby={`${ids}-units`}
            data={(['metric', 'imperial'] as const).map((value) => ({
              value,
              label: UNIT_LABELS[value],
            }))}
            onChange={(value) => {
              if (!isUnitSystem(value)) return;
              setSystem(value);
              announce(servings, scale, value);
            }}
            styles={touchLabel}
            value={system}
          />
        </div>
      </Group>
      <VisuallyHidden aria-live="polite" data-testid="recipe-amounts-status">
        {announcement}
      </VisuallyHidden>
    </Stack>
  );

  const notes = (adjusted || stepsNote) && (
    <Stack gap={4} mt="sm">
      {adjusted && (
        <Text c="dimmed" data-testid="recipe-amounts-note" fz="sm">
          {adjusted}
        </Text>
      )}
      {stepsNote && (
        <Text c="dimmed" data-testid="recipe-steps-note" fz="sm">
          {stepsNote}
        </Text>
      )}
    </Stack>
  );

  return {
    ingredients: ingredients.map(({ text }) => text),
    steps: steps.map(({ text }) => text),
    controls,
    notes,
  };
}

/** The recipe page's body with servings and unit controls. */
export function AdjustableRecipeBody({
  recipe,
  ...props
}: Readonly<
  Omit<ComponentProps<typeof RecipeBody>, 'presented' | 'recipe'> & {
    recipe: Pick<Recipe, 'ingredients' | 'steps' | 'notes' | 'servings'>;
  }
>) {
  const presented = usePresentedRecipe(recipe);
  return <RecipeBody {...props} presented={presented} recipe={recipe} />;
}
