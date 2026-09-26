import {
  Alert,
  Anchor,
  Button,
  Group,
  List,
  Stack,
  Table,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { useRef, useState } from 'react';
import { ApiRequestError } from './api';
import { Link } from 'react-router-dom';
import { NutritionReview } from './NutritionReview';
import {
  DATA_TYPE_NAMES,
  formatNutrient,
  fetchProposals,
  reviewLines,
  needsCheck,
  type ReviewMode,
} from './nutrition-client';
import { touchLink } from './recipe-client';
import {
  NUTRIENTS,
  USDA_CITATION,
  type NutrientAmount,
  type NutrientKey,
  type RecipeNutrition,
  type IngredientProposal,
} from '../shared/nutrition';

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** A total, marked when some counted foods report no value for it. */
function Amount({
  nutrient,
  value,
  incomplete,
}: Readonly<{
  nutrient: NutrientKey;
  value: number | null;
  incomplete: boolean;
}>) {
  if (value === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <VisuallyHidden>no value</VisuallyHidden>
      </>
    );
  }
  return (
    <>
      {formatNutrient(nutrient, value)}
      {incomplete && (
        <>
          <span aria-hidden="true"> †</span>
          <VisuallyHidden> (incomplete)</VisuallyHidden>
        </>
      )}
    </>
  );
}

function NutritionTable({
  nutrition,
  totals,
}: Readonly<{
  nutrition: RecipeNutrition;
  totals: Record<NutrientKey, NutrientAmount>;
}>) {
  const { perServing, servings } = nutrition;
  return (
    <Table
      data-testid="nutrition-panel"
      horizontalSpacing="xs"
      layout="fixed"
      striped
    >
      <Table.Caption style={{ captionSide: 'top', textAlign: 'start' }}>
        <VisuallyHidden>
          Nutrition {perServing ? 'per serving and ' : ''}for the whole recipe
        </VisuallyHidden>
      </Table.Caption>
      <Table.Thead>
        <Table.Tr>
          {/* The widest row header, "Carbohydrate", fits a phone at 40%. */}
          <Table.Th scope="col" w="40%">
            Nutrient
          </Table.Th>
          {perServing && (
            <Table.Th scope="col">
              Per serving
              <Text
                c="dimmed"
                component="span"
                display="block"
                fw={400}
                fz="xs"
              >
                Serves {servings}
              </Text>
            </Table.Th>
          )}
          <Table.Th scope="col">Whole recipe</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {NUTRIENTS.map(({ key, label, sub }) => {
          const total = totals[key];
          const incomplete = total.missingFrom.length > 0;
          return (
            <Table.Tr key={key}>
              <Table.Th
                fw={sub ? 400 : 600}
                pl={sub ? 'lg' : undefined}
                scope="row"
              >
                {label}
              </Table.Th>
              {perServing && (
                <Table.Td>
                  <Amount
                    incomplete={incomplete}
                    nutrient={key}
                    value={perServing[key]}
                  />
                </Table.Td>
              )}
              <Table.Td>
                <Amount
                  incomplete={incomplete}
                  nutrient={key}
                  value={total.value}
                />
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

/** Names the counted foods with no USDA value for each incomplete total. */
function MissingValues({
  totals,
}: Readonly<{ totals: Record<NutrientKey, NutrientAmount> }>) {
  const notes = NUTRIENTS.filter(
    ({ key }) => totals[key].missingFrom.length > 0,
  );
  if (notes.length === 0) return null;
  return (
    <List
      data-testid="nutrition-missing"
      fz="sm"
      listStyleType="none"
      spacing={2}
    >
      {notes.map(({ key, label }) => {
        const foods = totals[key].missingFrom;
        return (
          <List.Item key={key}>
            <span aria-hidden="true">† </span>
            {label}: no value for {plural(foods.length, 'food', 'foods')} (
            {foods.join('; ')}).
          </List.Item>
        );
      })}
    </List>
  );
}

function Sources({ nutrition }: Readonly<{ nutrition: RecipeNutrition }>) {
  if (nutrition.sources.length === 0) return null;
  return (
    <details data-testid="nutrition-sources">
      {/* A summary keeps its own display, so its disclosure triangle shows;
          padding gives it the touch-target height. */}
      <summary style={{ cursor: 'pointer', paddingBlock: 10 }}>
        Sources ({nutrition.sources.length})
      </summary>
      <List fz="sm" mt="xs" spacing="xs">
        {nutrition.sources.map((source) => (
          <List.Item key={source.fdcId}>
            <Anchor
              href={source.url}
              rel="noopener noreferrer"
              style={{ overflowWrap: 'anywhere' }}
              target="_blank"
            >
              {source.name} (opens in a new tab)
            </Anchor>{' '}
            <Text c="dimmed" component="span" fz="sm">
              — {DATA_TYPE_NAMES[source.dataType]}, {source.release}
            </Text>
          </List.Item>
        ))}
      </List>
      <Text c="dimmed" fz="sm" mt="xs">
        {USDA_CITATION}
      </Text>
    </details>
  );
}

function ChangedNotice({
  count,
  onCheck,
}: Readonly<{ count: number; onCheck: () => void }>) {
  return (
    <Alert color="clay" data-testid="nutrition-changed" variant="light">
      <Stack align="flex-start" gap="xs">
        <Text fz="sm">
          {plural(count, 'ingredient', 'ingredients')} changed since nutrition
          was checked. {count === 1 ? 'It isn’t' : 'They aren’t'} counted.
        </Text>
        <Button onClick={onCheck} size="sm" variant="default">
          Check changed lines
        </Button>
      </Stack>
    </Alert>
  );
}

function NutritionSummary({
  nutrition,
  onReview,
}: Readonly<{
  nutrition: RecipeNutrition;
  onReview: (mode: ReviewMode, propose: boolean) => void;
}>) {
  const notCounted = nutrition.lines.filter(
    (line) => line.state === 'not_counted',
  );
  return (
    <Stack gap="sm">
      {nutrition.needsCheck > 0 && (
        <ChangedNotice
          count={nutrition.needsCheck}
          onCheck={() => onReview('changed', true)}
        />
      )}
      {nutrition.totals ? (
        <>
          <NutritionTable nutrition={nutrition} totals={nutrition.totals} />
          <MissingValues totals={nutrition.totals} />
        </>
      ) : (
        <Text>No ingredients are counted yet.</Text>
      )}
      <Text data-testid="nutrition-coverage" fz="sm">
        {nutrition.counted} of{' '}
        {plural(nutrition.lines.length, 'ingredient', 'ingredients')} counted.
      </Text>
      {notCounted.length > 0 && (
        <Text fz="sm">
          Not counted: {notCounted.map((line) => line.text).join('; ')}.
        </Text>
      )}
      {nutrition.servings === null && nutrition.totals && (
        <Text fz="sm">
          Add servings to see values per serving.{' '}
          <Anchor
            component={Link}
            state={{ from: 'detail' }}
            style={touchLink}
            to="edit"
          >
            Edit recipe
          </Anchor>
        </Text>
      )}
      <Text c="dimmed" fz="sm">
        Estimated from USDA FoodData Central. Not dietary advice.
      </Text>
      <Sources nutrition={nutrition} />
      <Group>
        <Button onClick={() => onReview('all', false)} variant="default">
          Edit matches
        </Button>
      </Group>
    </Stack>
  );
}

export interface RecipeNutritionSectionProps {
  recipeId: string;
  nutrition: RecipeNutrition;
  onSaved: (nutrition: RecipeNutrition) => void;
  /** The recipe changed meanwhile; reload the page's copy of it. */
  onRecipeChanged: () => void;
}

/**
 * The recipe page's Nutrition section (the #84 design): the label panel per
 * serving and for the whole recipe, calculated by the Worker from USDA data
 * and the household's confirmed matches, and the review that confirms them.
 */
export function RecipeNutritionSection({
  recipeId,
  nutrition,
  onSaved,
  onRecipeChanged,
}: Readonly<RecipeNutritionSectionProps>) {
  const [review, setReview] = useState<ReviewMode | null>(null);
  const [proposals, setProposals] = useState<IngredientProposal[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const open = async (mode: ReviewMode, propose: boolean) => {
    trigger.current = document.activeElement as HTMLElement | null;
    setStatus('');
    if (!propose) {
      setProposals([]);
      setUnavailable(false);
      setReview(mode);
      return;
    }
    setWorking(true);
    setStatus('Matching ingredients… This can take up to 30 seconds.');
    const positions = reviewLines(nutrition, mode)
      .filter((line) =>
        needsCheck(
          nutrition.lines.find((item) => item.position === line.position)!,
        ),
      )
      .map((line) => line.position);
    try {
      const answer = await fetchProposals(
        recipeId,
        nutrition.recipeVersion,
        positions,
      );
      setProposals(answer.proposals ?? []);
      setUnavailable(answer.provider === null);
      setReview(mode);
      setStatus('');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        onRecipeChanged();
        setStatus(
          'This recipe was changed by someone else. Review its current ingredients and try again.',
        );
      } else {
        setProposals([]);
        setUnavailable(true);
        setReview(mode);
        setStatus('');
      }
    } finally {
      setWorking(false);
    }
  };

  const close = () => {
    setReview(null);
    trigger.current?.focus();
  };

  const saved = (next: RecipeNutrition) => {
    setReview(null);
    onSaved(next);
    setStatus('Nutrition saved.');
    heading.current?.focus();
  };

  return (
    <section aria-labelledby="recipe-nutrition" data-testid="recipe-nutrition">
      <Title
        id="recipe-nutrition"
        mb="xs"
        order={2}
        ref={heading}
        tabIndex={-1}
      >
        Nutrition
      </Title>
      <Text
        aria-live="polite"
        component="output"
        display="block"
        fz="sm"
        mb={status ? 'xs' : 0}
      >
        {status}
      </Text>
      {nutrition.checked ? (
        <NutritionSummary
          nutrition={nutrition}
          onReview={(mode, propose) => {
            void open(mode, propose);
          }}
        />
      ) : (
        <Stack align="flex-start" gap="xs">
          <Text>Nutrition hasn’t been worked out for this recipe.</Text>
          <Button loading={working} onClick={() => void open('all', true)}>
            Work out nutrition
          </Button>
        </Stack>
      )}
      {review && (
        <NutritionReview
          mode={review}
          initialProposals={proposals}
          initialUnavailable={unavailable}
          nutrition={nutrition}
          onClose={close}
          onRecipeChanged={onRecipeChanged}
          onSaved={saved}
          recipeId={recipeId}
        />
      )}
    </section>
  );
}
