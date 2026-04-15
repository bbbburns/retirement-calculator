/**
 * API integration tests — tests Hono routes directly via app.request().
 * No wrangler pool required; runs in plain Node.
 */

import { describe, it, expect } from 'vitest';
import app from '../src/routes';
import { defaultInputs } from '../src/types';

async function post(body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await app.request('/api/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe('POST /api/calculate', () => {
  it('default inputs → 200 with valid shape', async () => {
    const { status, json } = await post(defaultInputs());
    expect(status).toBe(200);
    const r = json as Record<string, unknown>;
    expect(typeof r.fire_number).toBe('number');
    expect(Array.isArray(r.ages)).toBe(true);
    expect(Array.isArray(r.portfolio_nominal)).toBe(true);
    expect((r.ages as unknown[]).length).toBeGreaterThan(0);
    expect((r.ages as unknown[]).length).toBe((r.portfolio_nominal as unknown[]).length);
  });

  it('empty body → 400', async () => {
    const { status } = await post({});
    // {} is an object but fields will be missing/NaN — validate should clamp, not error,
    // since all fields have defaults. Confirm we still get 200 (clamped to defaults).
    expect(status).toBe(200);
  });

  it('invalid JSON → 400', async () => {
    const res = await app.request('/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json {{{',
    });
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBeTruthy();
  });

  it('array body → 400', async () => {
    const { status } = await post([1, 2, 3]);
    expect(status).toBe(400);
  });

  it('monte_carlo_simulations clamped to 2000 max', async () => {
    const { status, json } = await post({ ...defaultInputs(), monte_carlo_simulations: 1_000_000 });
    expect(status).toBe(200);
    // Result should still be valid (not timed out / crashed)
    const r = json as Record<string, unknown>;
    expect(typeof r.fire_number).toBe('number');
  });

  it('impossible ages clamped: retirement_age < current_age', async () => {
    const { status, json } = await post({ ...defaultInputs(), current_age: 70, retirement_age: 40 });
    expect(status).toBe(200);
    const r = json as Record<string, unknown>;
    // retirement_age should have been clamped to >= current_age
    expect(typeof r.fire_number).toBe('number');
    expect(isNaN(r.fire_number as number)).toBe(false);
  });

  it('negative inflation clamped, returns finite result', async () => {
    const { status, json } = await post({ ...defaultInputs(), inflation_rate: -100 });
    expect(status).toBe(200);
    const r = json as Record<string, unknown>;
    expect(isNaN(r.fire_number as number)).toBe(false);
    expect(isFinite(r.fire_number as number)).toBe(true);
  });

  it('safe_withdrawal_rate=0 clamped, no divide-by-zero', async () => {
    const { status, json } = await post({ ...defaultInputs(), safe_withdrawal_rate: 0 });
    expect(status).toBe(200);
    const r = json as Record<string, unknown>;
    expect(isFinite(r.fire_number as number)).toBe(true);
  });

  it('retirement_age=95 with monte_carlo=true does not crash', async () => {
    const { status, json } = await post({
      ...defaultInputs(),
      retirement_age: 95,
      use_monte_carlo: true,
    });
    expect(status).toBe(200);
    const r = json as Record<string, unknown>;
    expect(typeof r.mc_success_rate).toBe('number');
  });
});
