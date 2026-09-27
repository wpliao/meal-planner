import {
  Alert,
  Anchor,
  Button,
  Card,
  List,
  Stack,
  Table,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { Link } from 'react-router-dom';
import { dayLabel } from './meal-plan-client';
import { formatNutrient } from './nutrition-client';
import { touchLink } from './recipe-client';
import type { NutritionState } from './useMealPlanNutrition';
import type {
  PlanNutritionDay,
  PlanNutritionGapReason,
  PlanNutritionSummary,
} from '../shared/meal-plan-nutrition';
import { NUTRIENTS, USDA_CITATION } from '../shared/nutrition';

const REASON: Record<PlanNutritionGapReason, string> = {
  text_meal: 'No nutrition for text meals',
  recipe_removed: 'Recipe removed',
  add_servings: 'Add servings',
  work_out_nutrition: 'Work out nutrition',
  check_ingredients: 'Check recipe nutrition',
  not_counted: 'An ingredient was not counted',
  missing_usda_values: 'Some USDA values are missing',
};

function Amount({
  value,
  partial,
  nutrient,
}: Readonly<{
  value: number | null;
  partial: boolean;
  nutrient: (typeof NUTRIENTS)[number]['key'];
}>) {
  return (
    <>
      {value === null ? (
        <>
          <span aria-hidden="true">—</span>
          <VisuallyHidden>no known value</VisuallyHidden>
        </>
      ) : (
        formatNutrient(nutrient, value)
      )}
      {partial && <Text component="span"> · Partial</Text>}
    </>
  );
}

function NutritionTable({
  caption,
  summary,
}: Readonly<{ caption: string; summary: PlanNutritionSummary | null }>) {
  return (
    <Table
      aria-busy={summary === null}
      horizontalSpacing="xs"
      layout="fixed"
      striped
    >
      <Table.Caption style={{ captionSide: 'top', textAlign: 'start' }}>
        {caption}
      </Table.Caption>
      <Table.Thead>
        <Table.Tr>
          <Table.Th scope="col" w="48%">
            Nutrient
          </Table.Th>
          <Table.Th scope="col">Estimate</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {NUTRIENTS.map(({ key, label, sub }) => (
          <Table.Tr key={key}>
            <Table.Th
              fw={sub ? 400 : 600}
              pl={sub ? 'lg' : undefined}
              scope="row"
            >
              {label}
            </Table.Th>
            <Table.Td>
              {summary === null ? (
                <Text c="dimmed">…</Text>
              ) : (
                <Amount nutrient={key} {...summary.nutrients[key]} />
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function Gaps({ summary }: Readonly<{ summary: PlanNutritionSummary }>) {
  if (summary.gaps.length === 0) return null;
  return (
    <details>
      <summary style={{ cursor: 'pointer', minHeight: 44, paddingTop: 10 }}>
        Needs attention ({summary.gaps.length})
      </summary>
      <List spacing="xs">
        {summary.gaps.map((gap) => (
          <List.Item key={gap.entryId}>
            {gap.recipeId ? (
              <Anchor
                component={Link}
                style={touchLink}
                to={`/recipes/${encodeURIComponent(gap.recipeId)}`}
              >
                {gap.title} on {dayLabel(gap.date)}
              </Anchor>
            ) : (
              <Text component="span">
                {gap.title} on {dayLabel(gap.date)}
              </Text>
            )}
            : {gap.reasons.map((reason) => REASON[reason]).join('; ')}.
          </List.Item>
        ))}
      </List>
    </details>
  );
}

export function WeekNutrition({
  state,
  retry,
  planned,
}: Readonly<{ state: NutritionState; retry: () => void; planned: number }>) {
  const shown =
    state.kind === 'ready' && state.value.week.planned !== planned
      ? ({ kind: 'loading' } as const)
      : state;
  return (
    <Card
      aria-labelledby="plan-nutrition-title"
      component="section"
      data-testid="plan-nutrition"
      mb="md"
      padding="md"
      radius="md"
      withBorder
    >
      <Title id="plan-nutrition-title" mb="xs" order={3}>
        Week nutrition estimate
      </Title>
      {shown.kind === 'loading' && (
        <Stack gap="xs">
          <Text component="output">Checking nutrition…</Text>
          {planned > 0 && (
            <>
              <NutritionTable
                caption="Nutrition for the displayed Monday–Sunday week"
                summary={null}
              />
              <div aria-hidden="true" style={{ minHeight: 44 }} />
              <Text c="dimmed" fz="xs">
                Estimate, not dietary advice. {USDA_CITATION}
              </Text>
            </>
          )}
        </Stack>
      )}
      {shown.kind === 'unavailable' && (
        <Stack align="flex-start" gap="xs">
          <Alert color="clay" variant="light">
            We could not load nutrition. The plan is still available.
          </Alert>
          <Button onClick={retry} variant="default">
            Try nutrition again
          </Button>
        </Stack>
      )}
      {shown.kind === 'ready' && (
        <Stack gap="xs">
          {shown.value.week.planned === 0 ? (
            <Text>Add a recipe to see a nutrition estimate.</Text>
          ) : (
            <>
              <Text fz="sm">
                Based on one serving of each included recipe entry.{' '}
                {shown.value.week.included} of {shown.value.week.planned}{' '}
                planned entries included.
              </Text>
              <NutritionTable
                caption="Nutrition for the displayed Monday–Sunday week"
                summary={shown.value.week}
              />
              <Gaps summary={shown.value.week} />
              <Text c="dimmed" fz="xs">
                Estimate, not dietary advice. {USDA_CITATION} Check each recipe
                for its food sources.
              </Text>
            </>
          )}
        </Stack>
      )}
    </Card>
  );
}

export function DayNutrition({ day }: Readonly<{ day: PlanNutritionDay }>) {
  if (day.planned === 0) return null;
  const energy = day.nutrients.energyKj;
  const protein = day.nutrients.proteinG;
  return (
    <div data-testid="plan-day-nutrition">
      <Text fz="sm">
        Day nutrition estimate:{' '}
        {energy.value === null ? '—' : formatNutrient('energyKj', energy.value)}
        ; protein{' '}
        {protein.value === null
          ? '—'
          : formatNutrient('proteinG', protein.value)}
        . {day.included} of {day.planned} planned entries included.
      </Text>
      <details>
        <summary style={{ cursor: 'pointer', minHeight: 44, paddingTop: 10 }}>
          Show all nutrients for {dayLabel(day.date)}
        </summary>
        <NutritionTable
          caption={`Nutrition for ${dayLabel(day.date)}`}
          summary={day}
        />
      </details>
    </div>
  );
}
