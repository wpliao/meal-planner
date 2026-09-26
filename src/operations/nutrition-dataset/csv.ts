/**
 * Reads RFC 4180 CSV text, as USDA FoodData Central publishes it, as records
 * keyed by the header row. Fields may be quoted; a quoted field may contain
 * commas, line breaks, and doubled quotes. Records are yielded one at a time,
 * so a large file never becomes one large array.
 */
export function* csvRecords(text: string): Generator<Record<string, string>> {
  let header: string[] | undefined;
  for (const row of csvRows(text)) {
    if (!header) {
      header = row;
      continue;
    }
    if (row.length === 1 && row[0] === '') continue;
    if (row.length !== header.length) {
      throw new Error(
        `CSV row has ${row.length} fields; the header has ${header.length}.`,
      );
    }
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[name] = row[index];
    });
    yield record;
  }
}

/** Every record, for small files. */
export const parseCsv = (text: string): Record<string, string>[] => [
  ...csvRecords(text),
];

/** A quoted field from its opening quote: its text and where it ends. */
const readQuoted = (text: string, start: number): [string, number] => {
  let field = '';
  let index = start + 1;
  for (;;) {
    const close = text.indexOf('"', index);
    if (close === -1) throw new Error('CSV ends inside a quoted field.');
    field += text.slice(index, close);
    if (text[close + 1] !== '"') return [field, close + 1];
    // A doubled quote is one quote inside the field.
    field += '"';
    index = close + 2;
  }
};

/** An unquoted field: everything up to a comma or line break. */
const readPlain = (text: string, start: number): [string, number] => {
  let end = start;
  while (end < text.length && !',\r\n'.includes(text[end])) end += 1;
  return [text.slice(start, end), end];
};

function* csvRows(text: string): Generator<string[]> {
  let index = text.startsWith('\uFEFF') ? 1 : 0;
  let row: string[] = [];
  while (index < text.length) {
    const [field, end] =
      text[index] === '"' ? readQuoted(text, index) : readPlain(text, index);
    row.push(field);
    const separator = text[end];
    if (separator === ',') {
      index = end + 1;
      continue;
    }
    if (separator !== undefined && separator !== '\r' && separator !== '\n') {
      throw new Error('CSV has text after a closing quote.');
    }
    yield row;
    row = [];
    index = end + (text.startsWith('\r\n', end) ? 2 : 1);
  }
  // Text that ends with a comma ends with one more, empty, field.
  if (row.length > 0) yield [...row, ''];
}
