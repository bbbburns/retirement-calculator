// Scenario file export/import — pure functions, no DOM access.
// Loaded on demand by app.js via dynamic import(), and imported directly by
// test/scenario-file.test.ts.
//
// Import is lenient but never silent: anything it ignores, replaces, clamps or
// rounds is reported as an issue so the user can decide whether to go ahead.

import { NUMBER_LIMITS, ENUM_VALUES, LIST_LIMITS, NAME_MAX_LENGTH } from './input-limits.js';

export const FILE_FORMAT = 'retirement-calculator-scenarios';
export const FILE_VERSION = 1;
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_SCENARIOS = 100;
export const MAX_NAME_LENGTH = NAME_MAX_LENGTH;

const FILE_KEYS = new Set(['format', 'version', 'exported_at', 'scenarios']);
const SCENARIO_KEYS = new Set(['name', 'inputs']);
const UNSAFE_NAME_CHARS = /[/\\:*?"<>|]/g;
const FALLBACK_NAME = 'Imported Scenario';

// Fields of items in list-valued inputs: field → limits (number) or 'label'.
const LIST_ITEM_FIELDS = {
  one_time_expenses: { age: LIST_LIMITS.age, amount: LIST_LIMITS.amount, label: 'label' },
  retirement_income_streams: {
    amount: LIST_LIMITS.amount, start_age: LIST_LIMITS.age, end_age: LIST_LIMITS.age, label: 'label',
  },
};

export class ScenarioFileError extends Error {
  name = 'ScenarioFileError';
}

/** Build the export file object from the in-memory scenario list. */
export function buildExportFile(scenarios, now = new Date()) {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    exported_at: now.toISOString(),
    scenarios: scenarios.map(s => ({ name: s.name, inputs: s.inputs })),
  };
}

/** File name for an export made on the given date, using local time. */
export function exportFileName(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `retirement-scenarios-${date}.json`;
}

/** Make an arbitrary string safe to use as a scenario name. */
export function sanitizeName(raw) {
  const name = (typeof raw === 'string' ? raw : '')
    .replace(UNSAFE_NAME_CHARS, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return name || FALLBACK_NAME;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Short JSON rendering of a value for messages. */
function show(v) {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 40 ? s.slice(0, 37) + '...' : s;
}

/** Strip floating-point noise (0.07500000000000001 → 0.075). */
function tidy(n) {
  return Number(n.toPrecision(12));
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function unknownFieldMessage(key, known) {
  let best = null;
  let bestDist = 3;
  for (const k of known) {
    const d = editDistance(key.toLowerCase(), k.toLowerCase());
    if (d < bestDist) { best = k; bestDist = d; }
  }
  const hint = best && key.length > 3 ? ` (did you mean "${best}"?)` : '';
  return `unknown field "${key}" ignored${hint}`;
}

/**
 * Bring a number into range and onto its step, describing any change.
 * `limits` is { min, max, integer?, step? }. Returns { value, note }.
 */
function fitNumber(v, limits) {
  const { min, max } = limits;
  if (v < min) return { value: min, note: `is below the minimum ${min}; set to ${min}` };
  if (v > max) return { value: max, note: `is above the maximum ${max}; set to ${max}` };
  const step = limits.step ?? (limits.integer ? 1 : null);
  if (step) {
    let snapped = tidy(min + Math.round(tidy((v - min) / step)) * step);
    if (snapped > max) snapped = tidy(snapped - step);
    if (Math.abs(snapped - v) > 1e-9) {
      return { value: snapped, note: step === 1 ? `rounded to ${snapped}` : `rounded to ${snapped} (steps of ${step})` };
    }
  }
  return { value: v, note: null };
}

// ---------------------------------------------------------------------------
// Field cleaning
// ---------------------------------------------------------------------------

/**
 * Clean one input field. Returns { ok, value, notes }: when ok is false the
 * default is used; notes are problem descriptions without the scenario label.
 */
function cleanField(key, value, def, ranges) {
  const notes = [];

  if (key in LIST_ITEM_FIELDS) {
    if (!Array.isArray(value)) {
      return { ok: false, notes: [`${key} ${show(value)} is not a list; default used (empty)`] };
    }
    if (value.length > LIST_LIMITS.max_items) {
      notes.push(`${key} has ${value.length} items; only the first ${LIST_LIMITS.max_items} kept`);
    }
    const items = [];
    value.slice(0, LIST_LIMITS.max_items).forEach((item, i) => {
      const res = cleanListItem(item, LIST_ITEM_FIELDS[key], `${key} item ${i + 1}`);
      notes.push(...res.notes);
      if (res.item) items.push(res.item);
    });
    return { ok: true, value: items, notes };
  }

  if (key in ENUM_VALUES) {
    if (ENUM_VALUES[key].includes(value)) return { ok: true, value, notes };
    return {
      ok: false,
      notes: [`${key} ${show(value)} is not one of ${ENUM_VALUES[key].join(', ')}; default ${show(def)} used`],
    };
  }

  switch (typeof def) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, notes: [`${key} ${show(value)} is not a number; default ${show(def)} used`] };
      }
      if (!NUMBER_LIMITS[key] && !ranges[key]) return { ok: true, value, notes };
      const limits = { ...NUMBER_LIMITS[key], ...ranges[key] };
      const fit = fitNumber(value, limits);
      if (fit.note) notes.push(`${key} ${show(value)} ${fit.note}`);
      return { ok: true, value: fit.value, notes };
    }
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value, notes };
      return { ok: false, notes: [`${key} ${show(value)} is not true or false; default ${show(def)} used`] };
    default:
      return { ok: false, notes: [`${key} ${show(value)} could not be read; default ${show(def)} used`] };
  }
}

function cleanListItem(item, fields, where) {
  if (!isPlainObject(item)) {
    return { item: null, notes: [`${where} dropped (not an object: ${show(item)})`] };
  }
  const notes = [];
  for (const key of Object.keys(item)) {
    if (!(key in fields)) notes.push(`${where}: ${unknownFieldMessage(key, Object.keys(fields))}`);
  }
  const out = {};
  for (const [key, limits] of Object.entries(fields)) {
    const v = item[key];
    if (limits === 'label') {
      if (v === undefined) {
        notes.push(`${where}: label missing; left blank`);
        out[key] = '';
      } else if (typeof v !== 'string') {
        notes.push(`${where}: label ${show(v)} is not text; left blank`);
        out[key] = '';
      } else if (v.length > LIST_LIMITS.label_max_length) {
        notes.push(`${where}: label shortened to ${LIST_LIMITS.label_max_length} characters`);
        out[key] = v.slice(0, LIST_LIMITS.label_max_length);
      } else {
        out[key] = v;
      }
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      const why = v === undefined ? `${key} is missing` : `${key} ${show(v)} is not a number`;
      return { item: null, notes: [...notes, `${where} dropped (${why})`] };
    }
    const fit = fitNumber(v, limits);
    if (fit.note) notes.push(`${where}: ${key} ${show(v)} ${fit.note}`);
    out[key] = fit.value;
  }
  return { item: out, notes };
}

/**
 * Clean one imported scenario. Returns { scenario, issues }, where scenario is
 * null if the scenario cannot be used at all.
 */
function cleanScenario(raw, index, defaults, ranges) {
  const issues = [];
  const fallbackLabel = `Scenario ${index + 1}`;

  if (!isPlainObject(raw)) {
    return { scenario: null, issues: [{ scenario: fallbackLabel, message: `skipped (not an object: ${show(raw)})` }] };
  }

  const rawName = raw.name ?? raw.inputs?.name;
  const name = sanitizeName(rawName);
  const label = typeof rawName === 'string' && rawName.trim() ? name : fallbackLabel;
  const add = message => issues.push({ scenario: label, message });

  if (!isPlainObject(raw.inputs)) {
    add(raw.inputs === undefined ? 'skipped (no inputs)' : `skipped (inputs is not an object: ${show(raw.inputs)})`);
    return { scenario: null, issues };
  }

  if (rawName === undefined) add(`no name; called "${name}"`);
  else if (typeof rawName !== 'string') add(`name ${show(rawName)} is not text; called "${name}"`);
  else if (rawName !== name) add(`name ${show(rawName)} changed to "${name}"`);

  for (const key of Object.keys(raw)) {
    if (!SCENARIO_KEYS.has(key)) add(unknownFieldMessage(key, SCENARIO_KEYS));
  }

  const known = Object.keys(defaults);
  for (const key of Object.keys(raw.inputs)) {
    if (!(key in defaults)) add(unknownFieldMessage(key, known));
  }

  const inputs = { ...defaults };
  const missing = [];
  let usable = 0;
  for (const key of known) {
    if (key === 'name') continue;
    if (!(key in raw.inputs)) {
      missing.push(key);
      continue;
    }
    const res = cleanField(key, raw.inputs[key], defaults[key], ranges);
    res.notes.forEach(add);
    if (res.ok) {
      inputs[key] = res.value;
      usable++;
    }
  }

  if (usable === 0) {
    return { scenario: null, issues: [{ scenario: label, message: 'skipped (no usable fields)' }] };
  }

  if (missing.length) {
    const n = missing.length;
    add(`${n} field${n === 1 ? '' : 's'} missing; default${n === 1 ? '' : 's'} used (${missing.join(', ')})`);
  }

  if (typeof inputs.current_age === 'number' && typeof inputs.retirement_age === 'number'
      && inputs.retirement_age < inputs.current_age) {
    add(`retirement_age ${inputs.retirement_age} is below current_age ${inputs.current_age}; set to ${inputs.current_age}`);
    inputs.retirement_age = inputs.current_age;
  }

  inputs.name = name;
  return { scenario: { name, inputs }, issues };
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse and validate the text of a scenario file.
 *
 * `defaults` is a defaultInputs() object: its keys define the known fields and
 * its value types define the expected type of each field.
 * `options.ranges` maps a field to a partial { min, max, step } that overrides
 * NUMBER_LIMITS with what the UI enforces: a slider's narrower range and step,
 * or step 1 for fields shown as whole dollars.
 *
 * Returns { scenarios, skipped, issues } where issues is a list of
 * { scenario, message } (scenario is null for file-level issues).
 * Throws ScenarioFileError if nothing can be imported.
 */
export function parseScenarioFile(text, defaults, options = {}) {
  const ranges = options.ranges ?? {};
  if (typeof text !== 'string' || text.length === 0) {
    throw new ScenarioFileError('The file is empty.');
  }
  if (text.length > MAX_FILE_BYTES) {
    throw new ScenarioFileError('The file is too large (max 1 MB).');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ScenarioFileError('The file is not valid JSON.');
  }
  if (!isPlainObject(data) || data.format !== FILE_FORMAT) {
    throw new ScenarioFileError('This is not a retirement calculator scenario file.');
  }
  if (!Number.isInteger(data.version) || data.version < 1) {
    throw new ScenarioFileError('The file has an invalid version number.');
  }
  if (data.version > FILE_VERSION) {
    throw new ScenarioFileError(
      'This file was made by a newer version of the calculator. Reload the page and try again.');
  }
  if (!Array.isArray(data.scenarios) || data.scenarios.length === 0) {
    throw new ScenarioFileError('The file contains no scenarios.');
  }
  if (data.scenarios.length > MAX_SCENARIOS) {
    throw new ScenarioFileError(`The file has too many scenarios (max ${MAX_SCENARIOS}).`);
  }

  const issues = [];
  for (const key of Object.keys(data)) {
    if (!FILE_KEYS.has(key)) issues.push({ scenario: null, message: unknownFieldMessage(key, FILE_KEYS) });
  }

  const scenarios = [];
  let skipped = 0;
  data.scenarios.forEach((raw, i) => {
    const res = cleanScenario(raw, i, defaults, ranges);
    issues.push(...res.issues);
    if (res.scenario) scenarios.push(res.scenario);
    else skipped++;
  });
  if (scenarios.length === 0) {
    const detail = issues.map(formatIssue).slice(0, 3).join('; ');
    throw new ScenarioFileError(`None of the scenarios in the file could be read (${detail}).`);
  }
  return { scenarios, skipped, issues };
}

/** One-line rendering of an issue for display. */
export function formatIssue(issue) {
  return issue.scenario ? `${issue.scenario}: ${issue.message}` : `File: ${issue.message}`;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Return `base`, or `base N` for the smallest N ≥ 2 not in `taken` (lowercased names). */
function uniqueName(base, taken) {
  let name = base;
  let n = 1;
  while (taken.has(name.toLowerCase())) name = `${base} ${++n}`;
  return name;
}

/**
 * Append imported scenarios to the existing list without overwriting anything.
 * Name clashes (case-insensitive) get a numeric suffix, like New and Copy.
 * Returns a new array; neither input is modified.
 */
export function mergeScenarios(existing, imported) {
  const taken = new Set(existing.map(s => s.name.toLowerCase()));
  const merged = [...existing];
  for (const s of imported) {
    const base = s.name.slice(0, MAX_NAME_LENGTH - 4);
    const name = taken.has(s.name.toLowerCase()) ? uniqueName(base, taken) : s.name;
    taken.add(name.toLowerCase());
    merged.push({ name, inputs: { ...s.inputs, name } });
  }
  return merged;
}
