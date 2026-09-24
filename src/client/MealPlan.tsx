import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Menu,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api, type Notice } from './api';
import {
  AddEntryDialog,
  ClearWeekDialog,
  EditEntryDialog,
  MoveEntryDialog,
  RemoveEntryDialog,
  type DialogOutcome,
} from './MealPlanDialogs';
import {
  dayLabel,
  groupWeek,
  placeLabel,
  resolveWeek,
  slotLabel,
  today,
  weekHeading,
  weekPath,
  weekQuery,
} from './meal-plan-client';
import { touchLink } from './recipe-client';
import {
  addPlanDays,
  isClearableWeek,
  isPlanDate,
  MEAL_PLAN_USAGE_HINT_AT,
  MEAL_SLOTS,
  planWeekDates,
  planWeekStart,
  type MealPlanEntry,
  type MealPlanResponse,
  type MealPlanUsage,
  type MealSlot,
} from '../shared/meal-plan';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; entries: MealPlanEntry[]; usage: MealPlanUsage }
  | { kind: 'unavailable' };

type Dialog =
  | { kind: 'add'; date: string; slot: MealSlot }
  | { kind: 'move' | 'edit' | 'remove'; entry: MealPlanEntry }
  /** The entries on screen when Clear was chosen: exactly what is cleared. */
  | { kind: 'clear'; entries: MealPlanEntry[] };

const wrap = { overflowWrap: 'anywhere' } as const;
const slotKey = (date: string, slot: MealSlot) => `${date}:${slot}`;

/** Days sit in one column on a phone and a grid where there is room. */
const DAY_GRID = {
  display: 'grid',
  gap: 'var(--mantine-spacing-md)',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 17rem), 1fr))',
} as const;

/** `/plan` and `/plan/:weekStart`: one week of the shared family plan. */
export function MealPlan() {
  const { weekStart: param } = useParams();
  const todayDate = today();
  const { weekStart, replace } = resolveWeek(param, todayDate);

  if (replace) return <Navigate replace to={weekPath(weekStart)} />;
  return <Week key={weekStart} today={todayDate} weekStart={weekStart} />;
}

function Week({
  weekStart,
  today: todayDate,
}: Readonly<{ weekStart: string; today: string }>) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [notice, setNotice] = useState<Notice>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Registries of the controls focus returns to. They are filled by ref
  // callbacks and read only in handlers, so they are stable objects rather
  // than state that would re-render the week.
  const [addButtons] = useState(() => new Map<string, HTMLButtonElement>());
  const [menuButtons] = useState(() => new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<(() => void) | null>(null);
  const scrolled = useRef(false);

  const currentWeek = planWeekStart(todayDate);
  const isCurrentWeek = weekStart === currentWeek;

  const load = useCallback(async () => {
    try {
      const response = await api<MealPlanResponse>(weekQuery(weekStart));
      setState({
        kind: 'ready',
        entries: response.entries,
        usage: response.usage,
      });
    } catch {
      setState({ kind: 'unavailable' });
    }
  }, [weekStart]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  // Focus moves only after the week has re-rendered with the change, so the
  // control it lands on is the one on screen.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const focus = pendingFocus.current;
    pendingFocus.current = null;
    focus?.();
  }, [state]);

  // On a phone the current week opens at today rather than at Monday.
  useEffect(() => {
    if (state.kind !== 'ready' || !isCurrentWeek || scrolled.current) return;
    scrolled.current = true;
    if (!window.matchMedia('(max-width: 40em)').matches) return;
    document
      .getElementById(`day-${todayDate}`)
      ?.closest('section')
      ?.scrollIntoView?.({ block: 'start' });
  }, [state, isCurrentWeek, todayDate]);

  const retry = () => {
    setState({ kind: 'loading' });
    void load();
  };

  /**
   * Where focus goes when a dialog closes: back to the control that opened
   * it, or, when that control is gone, to the nearest one that remains.
   */
  const focusTargets = (
    closing: Dialog,
  ): { opener: () => void; remaining: () => void } => {
    if (closing.kind === 'clear') {
      // A cleared week has no Clear button, so its heading takes focus.
      return {
        opener: () => clearButton.current?.focus(),
        remaining: () => heading.current?.focus(),
      };
    }
    const addButton =
      closing.kind === 'add'
        ? slotKey(closing.date, closing.slot)
        : slotKey(closing.entry.date, closing.entry.slot);
    return {
      opener:
        closing.kind === 'add'
          ? () => addButtons.get(addButton)?.focus()
          : () => menuButtons.get(closing.entry.id)?.focus(),
      remaining: () => addButtons.get(addButton)?.focus(),
    };
  };

  const closeDialog = async (closing: Dialog, outcome: DialogOutcome) => {
    setDialog(null);
    const { opener, remaining } = focusTargets(closing);

    if (outcome.kind === 'cancelled') {
      opener();
      return;
    }
    // After a change the week is read again; an entry that left its meal
    // hands focus to that meal's Add button.
    pendingFocus.current =
      outcome.kind === 'saved' && !outcome.left ? opener : remaining;
    setNotice(
      outcome.kind === 'saved'
        ? { tone: 'success', message: outcome.message }
        : {
            tone: 'error',
            message:
              closing.kind === 'clear'
                ? 'This week had already been cleared.'
                : 'That entry had already been removed by someone else.',
          },
    );
    await load();
  };

  const week =
    state.kind === 'ready' ? groupWeek(weekStart, state.entries) : null;

  return (
    <Card
      aria-labelledby="plan-title"
      component="section"
      data-testid="plan-panel"
      padding="lg"
      radius="lg"
      withBorder
    >
      <Text c="clay.8" fw={700} fz="xs" tt="uppercase">
        Kitchen
      </Text>
      <Title id="plan-title" mb="xs" order={1}>
        Plan
      </Title>

      <Group align="center" justify="space-between" mb="md" wrap="wrap">
        <Title data-testid="plan-week" order={2} ref={heading} tabIndex={-1}>
          {weekHeading(weekStart)}
        </Title>
        <Group aria-label="Weeks" component="nav" gap="xs">
          <Button
            component={Link}
            to={weekPath(addPlanDays(weekStart, -7))}
            variant="default"
          >
            Previous week
          </Button>
          <Button
            aria-current={isCurrentWeek ? 'page' : undefined}
            component={Link}
            to={weekPath(currentWeek)}
            variant={isCurrentWeek ? 'filled' : 'default'}
          >
            This week
          </Button>
          <Button
            component={Link}
            to={weekPath(addPlanDays(weekStart, 7))}
            variant="default"
          >
            Next week
          </Button>
        </Group>
      </Group>

      {state.kind === 'ready' &&
        state.entries.length > 0 &&
        isClearableWeek(weekStart, todayDate) && (
          <Group justify="flex-end" mb="md">
            <Button
              aria-label={`Clear this week, ${weekHeading(weekStart)}`}
              color="clay"
              onClick={() =>
                setDialog({ kind: 'clear', entries: state.entries })
              }
              ref={clearButton}
              variant="outline"
            >
              Clear this week
            </Button>
          </Group>
        )}

      {/* One live region for results. It stays mounted so a new message is
          announced, and it does not take focus: focus goes back to the
          control the member was using. */}
      <div aria-live="polite" data-testid="plan-result" role="status">
        {notice && (
          <Alert
            color={notice.tone === 'success' ? 'sage' : 'clay'}
            mb="md"
            style={wrap}
          >
            {notice.message}
          </Alert>
        )}
      </div>

      {state.kind === 'loading' && (
        <Text component="output">Checking the plan…</Text>
      )}

      {state.kind === 'unavailable' && (
        <Stack align="flex-start" gap="sm">
          <Text component="output">
            We could not load the plan. Please try again.
          </Text>
          <Button onClick={retry} variant="default">
            Try again
          </Button>
        </Stack>
      )}

      {week && state.kind === 'ready' && (
        <>
          <UsageHint usage={state.usage} weekStart={weekStart} />
          {state.entries.length === 0 && (
            <Text c="dimmed" data-testid="plan-empty" mb="md">
              Nothing is planned for this week yet. Use Add under any meal to
              plan a recipe or a meal such as “Leftovers”.
            </Text>
          )}
          <Box data-testid="plan-days" style={DAY_GRID}>
            {planWeekDates(weekStart).map((date) => (
              <Day
                addButtons={addButtons}
                date={date}
                isToday={date === todayDate}
                key={date}
                menuButtons={menuButtons}
                onAction={setDialog}
                slots={week[date]}
              />
            ))}
          </Box>
        </>
      )}

      {dialog?.kind === 'add' && (
        <AddEntryDialog
          onClose={(outcome) => void closeDialog(dialog, outcome)}
          target={dialog}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveEntryDialog
          entry={dialog.entry}
          onClose={(outcome) => void closeDialog(dialog, outcome)}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditEntryDialog
          entry={dialog.entry}
          onClose={(outcome) => void closeDialog(dialog, outcome)}
        />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveEntryDialog
          entry={dialog.entry}
          onClose={(outcome) => void closeDialog(dialog, outcome)}
        />
      )}
      {dialog?.kind === 'clear' && (
        <ClearWeekDialog
          entries={dialog.entries}
          onChanged={() => void load()}
          onClose={(outcome) => void closeDialog(dialog, outcome)}
          weekStart={weekStart}
        />
      )}
    </Card>
  );
}

/**
 * Near the household limit, every week says how full the plan is and links
 * to the oldest planned week, where clearing can start (decisions 2 and 3 of
 * the #56 design). It is static text in reading order, not a live region, so
 * it is not announced again on every load.
 */
function UsageHint({
  usage,
  weekStart,
}: Readonly<{ usage: MealPlanUsage; weekStart: string }>) {
  if (usage.entries < MEAL_PLAN_USAGE_HINT_AT) return null;
  const used = `${usage.entries.toLocaleString('en')} of ${usage.limit.toLocaleString('en')} planned meals`;
  const oldestWeek =
    usage.oldestDate && isPlanDate(usage.oldestDate)
      ? planWeekStart(usage.oldestDate)
      : null;
  return (
    <Alert color="clay" data-testid="plan-usage" mb="md" style={wrap}>
      <Text fz="sm">
        {usage.entries >= usage.limit
          ? `The plan is full: ${used}. Clear old weeks before adding more.`
          : `The plan holds ${used}. Clear old weeks to make room for new plans.`}
      </Text>
      {oldestWeek && oldestWeek !== weekStart && (
        <Anchor
          component={Link}
          fz="sm"
          style={touchLink}
          to={weekPath(oldestWeek)}
        >
          Go to the oldest planned week
        </Anchor>
      )}
    </Alert>
  );
}

function Day({
  date,
  isToday,
  slots,
  addButtons,
  menuButtons,
  onAction,
}: Readonly<{
  date: string;
  isToday: boolean;
  slots: Record<MealSlot, MealPlanEntry[]>;
  addButtons: Map<string, HTMLButtonElement>;
  menuButtons: Map<string, HTMLButtonElement>;
  onAction: (dialog: Dialog) => void;
}>) {
  const headingId = `day-${date}`;
  return (
    <Card
      aria-labelledby={headingId}
      component="section"
      data-testid="plan-day"
      data-today={isToday || undefined}
      padding="md"
      radius="md"
      style={
        isToday
          ? { borderColor: 'var(--mantine-color-sage-7)', borderWidth: 2 }
          : undefined
      }
      withBorder
    >
      <Group gap="xs" mb="xs">
        <Title id={headingId} order={3}>
          {dayLabel(date)}
        </Title>
        {isToday && (
          <Badge color="sage.9" variant="filled">
            Today
          </Badge>
        )}
      </Group>
      <Stack gap="sm">
        {MEAL_SLOTS.map((slot) => {
          const labelId = `slot-${date}-${slot}`;
          const entries = slots[slot];
          return (
            <div data-testid={`slot-${slot}`} key={slot}>
              {/* The meal is the label; its dishes and Add sit in an
                  indented block under it, in smaller type, so the order
                  reads day, then meal, then dish (owner review, V-DEV-P1). */}
              <Text fw={700} fz="md" id={labelId}>
                {slotLabel(slot)}
              </Text>
              <Box
                data-testid="slot-body"
                ml={4}
                mt={4}
                pl="sm"
                style={{
                  borderLeft: '2px solid var(--mantine-color-paper-3)',
                }}
              >
                {entries.length > 0 && (
                  <Stack
                    aria-labelledby={labelId}
                    component="ul"
                    gap={0}
                    m={0}
                    p={0}
                    style={{ listStyle: 'none' }}
                  >
                    {entries.map((entry) => (
                      <Entry
                        entry={entry}
                        key={entry.id}
                        menuButtons={menuButtons}
                        onAction={onAction}
                      />
                    ))}
                  </Stack>
                )}
                <Button
                  aria-label={`Add to ${slotLabel(slot).toLowerCase()}, ${dayLabel(date)}`}
                  onClick={() => onAction({ kind: 'add', date, slot })}
                  ref={(element) => {
                    if (element) addButtons.set(slotKey(date, slot), element);
                    else addButtons.delete(slotKey(date, slot));
                  }}
                  px={0}
                  size="xs"
                  variant="subtle"
                >
                  + Add
                </Button>
              </Box>
            </div>
          );
        })}
      </Stack>
    </Card>
  );
}

function Entry({
  entry,
  menuButtons,
  onAction,
}: Readonly<{
  entry: MealPlanEntry;
  menuButtons: Map<string, HTMLButtonElement>;
  onAction: (dialog: Dialog) => void;
}>) {
  const linked = entry.kind === 'recipe' && entry.recipeId !== null;
  const removed = entry.kind === 'recipe' && entry.recipeRemoved;
  return (
    <Group
      align="flex-start"
      component="li"
      data-testid="plan-entry"
      gap="xs"
      justify="space-between"
      wrap="nowrap"
    >
      <Box style={{ minWidth: 0 }}>
        {linked ? (
          <Anchor
            component={Link}
            fw={600}
            fz="sm"
            style={{ ...touchLink, ...wrap }}
            to={`/recipes/${entry.recipeId}`}
          >
            {entry.title}
          </Anchor>
        ) : (
          <Text fw={500} fz="sm" style={{ ...touchLink, ...wrap }}>
            {entry.title}
          </Text>
        )}
        {removed && (
          <Text c="dimmed" fz="xs">
            No longer in the recipe library
          </Text>
        )}
        {entry.note && (
          <Text c="dimmed" fz="xs" style={wrap}>
            {entry.note}
          </Text>
        )}
      </Box>
      <Menu position="bottom-end" shadow="md" withinPortal={false}>
        <Menu.Target>
          <Button
            aria-label={`Actions for ${entry.title}, ${placeLabel(entry.date, entry.slot)}`}
            px="xs"
            ref={(element) => {
              if (element) menuButtons.set(entry.id, element);
              else menuButtons.delete(entry.id);
            }}
            variant="subtle"
          >
            <span aria-hidden="true">…</span>
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => onAction({ kind: 'move', entry })}>
            Move
          </Menu.Item>
          <Menu.Item onClick={() => onAction({ kind: 'edit', entry })}>
            Edit
          </Menu.Item>
          <Menu.Item
            c="clay.8"
            onClick={() => onAction({ kind: 'remove', entry })}
          >
            Remove
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
