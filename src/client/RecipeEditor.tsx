import {
  ActionIcon,
  Alert,
  Button,
  Fieldset,
  Group,
  List,
  Stack,
  Text,
  Textarea,
  TextInput,
  VisuallyHidden,
} from '@mantine/core';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type SubmitEvent,
  type ReactNode,
} from 'react';
import type { Notice } from './api';
import { RecipeNotice, SourceLink } from './RecipeParts';
import {
  importHost,
  safeSourceHref,
  truncationMessage,
  validateRecipeForm,
  type RecipeEditorDraft,
  type RecipeFormErrors,
  type RecipeImportContext,
} from './recipe-client';
import {
  RECIPE_INGREDIENT_MAX_LENGTH,
  RECIPE_INGREDIENTS_MAX,
  RECIPE_NOTES_MAX_LENGTH,
  RECIPE_SERVINGS_MAX,
  RECIPE_SERVINGS_MIN,
  RECIPE_STEP_MAX_LENGTH,
  RECIPE_STEPS_MAX,
  RECIPE_TITLE_MAX_LENGTH,
  type RecipeContent,
} from '../shared/recipes';

interface Line {
  key: number;
  text: string;
}

interface FocusTarget {
  key: number;
  control: 'input' | 'up' | 'down';
}

/**
 * Lines need identities that survive reordering, so React moves an input with
 * its text and focus instead of relabelling it. Any unique number will do.
 */
let lineKeyCounter = 0;
const nextLineKey = (): number => {
  lineKeyCounter += 1;
  return lineKeyCounter;
};

/**
 * A control that cannot act here — moving the first line up — is hidden
 * rather than greyed out. It keeps its space so the other controls stay in
 * their columns, and it leaves the keyboard and accessibility tree, so no one
 * lands on a button that does nothing. A greyed glyph would also read as
 * low-contrast text.
 */
const UNAVAILABLE = { visibility: 'hidden' } as const;

const NO_ERRORS: RecipeFormErrors = { ingredientLines: {}, stepLines: {} };

const count = (value: number) => value.toLocaleString('en-US');

/**
 * Mantine's `inputContainer` render prop, built outside the component so the
 * row is not a component defined during render. The label stays above the
 * whole row; the field and its controls share the line below it, and when the
 * list is too narrow for both — a phone — the controls wrap under the field
 * instead of squeezing it. A step's textarea always takes the full width.
 */
const lineRow =
  (controls: ReactNode, multiline: boolean) => (control: ReactNode) => (
    <Group align="flex-start" gap="xs" wrap="wrap">
      <div style={{ flex: multiline ? '1 1 100%' : '1 1 14rem', minWidth: 0 }}>
        {control}
      </div>
      {controls}
    </Group>
  );

interface LineListProps {
  legend: string;
  /** "Ingredient" or "Step": names each line and its controls. */
  itemLabel: string;
  description: string;
  lines: readonly Line[];
  onChange: (lines: Line[]) => void;
  max: number;
  multiline?: boolean;
  error?: string;
  lineErrors: Record<number, string>;
}

/**
 * An ordered list of editable lines. Reordering uses Move up and Move down
 * buttons rather than drag and drop, so it works from a keyboard and a
 * screen reader. After a move, focus follows the line that moved and the new
 * position is announced.
 */
function LineList({
  legend,
  itemLabel,
  description,
  lines,
  onChange,
  max,
  multiline = false,
  error,
  lineErrors,
}: Readonly<LineListProps>) {
  const id = useId();
  const controls = useRef(new Map<string, HTMLElement>());
  // Where focus goes once the reordered, added, or removed lines render.
  const pendingFocus = useRef<FocusTarget | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const lower = itemLabel.toLowerCase();

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    controls.current.get(`${target.key}:${target.control}`)?.focus();
  }, [lines]);

  const register =
    (key: number, control: string) => (el: HTMLElement | null) => {
      const name = `${key}:${control}`;
      if (el) controls.current.set(name, el);
      else controls.current.delete(name);
    };

  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    const next = lines.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
    // Keep focus on the same control unless it has just become unavailable
    // at the top or bottom; then the opposite one takes it.
    let control: 'up' | 'down' = offset === -1 ? 'up' : 'down';
    if (target === 0) control = 'down';
    if (target === next.length - 1) control = 'up';
    pendingFocus.current = { key: moved.key, control };
    setAnnouncement(
      `Moved ${lower} to position ${target + 1} of ${next.length}.`,
    );
  };

  const remove = (index: number) => {
    const next = lines.filter((_, position) => position !== index);
    onChange(next);
    const neighbour = next[Math.min(index, next.length - 1)];
    pendingFocus.current = { key: neighbour.key, control: 'input' };
    setAnnouncement(`Removed ${lower} ${index + 1}.`);
  };

  const add = () => {
    const key = nextLineKey();
    onChange([...lines, { key, text: '' }]);
    pendingFocus.current = { key, control: 'input' };
  };

  const full = lines.length >= max;
  const errorId = `${id}-error`;

  return (
    // Tighter side padding than Mantine's default: on a phone the fieldset
    // sits inside the card's own padding, and every pixel goes to the field.
    <Fieldset
      aria-describedby={error ? errorId : undefined}
      legend={legend}
      pb="md"
      pt="xs"
      px="sm"
      radius="md"
      styles={{ legend: { fontWeight: 700 } }}
    >
      <Text c="dimmed" fz="sm" mb="sm">
        {description} {count(lines.length)} of {count(max)}.
      </Text>
      <List
        listStyleType="none"
        spacing="sm"
        styles={{
          itemWrapper: { width: '100%' },
          itemLabel: { width: '100%' },
        }}
        type={multiline ? 'ordered' : 'unordered'}
      >
        {lines.map((line, index) => {
          const buttons = (
            <Group gap="xs" ml="auto" wrap="nowrap">
              <ActionIcon
                aria-label={`Move ${lower} ${index + 1} up`}
                disabled={index === 0}
                style={index === 0 ? UNAVAILABLE : undefined}
                onClick={() => move(index, -1)}
                ref={register(line.key, 'up')}
                size="xl"
                variant="default"
              >
                <span aria-hidden="true">↑</span>
              </ActionIcon>
              <ActionIcon
                aria-label={`Move ${lower} ${index + 1} down`}
                disabled={index === lines.length - 1}
                style={index === lines.length - 1 ? UNAVAILABLE : undefined}
                onClick={() => move(index, 1)}
                ref={register(line.key, 'down')}
                size="xl"
                variant="default"
              >
                <span aria-hidden="true">↓</span>
              </ActionIcon>
              <ActionIcon
                aria-label={`Remove ${lower} ${index + 1}`}
                disabled={lines.length === 1}
                style={lines.length === 1 ? UNAVAILABLE : undefined}
                onClick={() => remove(index)}
                size="xl"
                variant="default"
              >
                <span aria-hidden="true">✕</span>
              </ActionIcon>
            </Group>
          );
          const field = {
            error: lineErrors[index],
            label: `${itemLabel} ${index + 1}`,
            inputContainer: lineRow(buttons, multiline),
            onChange: (
              event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) => {
              const text = event.currentTarget.value;
              onChange(
                lines.map((current) =>
                  current.key === line.key ? { ...current, text } : current,
                ),
              );
            },
            ref: register(line.key, 'input'),
            value: line.text,
          };
          return (
            <List.Item data-testid={`${lower}-line`} key={line.key}>
              {multiline ? (
                <Textarea {...field} rows={3} />
              ) : (
                <TextInput {...field} />
              )}
            </List.Item>
          );
        })}
      </List>
      {error && (
        <Text c="clay.8" fz="sm" id={errorId} mt="sm">
          {error}
        </Text>
      )}
      <Button disabled={full} mt="sm" onClick={add} variant="default">
        Add {lower}
      </Button>
      {full && (
        <Text c="dimmed" fz="sm" mt="xs">
          A recipe holds at most {count(max)} {lower}s.
        </Text>
      )}
      <VisuallyHidden aria-live="polite">{announcement}</VisuallyHidden>
    </Fieldset>
  );
}

export interface RecipeEditorProps {
  /** Read once, when the form first renders; later changes are ignored. */
  initialDraft: RecipeEditorDraft;
  /** Set for a website import preview: shows provenance and truncation. */
  importContext?: RecipeImportContext;
  /**
   * Offers the recipe link field (#113). Only a manually entered recipe takes
   * one; an import shows its own source instead. Defaults to true unless
   * importing.
   */
  linkable?: boolean;
  submitLabel: string;
  pending: boolean;
  /** Prevents saving, with a reason, while a conflict is unresolved. */
  blockedReason?: string;
  /** A save result shown beside the actions. The form keeps what was typed. */
  notice?: Notice;
  onSubmit: (content: RecipeContent) => void;
  onCancel: () => void;
  /** Content shown above the form fields, such as a conflict panel. */
  children?: ReactNode;
}

const toLines = (values: readonly string[]): Line[] =>
  (values.length > 0 ? values : ['']).map((text) => ({
    key: nextLineKey(),
    text,
  }));

/**
 * The one form for creating, editing, and reviewing an imported recipe. It
 * owns the draft, so nothing the member typed is lost when a save fails —
 * whether validation, the network, or a conflict stopped it.
 */
export function RecipeEditor({
  initialDraft,
  importContext,
  linkable = !importContext,
  submitLabel,
  pending,
  blockedReason,
  notice = null,
  onSubmit,
  onCancel,
  children,
}: Readonly<RecipeEditorProps>) {
  const [title, setTitle] = useState(initialDraft.title);
  const [ingredients, setIngredients] = useState<Line[]>(() =>
    toLines(initialDraft.ingredients),
  );
  const [steps, setSteps] = useState<Line[]>(() => toLines(initialDraft.steps));
  const [notes, setNotes] = useState(initialDraft.notes ?? '');
  const [servings, setServings] = useState(
    initialDraft.servings == null ? '' : String(initialDraft.servings),
  );
  const [link, setLink] = useState(initialDraft.link ?? '');
  const [errors, setErrors] = useState<RecipeFormErrors>(NO_ERRORS);
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // A failed validation moves focus to the first field with a problem, whose
  // message is attached to it and read out with it. A list-level problem,
  // such as no ingredients at all, focuses that list's first line.
  useEffect(() => {
    if (attempt === 0) return;
    formRef.current
      ?.querySelector<HTMLElement>(
        '[aria-invalid="true"], fieldset[aria-describedby] input, fieldset[aria-describedby] textarea',
      )
      ?.focus();
  }, [attempt]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || blockedReason) return;
    const result = validateRecipeForm({
      title,
      ingredients: ingredients.map((line) => line.text),
      steps: steps.map((line) => line.text),
      notes,
      servings,
      link: linkable ? link : '',
    });
    if (!result.ok) {
      setErrors(result.errors);
      setAttempt((value) => value + 1);
      return;
    }
    setErrors(NO_ERRORS);
    onSubmit(result.content);
  };

  const problems = [
    errors.title,
    errors.servings,
    errors.link,
    errors.ingredients,
    ...Object.values(errors.ingredientLines),
    errors.steps,
    ...Object.values(errors.stepLines),
    errors.notes,
  ].filter((message): message is string => Boolean(message));

  const host = importContext ? importHost(importContext.source) : null;
  const href = importContext ? safeSourceHref(importContext.source) : null;

  return (
    <form aria-busy={pending} noValidate onSubmit={submit} ref={formRef}>
      <Stack gap="lg">
        {children}

        {importContext && (
          <Alert
            color="sage"
            data-testid="import-review"
            title="Review this copy"
          >
            <Stack gap="xs">
              <Text fz="sm">
                The text below was copied from {host ?? 'a website'}. Check it
                and correct anything before saving; the original link is kept
                with the recipe.
              </Text>
              {href && host && <SourceLink host={host} href={href} />}
              {importContext.notices.length > 0 && (
                <List fz="sm" spacing={4}>
                  {importContext.notices.map((item) => (
                    <List.Item key={item.field}>
                      {truncationMessage(item)}
                    </List.Item>
                  ))}
                </List>
              )}
            </Stack>
          </Alert>
        )}

        {problems.length > 0 && (
          <Alert
            color="clay"
            data-testid="form-errors"
            title="Check the highlighted fields"
          >
            <List fz="sm" spacing={4}>
              {problems.map((message) => (
                <List.Item key={message}>{message}</List.Item>
              ))}
            </List>
          </Alert>
        )}

        <TextInput
          description={`Up to ${count(RECIPE_TITLE_MAX_LENGTH)} characters.`}
          error={errors.title}
          label="Title"
          onChange={(event) => setTitle(event.currentTarget.value)}
          value={title}
        />

        <TextInput
          description={`Optional, ${RECIPE_SERVINGS_MIN} to ${RECIPE_SERVINGS_MAX}. Nutrition is shown per serving.`}
          error={errors.servings}
          inputMode="numeric"
          label="Servings"
          onChange={(event) => setServings(event.currentTarget.value)}
          styles={{ input: { maxWidth: '8rem' } }}
          value={servings}
        />

        {linkable && (
          <TextInput
            description="Optional. The web page this recipe comes from."
            error={errors.link}
            inputMode="url"
            label="Recipe link"
            onChange={(event) => setLink(event.currentTarget.value)}
            type="url"
            value={link}
          />
        )}

        <LineList
          description={`One per line, in the order you use them. Each up to ${count(RECIPE_INGREDIENT_MAX_LENGTH)} characters.`}
          error={errors.ingredients}
          itemLabel="Ingredient"
          legend="Ingredients"
          lineErrors={errors.ingredientLines}
          lines={ingredients}
          max={RECIPE_INGREDIENTS_MAX}
          onChange={setIngredients}
        />

        <LineList
          description={`In the order you do them. Each up to ${count(RECIPE_STEP_MAX_LENGTH)} characters.`}
          error={errors.steps}
          itemLabel="Step"
          legend="Steps"
          lineErrors={errors.stepLines}
          lines={steps}
          max={RECIPE_STEPS_MAX}
          multiline
          onChange={setSteps}
        />

        <Textarea
          description={`Optional. Up to ${count(RECIPE_NOTES_MAX_LENGTH)} characters.`}
          error={errors.notes}
          label="Notes"
          onChange={(event) => setNotes(event.currentTarget.value)}
          rows={4}
          value={notes}
        />

        <RecipeNotice notice={notice} />

        <Stack gap="xs">
          <Group gap="sm">
            <Button disabled={pending || Boolean(blockedReason)} type="submit">
              {submitLabel}
            </Button>
            <Button disabled={pending} onClick={onCancel} variant="default">
              Cancel
            </Button>
          </Group>
          {blockedReason && (
            <Text c="dimmed" fz="sm">
              {blockedReason}
            </Text>
          )}
        </Stack>
      </Stack>
    </form>
  );
}
