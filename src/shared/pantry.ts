export type PantryStatus = 'available' | 'low' | 'needed';

export const PANTRY_STATUSES: readonly PantryStatus[] = [
  'available',
  'low',
  'needed',
];

/** Statuses that form the shopping view, most urgent first. */
export const SHOPPING_STATUSES: readonly PantryStatus[] = ['needed', 'low'];

/** Bounds list and storage cost for one household. */
export const PANTRY_ITEM_LIMIT = 500;

export const PANTRY_NAME_MAX_LENGTH = 80;

export interface PantryItem {
  id: string;
  name: string;
  status: PantryStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PantryItemsResponse {
  items: PantryItem[];
}

export interface PantryItemResponse {
  item: PantryItem;
}

export interface CreatePantryItemRequest {
  name: string;
  status: PantryStatus;
}

export interface UpdatePantryItemRequest {
  version: number;
  name?: string;
  status?: PantryStatus;
}

export interface DeletePantryItemRequest {
  version: number;
}

export const isPantryStatus = (value: unknown): value is PantryStatus =>
  typeof value === 'string' &&
  (PANTRY_STATUSES as readonly string[]).includes(value);

/**
 * Human-readable name with Unicode form, whitespace, and padding settled.
 * Case is preserved so the family sees what they typed.
 */
export const cleanPantryDisplayName = (value: string): string =>
  value.normalize('NFKC').replace(/\s+/gu, ' ').trim();

/**
 * Duplicate-detection key. Case folding plus the display cleanup means
 * "Olive Oil", "olive  oil", and "OLIVE OIL" are the same pantry item. It
 * deliberately does not strip punctuation or accents, which carry meaning in
 * food names.
 */
export const normalizePantryName = (value: string): string =>
  cleanPantryDisplayName(value).toLowerCase();

export const isValidPantryName = (normalized: string): boolean =>
  normalized.length >= 1 && normalized.length <= PANTRY_NAME_MAX_LENGTH;

const STATUS_RANK: Record<PantryStatus, number> = {
  needed: 0,
  low: 1,
  available: 2,
};

/** Needed before Low before Available; alphabetical within a group. */
export const comparePantryItems = (a: PantryItem, b: PantryItem): number =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
  normalizePantryName(a.name).localeCompare(normalizePantryName(b.name)) ||
  a.id.localeCompare(b.id);

export const isShoppingItem = (item: PantryItem): boolean =>
  (SHOPPING_STATUSES as readonly string[]).includes(item.status);

export const shoppingItems = (items: readonly PantryItem[]): PantryItem[] =>
  items.filter(isShoppingItem).slice().sort(comparePantryItems);
