import { describe, expect, it } from 'vitest';

import {
  buildDataset,
  type ReleaseInput,
} from '../../src/operations/nutrition-dataset/build.ts';
import { parseCsv } from '../../src/operations/nutrition-dataset/csv.ts';
import {
  parseDataset,
  serializeDataset,
  type NutritionDataset,
} from '../../src/operations/nutrition-dataset/dataset.ts';
import {
  loadNutritionDataset,
  type D1Runner,
} from '../../src/operations/nutrition-dataset/load.ts';
import {
  dataStatements,
  finishStatements,
  INDEX_CHECK_STATEMENT,
  LOADED_VERSION_QUERY,
  VERIFY_QUERY,
} from '../../src/operations/nutrition-dataset/statements.ts';
import { wranglerRows } from '../../src/operations/nutrition-dataset/wrangler-output.ts';

describe('CSV', () => {
  it('reads quoted fields with commas, quotes, and line breaks', () => {
    const text =
      '﻿id,description\r\n1,"Cheese, cheddar"\r\n2,"Say ""cheese"""\n3,"two\nlines"\n';
    expect(parseCsv(text)).toEqual([
      { id: '1', description: 'Cheese, cheddar' },
      { id: '2', description: 'Say "cheese"' },
      { id: '3', description: 'two\nlines' },
    ]);
  });

  it('reads a last row without a line break, and empty fields', () => {
    expect(parseCsv('a,b\n1,\n,2')).toEqual([
      { a: '1', b: '' },
      { a: '', b: '2' },
    ]);
  });

  it('reads a trailing comma as a last, empty field', () => {
    expect(parseCsv('a,b\n1,')).toEqual([{ a: '1', b: '' }]);
  });

  it('refuses a row whose field count differs from the header', () => {
    expect(() => parseCsv('a,b\n1,2,3\n')).toThrow(/3 fields/u);
  });

  it('refuses text that ends inside a quote', () => {
    expect(() => parseCsv('a\n"open\n')).toThrow(/quoted/u);
  });

  it('refuses text after a closing quote', () => {
    expect(() => parseCsv('a,b\n"x"y,1\n')).toThrow(/after a closing quote/u);
  });
});

const csv = (header: string, ...rows: string[]): string =>
  [header, ...rows].join('\n') + '\n';

const NUTRIENTS = csv(
  'id,name,unit_name,nutrient_nbr,rank',
  '1062,Energy,kJ,268,1',
  '1008,Energy,KCAL,208,2',
  '2048,Energy (Atwater Specific Factors),KCAL,958,3',
  '2047,Energy (Atwater General Factors),KCAL,957,4',
  '1003,Protein,G,203,5',
  '1004,Total lipid (fat),G,204,6',
  '1258,"Fatty acids, total saturated",G,606,7',
  '1005,"Carbohydrate, by difference",G,205,8',
  '2000,"Sugars, Total",G,269,9',
  '1063,"Sugars, Total NLEA",G,269.3,10',
  '1079,"Fiber, total dietary",G,291,11',
  '1093,"Sodium, Na",MG,307,12',
);

const CATEGORIES = csv(
  'id,code,description',
  '1,0100,Dairy and Egg Products',
  '3,0300,Baby Foods',
);

const UNITS = csv(
  'id,name',
  '1000,cup',
  '1001,tablespoon',
  '9999,undetermined',
);

const release = (
  files: Record<string, string>,
  kind: 'sr' | 'foundation' = 'sr',
): ReleaseInput => ({
  source: {
    name: kind === 'sr' ? 'SR Legacy' : 'Foundation Foods',
    release: kind === 'sr' ? '2018-04' : '2026-04-30',
    url: `https://example.test/${kind}.zip`,
    sha256: 'a'.repeat(64),
  },
  usdaDataType: kind === 'sr' ? 'sr_legacy_food' : 'foundation_food',
  dataType: kind === 'sr' ? 'sr_legacy' : 'foundation',
  read: (file) => {
    const all: Record<string, string> = {
      'nutrient.csv': NUTRIENTS,
      'food_category.csv': CATEGORIES,
      'measure_unit.csv': UNITS,
      ...files,
    };
    const text = all[file];
    if (text === undefined) throw new Error(`No ${file}`);
    return text;
  },
});

const SR = release({
  'food.csv': csv(
    'fdc_id,data_type,description,food_category_id,publication_date',
    '20,sr_legacy_food,"Cream, fluid, heavy whipping",1,2019-04-01',
    '10,sr_legacy_food,"Milk, whole",1,2019-04-01',
    '30,sr_legacy_food,Kcal only,1,2019-04-01',
    '40,sr_legacy_food,No energy,1,2019-04-01',
    '50,sr_legacy_food,"Babyfood, apples",3,2019-04-01',
    '60,branded_food,Branded,1,2019-04-01',
  ),
  'food_nutrient.csv': csv(
    'id,fdc_id,nutrient_id,amount',
    '1,10,1062,255',
    '2,10,1003,3.15',
    '3,10,2000,5.05',
    '4,10,1063,9',
    '5,20,1062,1424',
    '6,20,1004,36.08',
    '7,20,1093,',
    '8,30,1008,100',
    '9,30,1063,4.5',
    '10,50,1062,200',
    '11,60,1062,300',
  ),
  'food_portion.csv': csv(
    'id,fdc_id,seq_num,amount,measure_unit_id,portion_description,modifier,gram_weight',
    '1,20,1,1,9999,,"cup, whipped",120',
    '2,20,2,1,9999,,"cup, fluid",238',
    '3,20,3,1,9999,,tbsp,15',
    '4,10,2,1,9999,,fl oz,30.5',
    '5,10,1,1,9999,,"cup, chopped",244',
    '6,10,3,0,9999,,broken,5',
    '7,30,1,1,9999,,large,50',
  ),
});

const FOUNDATION = release(
  {
    'food.csv': csv(
      'fdc_id,data_type,description,food_category_id,publication_date',
      '15,foundation_food,"Eggs, Grade A",1,2026-04-30',
      '16,sub_sample_food,Egg sample,1,2026-04-30',
    ),
    'food_nutrient.csv': csv(
      'id,fdc_id,nutrient_id,amount',
      '1,15,2047,143',
      '2,15,2048,140',
      '3,15,1003,12.4',
    ),
    'food_portion.csv': csv(
      'id,fdc_id,seq_num,amount,measure_unit_id,portion_description,modifier,gram_weight',
      '9,15,,2,1001,,,33.9',
      '8,15,,1,1000,,drained,227',
    ),
  },
  'foundation',
);

describe('dataset build', () => {
  const dataset = buildDataset([SR, FOUNDATION]);

  it('keeps each release’s foods of its data type, in FDC ID order', () => {
    expect(dataset.foods.map((food) => food[0])).toEqual([10, 15, 20, 30]);
    expect(dataset.version).toBe('usda-fdc_2018-04_2026-04-30_r1');
    expect(dataset.sources.map((source) => source.name)).toEqual([
      'SR Legacy',
      'Foundation Foods',
    ]);
  });

  it('leaves out excluded categories and foods with no energy', () => {
    const ids = dataset.foods.map((food) => food[0]);
    expect(ids).not.toContain(40);
    expect(ids).not.toContain(50);
    expect(ids).not.toContain(60);
    expect(ids).not.toContain(16);
  });

  it('keeps USDA values and marks a missing nutrient null', () => {
    expect(dataset.foods[0]).toEqual([
      10,
      'Milk, whole',
      'sr_legacy',
      'Dairy and Egg Products',
      '2018-04',
      255,
      3.15,
      null,
      null,
      null,
      // Sugars prefer nutrient 269 over 269.3.
      5.05,
      null,
      null,
      // "fl oz" is a plain volume, preferred over "cup, chopped".
      2,
    ]);
    // An empty amount is no value, not zero.
    expect(dataset.foods[2][12]).toBeNull();
  });

  it('derives kJ from kcal, then from the Atwater factors', () => {
    const kcalOnly = dataset.foods.find((food) => food[0] === 30);
    expect(kcalOnly?.[5]).toBe(418.4);
    expect(kcalOnly?.[10]).toBe(4.5);
    const atwater = dataset.foods.find((food) => food[0] === 15);
    // Specific factors (140 kcal) before general ones (143 kcal).
    expect(atwater?.[5]).toBe(585.8);
  });

  it('numbers portions in USDA order and labels them', () => {
    expect(dataset.portions).toEqual([
      [10, 1, 1, 'cup, chopped', 244],
      [10, 2, 1, 'fl oz', 30.5],
      [15, 1, 1, 'cup, drained', 227],
      [15, 2, 2, 'tablespoon', 33.9],
      [20, 1, 1, 'cup, whipped', 120],
      [20, 2, 1, 'cup, fluid', 238],
      [20, 3, 1, 'tbsp', 15],
      [30, 1, 1, 'large', 50],
    ]);
  });

  it('gives each food the portion that best states its density', () => {
    const volume = Object.fromEntries(
      dataset.foods.map((food) => [food[0], food[13]]),
    );
    // Cream: the plain "tbsp", not "cup, whipped".
    expect(volume[20]).toBe(3);
    // Foundation egg: "tablespoon" is plain; "cup, drained" is not.
    expect(volume[15]).toBe(2);
    expect(volume[30]).toBeNull();
  });

  it('fails when a nutrient number changed its unit or name', () => {
    const changed = release({
      'nutrient.csv': NUTRIENTS.replace(
        '1093,"Sodium, Na",MG',
        '1093,"Sodium, Na",G',
      ),
      'food.csv': csv('fdc_id,data_type,description,food_category_id'),
      'food_nutrient.csv': csv('id,fdc_id,nutrient_id,amount'),
      'food_portion.csv': csv('id,fdc_id,seq_num,amount'),
    });
    expect(() => buildDataset([changed])).toThrow(/307/u);
    const missing = release({
      'nutrient.csv': NUTRIENTS.replace(/^1079.*\n/mu, ''),
      'food.csv': csv('fdc_id,data_type,description,food_category_id'),
    });
    expect(() => buildDataset([missing])).toThrow(/291 is missing/u);
  });

  it('writes one row per line and reads back the same dataset', () => {
    const text = serializeDataset(dataset);
    expect(
      text.split('\n').filter((line) => line.startsWith('    [')),
    ).toHaveLength(dataset.foods.length + dataset.portions.length);
    expect(parseDataset(text)).toEqual(dataset);
  });
});

describe('dataset file', () => {
  const valid = (): NutritionDataset => ({
    version: 'v1',
    sources: [],
    foods: [
      [1, 'Food', 'sr_legacy', 'Cat', '2018-04', 1, 2, 3, 4, 5, 6, 7, 8, null],
    ],
    portions: [[1, 1, 1, 'cup', 240]],
  });

  it.each<[string, (dataset: NutritionDataset) => unknown]>([
    ['no version', (dataset) => ({ ...dataset, version: '' })],
    ['no foods', (dataset) => ({ ...dataset, foods: undefined })],
    [
      'a food with a text value',
      (dataset) => ({
        ...dataset,
        foods: [
          [...dataset.foods[0].slice(0, 5), '1', ...dataset.foods[0].slice(6)],
        ],
      }),
    ],
    [
      'a branded food',
      (dataset) => ({
        ...dataset,
        foods: [[1, 'F', 'branded', ...dataset.foods[0].slice(3)]],
      }),
    ],
    [
      'a zero gram weight',
      (dataset) => ({ ...dataset, portions: [[1, 1, 1, 'cup', 0]] }),
    ],
    [
      'an empty label',
      (dataset) => ({ ...dataset, portions: [[1, 1, 1, '', 240]] }),
    ],
  ])('refuses %s', (_name, change) => {
    expect(() => parseDataset(JSON.stringify(change(valid())))).toThrow();
  });

  it('reads the committed dataset', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(
      new URL('../../data/nutrition/usda-fdc.json', import.meta.url),
      'utf8',
    );
    const dataset = parseDataset(text);
    expect(dataset.version).toBe('usda-fdc_2018-04_2026-04-30_r1');
    expect(dataset.foods.length).toBeGreaterThan(7000);
  });
});

describe('load statements', () => {
  const dataset: NutritionDataset = {
    version: "v'1",
    sources: [],
    foods: Array.from({ length: 401 }, (_, index) => [
      index + 1,
      index === 0 ? "Chef's salad" : `Food ${index + 1}`,
      'sr_legacy',
      'Cat',
      '2018-04',
      100,
      null,
      1.5,
      null,
      null,
      null,
      null,
      null,
      null,
    ]),
    portions: [[1, 1, 1, 'cup', 240]],
  };

  it('deletes the version first, then the rows, then inserts in chunks', () => {
    const statements = dataStatements(dataset);
    expect(statements.slice(0, 3)).toEqual([
      'DELETE FROM nutrition_dataset;',
      'DELETE FROM nutrition_food_portions;',
      'DELETE FROM nutrition_foods;',
    ]);
    // 401 foods in chunks of 200, then one portion insert.
    expect(statements).toHaveLength(3 + 3 + 1);
    expect(statements[3]).toContain(
      "(1, 'Chef''s salad', 'sr_legacy', 'Cat', '2018-04', 100, NULL, 1.5,",
    );
    expect(statements[5].match(/\),?\n?\(/gu)).toBeNull();
    for (const statement of statements) {
      expect(new TextEncoder().encode(statement).length).toBeLessThan(100_000);
    }
  });

  it('rebuilds the index, then writes the version last', () => {
    expect(
      finishStatements(dataset, 'b'.repeat(64), '2026-09-26T00:00:00.000Z'),
    ).toEqual([
      "INSERT INTO nutrition_foods_fts (nutrition_foods_fts) VALUES ('rebuild');",
      `INSERT INTO nutrition_dataset (id, version, sha256, food_count, portion_count, loaded_at) VALUES (1, 'v''1', '${'b'.repeat(64)}', 401, 1, '2026-09-26T00:00:00.000Z');`,
    ]);
  });

  it('refuses a number that is not finite', () => {
    const bad: NutritionDataset = {
      ...dataset,
      foods: [
        [
          1,
          'F',
          'sr_legacy',
          'C',
          'R',
          Infinity,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      ],
    };
    expect(() => dataStatements(bad)).toThrow(/finite/u);
  });
});

describe('loading', () => {
  const dataset: NutritionDataset = {
    version: 'v1',
    sources: [],
    foods: [
      [1, 'Food', 'sr_legacy', 'Cat', '2018-04', 1, 2, 3, 4, 5, 6, 7, 8, null],
    ],
    portions: [[1, 1, 1, 'cup', 240]],
  };
  const text = serializeDataset(dataset);
  const SHA = 'c'.repeat(64);

  const fakeRunner = (
    answers: Partial<Record<string, Record<string, unknown>[]>>,
  ) => {
    const calls: string[] = [];
    const runner: D1Runner = {
      command: (sql) => {
        calls.push(sql);
        return Promise.resolve(answers[sql] ?? []);
      },
      file: (path) => {
        calls.push(`file:${path}`);
        return Promise.resolve();
      },
    };
    return { runner, calls };
  };

  const run = (runner: D1Runner, written: string[] = []) =>
    loadNutritionDataset({
      datasetText: text,
      sha256: SHA,
      runner,
      writeSqlFile: (sql) => {
        written.push(sql);
        return Promise.resolve('/tmp/load.sql');
      },
      now: () => new Date('2026-09-26T00:00:00.000Z'),
      log: () => undefined,
    });

  it('does nothing when the database holds this exact file', async () => {
    const { runner, calls } = fakeRunner({
      [LOADED_VERSION_QUERY]: [{ version: 'v1', sha256: SHA }],
    });
    await expect(run(runner)).resolves.toBe('up_to_date');
    expect(calls).toEqual([LOADED_VERSION_QUERY]);
  });

  it('loads, rebuilds the index, records the version, and verifies', async () => {
    const { runner, calls } = fakeRunner({
      [LOADED_VERSION_QUERY]: [{ version: 'v0', sha256: 'd'.repeat(64) }],
      [VERIFY_QUERY]: [{ foods: 1, portions: 1, version: 'v1', sha256: SHA }],
    });
    const written: string[] = [];
    await expect(run(runner, written)).resolves.toBe('loaded');
    expect(written).toEqual([dataStatements(dataset).join('\n')]);
    expect(calls).toEqual([
      LOADED_VERSION_QUERY,
      'file:/tmp/load.sql',
      ...finishStatements(dataset, SHA, '2026-09-26T00:00:00.000Z'),
      INDEX_CHECK_STATEMENT,
      VERIFY_QUERY,
    ]);
  });

  it.each([
    ['too few foods', { foods: 0, portions: 1, version: 'v1', sha256: SHA }],
    ['another version', { foods: 1, portions: 1, version: 'v0', sha256: SHA }],
    [
      'another file',
      { foods: 1, portions: 1, version: 'v1', sha256: 'e'.repeat(64) },
    ],
  ])('fails when verification finds %s', async (_name, counts) => {
    const { runner } = fakeRunner({ [VERIFY_QUERY]: [counts] });
    await expect(run(runner)).rejects.toThrow(/did not verify/u);
  });

  it('stops at the first failing step', async () => {
    const calls: string[] = [];
    const runner: D1Runner = {
      command: (sql) => {
        calls.push(sql);
        return sql === INDEX_CHECK_STATEMENT
          ? Promise.reject(new Error('fts5: corrupt index'))
          : Promise.resolve([]);
      },
      file: () => Promise.resolve(),
    };
    await expect(run(runner)).rejects.toThrow(/corrupt/u);
    expect(calls).not.toContain(VERIFY_QUERY);
  });
});

describe('wrangler output', () => {
  const rows = [{ version: 'v1', sha256: 'abc' }];
  const json = JSON.stringify(
    [{ results: rows, success: true, meta: {} }],
    null,
    2,
  );

  it('reads the rows of the last result', () => {
    expect(wranglerRows(json)).toEqual(rows);
    expect(
      wranglerRows(JSON.stringify([{ results: [] }, { results: rows }])),
    ).toEqual(rows);
  });

  it('skips the progress lines a remote run prints before the JSON', () => {
    expect(
      wranglerRows(
        `├ Checking if file needs uploading\n│\n├ 🌀 Uploading\n${json}\n`,
      ),
    ).toEqual(rows);
  });

  it('reads an empty result, and fails when there is no JSON at all', () => {
    expect(wranglerRows('[{"results":[],"success":true}]')).toEqual([]);
    expect(() => wranglerRows('├ Executing on remote database DB\n')).toThrow(
      /no JSON result/u,
    );
  });
});
