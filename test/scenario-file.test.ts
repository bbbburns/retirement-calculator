import { describe, it, expect } from 'vitest';
import {
  FILE_FORMAT,
  FILE_VERSION,
  MAX_SCENARIOS,
  ScenarioFileError,
  buildExportFile,
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
