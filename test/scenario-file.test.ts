import { describe, it, expect } from 'vitest';
import indexHtml from '../public/index.html?raw';
import { NUMBER_LIMITS } from '../public/input-limits.js';
import {
  FILE_FORMAT,
  FILE_VERSION,
  MAX_SCENARIOS,
  ScenarioFileError,
  buildExportFile,
  formatIssue,
  exportFileName,
  mergeScenarios,
  parseScenarioFile,
  sanitizeName,
} from '../public/scenario-file.js';

// Mirrors the shape of defaultInputs() in public/app.js: the parser only uses
// the keys and the type of each value.
function defaults(name = 'Base Case') {
  return {
    name,
    current_age: 45,
    retirement_age: 65,
    pretax_accounts: 100_000,
    annual_income: 80_000,
    pretax_contribution_dollars: 0,
    investment_return_rate: 0.07,
    one_time_expenses: [] as unknown[],
    retirement_income_streams: [] as unknown[],
    filing_status: 'mfj',
    withdrawal_strategy: 'conventional',
    model_rmds: true,
    use_monte_carlo: false,
  };
}

type Scenario = { name: string; inputs: Record<string, unknown> };

function fileText(scenarios: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, scenarios, ...extra });
}

function expectFileError(text: string, message: RegExp) {
  expect(() => parseScenarioFile(text, defaults())).toThrow(ScenarioFileError);
  expect(() => parseScenarioFile(text, defaults())).toThrow(message);
}

describe('export', () => {
  it('builds a versioned file with every scenario', () => {
    const scenarios: Scenario[] = [
      { name: 'A', inputs: defaults('A') },
      { name: 'B', inputs: defaults('B') },
    ];
    const file = buildExportFile(scenarios, new Date('2026-11-06T18:00:00Z'));
    expect(file.format).toBe(FILE_FORMAT);
    expect(file.version).toBe(FILE_VERSION);
    expect(file.exported_at).toBe('2026-11-06T18:00:00.000Z');
    expect(file.scenarios.map((s: Scenario) => s.name)).toEqual(['A', 'B']);
  });

  it('names the file after the local date', () => {
    expect(exportFileName(new Date(2026, 0, 5))).toBe('retirement-scenarios-2026-01-05.json');
  });

  it('round-trips through parse unchanged', () => {
    const inputs = {
      ...defaults('Early'),
      retirement_age: 55,
      filing_status: 'single',
      model_rmds: false,
      one_time_expenses: [{ age: 60, amount: 30_000, label: 'Roof' }],
      retirement_income_streams: [{ amount: 12_000, start_age: 55, end_age: 65, label: 'Consulting' }],
    };
    const scenarios: Scenario[] = [{ name: 'Early', inputs }];
    const text = JSON.stringify(buildExportFile(scenarios));
    const { scenarios: parsed, skipped } = parseScenarioFile(text, defaults());
    expect(skipped).toBe(0);
    expect(parsed).toEqual(scenarios);
  });
});

describe('parseScenarioFile rejects bad files', () => {
  it('rejects empty text', () => expectFileError('', /empty/));
  it('rejects non-JSON', () => expectFileError('{nope', /not valid JSON/));
  it('rejects JSON that is not a scenario file', () => {
    expectFileError('[]', /not a retirement calculator scenario file/);
    expectFileError(JSON.stringify({ format: 'other', version: 1, scenarios: [] }), /not a retirement/);
  });
  it('rejects a missing or invalid version', () => {
    expectFileError(JSON.stringify({ format: FILE_FORMAT, scenarios: [] }), /invalid version/);
    expectFileError(fileText([], { version: 0 }), /invalid version/);
    expectFileError(fileText([], { version: '1' }), /invalid version/);
  });
  it('rejects a newer version', () => {
    expectFileError(fileText([{ name: 'A', inputs: defaults() }], { version: FILE_VERSION + 1 }), /newer version/);
  });
  it('rejects a file with no scenarios', () => {
    expectFileError(fileText([]), /no scenarios/);
    expectFileError(fileText([], { scenarios: 'x' }), /no scenarios/);
  });
  it('rejects too many scenarios', () => {
    const many = Array.from({ length: MAX_SCENARIOS + 1 }, (_, i) => ({ name: `S${i}`, inputs: defaults() }));
    expectFileError(fileText(many), /too many scenarios/);
  });
  it('rejects oversized text', () => {
    expectFileError(' '.repeat(1_000_001), /too large/);
  });
  it('rejects a file where no scenario is usable', () => {
    expectFileError(fileText([null, 'x', { name: 'A' }, { name: 'B', inputs: { bogus: 1 } }]), /None of the scenarios/);
  });
});

describe('parseScenarioFile cleans scenarios', () => {
  it('skips unusable scenarios and keeps the rest', () => {
    const { scenarios, skipped } = parseScenarioFile(
      fileText([{ name: 'Good', inputs: { current_age: 50 } }, { name: 'Bad', inputs: [] }, 42]),
      defaults(),
    );
    expect(scenarios.map((s: Scenario) => s.name)).toEqual(['Good']);
    expect(skipped).toBe(2);
  });

  it('fills missing fields from defaults and drops unknown or mistyped ones', () => {
    const { scenarios } = parseScenarioFile(
      fileText([{
        name: 'Mixed',
        inputs: {
          current_age: 50,
          retirement_age: '60',          // wrong type → default
          pretax_accounts: null,         // wrong type → default
          filing_status: 'married',      // not an allowed value → default
          withdrawal_strategy: 'roth_first',
          model_rmds: 'yes',             // wrong type → default
          use_monte_carlo: true,
          evil: '<script>',              // unknown → dropped
        },
      }]),
      defaults(),
    );
    const inputs = scenarios[0].inputs;
    expect(inputs).toEqual({
      ...defaults('Mixed'),
      current_age: 50,
      withdrawal_strategy: 'roth_first',
      use_monte_carlo: true,
    });
    expect(inputs).not.toHaveProperty('evil');
  });

  it('cleans list items', () => {
    const { scenarios } = parseScenarioFile(
      fileText([{
        name: 'Lists',
        inputs: {
          one_time_expenses: [
            { age: 70, amount: 5000, label: 'Car', extra: true },
            { age: 'x', amount: 1, label: 'bad' },
            null,
            { age: 72, amount: 100 },
          ],
          retirement_income_streams: 'not a list',
        },
      }]),
      defaults(),
    );
    expect(scenarios[0].inputs.one_time_expenses).toEqual([
      { age: 70, amount: 5000, label: 'Car' },
      { age: 72, amount: 100, label: '' },
    ]);
    expect(scenarios[0].inputs.retirement_income_streams).toEqual([]);
  });

  it('takes the name from inputs.name when the top-level name is missing', () => {
    const { scenarios } = parseScenarioFile(fileText([{ inputs: { name: 'Inner', current_age: 50 } }]), defaults());
    expect(scenarios[0].name).toBe('Inner');
    expect(scenarios[0].inputs.name).toBe('Inner');
  });
});

describe('sanitizeName', () => {
  it('replaces unsafe characters', () => expect(sanitizeName('a/b:c*d')).toBe('a_b_c_d'));
  it('strips leading dots and whitespace', () => expect(sanitizeName(' ..hidden ')).toBe('hidden'));
  it('truncates to 100 characters', () => expect(sanitizeName('x'.repeat(150))).toHaveLength(100));
  it('falls back for empty or non-string names', () => {
    expect(sanitizeName('')).toBe('Imported Scenario');
    expect(sanitizeName('...')).toBe('Imported Scenario');
    expect(sanitizeName(42)).toBe('Imported Scenario');
  });
});

describe('mergeScenarios', () => {
  const existing: Scenario[] = [
    { name: 'Base Case', inputs: defaults('Base Case') },
    { name: 'Base Case 2', inputs: defaults('Base Case 2') },
  ];

  it('appends without changing existing scenarios', () => {
    const merged = mergeScenarios(existing, [{ name: 'New', inputs: defaults('New') }]);
    expect(merged.slice(0, 2)).toEqual(existing);
    expect(merged.map((s: Scenario) => s.name)).toEqual(['Base Case', 'Base Case 2', 'New']);
    expect(existing).toHaveLength(2);
  });

  it('renames clashes case-insensitively, also among the imports', () => {
    const merged = mergeScenarios(existing, [
      { name: 'base case', inputs: defaults('base case') },
      { name: 'Other', inputs: defaults('Other') },
      { name: 'OTHER', inputs: defaults('OTHER') },
    ]);
    expect(merged.slice(2).map((s: Scenario) => s.name)).toEqual(['base case 3', 'Other', 'OTHER 2']);
    expect(merged[2].inputs.name).toBe('base case 3');
  });

  it('keeps renamed clashes within the name length limit', () => {
    const long = 'y'.repeat(100);
    const merged = mergeScenarios([{ name: long, inputs: defaults(long) }], [{ name: long, inputs: defaults(long) }]);
    expect(merged[1].name.length).toBeLessThanOrEqual(100);
    expect(merged[1].name).not.toBe(long);
  });
});

// ---------------------------------------------------------------------------
// Issue reporting
// ---------------------------------------------------------------------------

// What app.js passes for the fixture fields above (slider ranges from index.html).
const UI_RANGES = {
  current_age: { min: 20, max: 80, step: 1 },
  retirement_age: { min: 40, max: 80, step: 1 },
  investment_return_rate: { min: 0, max: 0.15, step: 0.005 },
  pretax_accounts: { step: 1 },
  annual_income: { step: 1 },
  pretax_contribution_dollars: { step: 1 },
};

function messages(scenarios: unknown[], extra: Record<string, unknown> = {}) {
  return parseScenarioFile(fileText(scenarios, extra), defaults(), { ranges: UI_RANGES }).issues.map(formatIssue);
}

function one(inputs: Record<string, unknown>) {
  return messages([{ name: 'S', inputs: { ...defaults('S'), ...inputs } }]);
}

describe('parseScenarioFile reports issues', () => {
  it('reports nothing for a clean export', () => {
    const scenarios = [
      { name: 'A', inputs: { ...defaults('A'), investment_return_rate: 0.065, one_time_expenses: [{ age: 70, amount: 5000, label: 'Car' }] } },
      { name: 'B', inputs: defaults('B') },
    ];
    expect(parseScenarioFile(JSON.stringify(buildExportFile(scenarios)), defaults(), { ranges: UI_RANGES }).issues).toEqual([]);
  });

  it('reports unknown fields, suggesting close matches', () => {
    expect(one({ retirment_age: 60, zzz: 1 })).toEqual([
      'S: unknown field "retirment_age" ignored (did you mean "retirement_age"?)',
      'S: unknown field "zzz" ignored',
    ]);
  });

  it('reports unknown fields at file and scenario level', () => {
    expect(messages([{ name: 'S', inputs: defaults('S'), note: 'x' }], { comment: 'hi' })).toEqual([
      'File: unknown field "comment" ignored',
      'S: unknown field "note" ignored (did you mean "name"?)',
    ]);
  });

  it('reports wrong types and the default used', () => {
    expect(one({ current_age: 'fifty', model_rmds: 'yes', filing_status: 'married' })).toEqual([
      'S: current_age "fifty" is not a number; default 45 used',
      'S: filing_status "married" is not one of mfj, single, hoh; default "mfj" used',
      'S: model_rmds "yes" is not true or false; default true used',
    ]);
  });

  it('clamps to the slider range where there is one, else to the API limits', () => {
    expect(one({ current_age: 85, pretax_accounts: -5 })).toEqual([
      'S: current_age 85 is above the maximum 80; set to 80',
      'S: pretax_accounts -5 is below the minimum 0; set to 0',
      'S: retirement_age 65 is below current_age 80; set to 80',
    ]);
    const { scenarios, issues } = parseScenarioFile(
      fileText([{ name: 'S', inputs: { current_age: 85 } }]), defaults());
    expect(scenarios[0].inputs.current_age).toBe(85);
    expect(issues.map(formatIssue)).not.toContain(expect.stringContaining('current_age 85'));
  });

  it('reports rounding to the slider step and to whole dollars', () => {
    const issues = one({ investment_return_rate: 0.0725, current_age: 45.4, annual_income: 80_000.6 });
    expect(issues).toEqual([
      'S: current_age 45.4 rounded to 45',
      'S: annual_income 80000.6 rounded to 80001',
      'S: investment_return_rate 0.0725 rounded to 0.075 (steps of 0.005)',
    ]);
  });

  it('applies the cleaned values', () => {
    const { scenarios } = parseScenarioFile(
      fileText([{ name: 'S', inputs: { current_age: 85, investment_return_rate: 0.0725 } }]),
      defaults(), { ranges: UI_RANGES });
    expect(scenarios[0].inputs.current_age).toBe(80);
    expect(scenarios[0].inputs.investment_return_rate).toBe(0.075);
  });

  it('raises retirement_age to current_age', () => {
    expect(one({ current_age: 60, retirement_age: 50 })).toEqual([
      'S: retirement_age 50 is below current_age 60; set to 60',
    ]);
  });

  it('reports missing fields on one line', () => {
    expect(messages([{ name: 'S', inputs: { current_age: 50, retirement_age: 60 } }])).toEqual([
      'S: 10 fields missing; defaults used (pretax_accounts, annual_income, pretax_contribution_dollars, '
        + 'investment_return_rate, one_time_expenses, retirement_income_streams, filing_status, '
        + 'withdrawal_strategy, model_rmds, use_monte_carlo)',
    ]);
  });

  it('reports list item problems', () => {
    expect(one({
      one_time_expenses: [
        { age: 70, amount: 5000, label: 'Car', extra: true },
        { age: 'x', amount: 1, label: 'bad' },
        7,
        { age: 130, amount: 100 },
      ],
      retirement_income_streams: {},
    })).toEqual([
      'S: one_time_expenses item 1: unknown field "extra" ignored',
      'S: one_time_expenses item 2 dropped (age "x" is not a number)',
      'S: one_time_expenses item 3 dropped (not an object: 7)',
      'S: one_time_expenses item 4: age 130 is above the maximum 120; set to 120',
      'S: one_time_expenses item 4: label missing; left blank',
      'S: retirement_income_streams {} is not a list; default used (empty)',
    ]);
  });

  it('reports lists over the item limit', () => {
    const items = Array.from({ length: 55 }, (_, i) => ({ age: 70, amount: i + 1, label: `E${i}` }));
    const { scenarios, issues } = parseScenarioFile(
      fileText([{ name: 'S', inputs: { ...defaults('S'), one_time_expenses: items } }]), defaults(), { ranges: UI_RANGES });
    expect(scenarios[0].inputs.one_time_expenses).toHaveLength(50);
    expect(issues.map(formatIssue)).toEqual(['S: one_time_expenses has 55 items; only the first 50 kept']);
  });

  it('reports name changes and skipped scenarios', () => {
    expect(messages([
      { name: 'a/b', inputs: defaults() },
      { inputs: defaults() },
      { name: 'Empty', inputs: { bogus: 1 } },
      'nope',
    ])).toEqual([
      'a_b: name "a/b" changed to "a_b"',
      'Empty: skipped (no usable fields)',
      'Scenario 4: skipped (not an object: "nope")',
    ]);
  });
});

describe('UI limits', () => {
  it('keeps every slider inside the API limits', () => {
    const sliders = [...indexHtml.matchAll(/<input type="range" id="(\w+)" min="([^"]+)" max="([^"]+)" step="([^"]+)"/g)];
    expect(sliders.length).toBeGreaterThan(5);
    for (const [, id, min, max, step] of sliders) {
      const lim = (NUMBER_LIMITS as Record<string, { min: number; max: number; integer: boolean }>)[id];
      expect(lim, `${id} has no API limit`).toBeDefined();
      expect(Number(min), `${id} min`).toBeGreaterThanOrEqual(lim.min);
      expect(Number(max), `${id} max`).toBeLessThanOrEqual(lim.max);
      if (lim.integer) expect(Number.isInteger(Number(step)), `${id} step`).toBe(true);
    }
  });
});
