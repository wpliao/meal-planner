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

function* csvRows(text: string): Generator<string[]> {
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = text.startsWith('﻿') ? 1 : 0;
  while (index < text.length) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') {
        field += character;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      yield row;
      row = [];
      field = '';
    } else {
      field += character;
    }
    index += 1;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field.');
  if (field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}
