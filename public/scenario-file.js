// Scenario file export/import — pure functions, no DOM access.
// Loaded on demand by app.js via dynamic import(), and imported directly by
// test/scenario-file.test.ts.

export const FILE_FORMAT = 'retirement-calculator-scenarios';
export const FILE_VERSION = 1;
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_SCENARIOS = 100;
export const MAX_NAME_LENGTH = 100;
export const MAX_LIST_ITEMS = 100;

const UNSAFE_NAME_CHARS = /[/\\:*?"<>|]/g;
const FALLBACK_NAME = 'Imported Scenario';

const ENUMS = {
  filing_status: new Set(['mfj', 'single', 'hoh']),
  withdrawal_strategy: new Set(['conventional', 'roth_first', 'proportional']),
};

// Allowed fields for items in list-valued inputs: field → 'number' | 'string'.
const LIST_ITEM_FIELDS = {
  one_time_expenses: { age: 'number', amount: 'number', label: 'string' },
  retirement_income_streams: {
    amount: 'number', start_age: 'number', end_age: 'number', label: 'string',
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

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cleanListItem(item, fields) {
  if (!isPlainObject(item)) return null;
  const out = {};
  for (const [key, type] of Object.entries(fields)) {
    const v = item[key];
    if (type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      out[key] = v;
    } else {
      out[key] = typeof v === 'string' ? v.slice(0, MAX_NAME_LENGTH) : '';
    }
  }
  return out;
}

/**
 * Validate one field of an imported scenario against the type of its default.
 * Returns { ok: true, value } or { ok: false }.
 */
function cleanField(key, value, def) {
  if (key in LIST_ITEM_FIELDS) {
    if (!Array.isArray(value)) return { ok: false };
    const items = value.slice(0, MAX_LIST_ITEMS)
      .map(item => cleanListItem(item, LIST_ITEM_FIELDS[key]))
      .filter(item => item !== null);
    return { ok: true, value: items };
  }
  if (key in ENUMS) {
    return ENUMS[key].has(value) ? { ok: true, value } : { ok: false };
  }
  switch (typeof def) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true, value } : { ok: false };
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
    case 'string':
      return typeof value === 'string' ? { ok: true, value } : { ok: false };
    default:
      return { ok: false };
  }
}

/**
 * Clean one imported scenario. Unknown or mistyped fields are dropped and
 * replaced by defaults; returns null if no recognised field was usable.
 */
function cleanScenario(raw, defaults) {
  if (!isPlainObject(raw) || !isPlainObject(raw.inputs)) return null;
  const inputs = { ...defaults };
  let usable = 0;
  for (const key of Object.keys(defaults)) {
    if (key === 'name' || !(key in raw.inputs)) continue;
    const res = cleanField(key, raw.inputs[key], defaults[key]);
    if (res.ok) {
      inputs[key] = res.value;
      usable++;
    }
  }
  if (usable === 0) return null;
  const name = sanitizeName(raw.name ?? raw.inputs.name);
  inputs.name = name;
  return { name, inputs };
}

/**
 * Parse and validate the text of a scenario file.
 * `defaults` is a defaultInputs() object: its keys define the known fields and
 * its value types define the expected type of each field.
 * Returns { scenarios, skipped }. Throws ScenarioFileError on a bad file.
 */
export function parseScenarioFile(text, defaults) {
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
  const scenarios = [];
  let skipped = 0;
  for (const raw of data.scenarios) {
    const s = cleanScenario(raw, defaults);
    if (s) scenarios.push(s);
    else skipped++;
  }
  if (scenarios.length === 0) {
    throw new ScenarioFileError('None of the scenarios in the file could be read.');
  }
  return { scenarios, skipped };
}

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
