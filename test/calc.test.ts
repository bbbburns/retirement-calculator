/**
 * Unit tests for calculation modules.
 * Ported from test_calculations.py — key categories only.
 */

import { describe, it, expect } from 'vitest';
import { marginalTax, effectiveRate } from '../src/calc/tax';
import { requiredMinimumDistribution, RMD_START_AGE } from '../src/calc/rmd';
import { simulateAccumulation } from '../src/calc/accumulation';
import { simulateDrawdown } from '../src/calc/drawdown';
import { computeFireNumber, runScenario } from '../src/calc/fire';
import { defaultInputs } from '../src/types';

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

describe('Tax', () => {
  it('zero income → zero tax', () => {
    expect(marginalTax(0, 'mfj')).toBe(0);
  });

  it('below standard deduction → zero tax (MFJ)', () => {
    expect(marginalTax(29_999, 'mfj')).toBe(0);
  });

  it('below standard deduction → zero tax (single)', () => {
    expect(marginalTax(14_999, 'single')).toBe(0);
  });

  it('MFJ first bracket: $1 above std deduction', () => {
    const tax = marginalTax(30_001, 'mfj');
    expect(tax).toBeCloseTo(0.10, 5);
  });

  it('effective rate is monotonically non-decreasing', () => {
    const incomes = [0, 50_000, 100_000, 200_000, 500_000];
    const rates = incomes.map(i => effectiveRate(i, 'mfj'));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1]);
    }
  });

  it('single filer pays more than MFJ at same income', () => {
    const income = 200_000;
    expect(marginalTax(income, 'single')).toBeGreaterThan(marginalTax(income, 'mfj'));
  });
});

// ---------------------------------------------------------------------------
// RMD
// ---------------------------------------------------------------------------

describe('RMD', () => {
  it('zero before age 73', () => {
    expect(requiredMinimumDistribution(500_000, 72)).toBe(0);
    expect(requiredMinimumDistribution(500_000, RMD_START_AGE - 1)).toBe(0);
  });

  it('known value at age 73 (factor 26.5)', () => {
    const balance = 265_000;
    expect(requiredMinimumDistribution(balance, 73)).toBeCloseTo(10_000, 2);
  });

  it('increases with age (lower factor = higher RMD)', () => {
    const balance = 500_000;
    const rmd73 = requiredMinimumDistribution(balance, 73);
    const rmd80 = requiredMinimumDistribution(balance, 80);
    const rmd90 = requiredMinimumDistribution(balance, 90);
    expect(rmd80).toBeGreaterThan(rmd73);
    expect(rmd90).toBeGreaterThan(rmd80);
  });

  it('uses floor factor (8.9) for ages beyond table', () => {
    const balance = 89_000;
    expect(requiredMinimumDistribution(balance, 96)).toBeCloseTo(10_000, 2);
    expect(requiredMinimumDistribution(balance, 100)).toBeCloseTo(10_000, 2);
  });
});

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

describe('Accumulation', () => {
  it('all-pretax: pretax grows, roth and taxable stay near initial', () => {
    const inputs = {
      ...defaultInputs(),
      pretax_contribution_rate: 1.0,
      roth_contribution_rate: 0.0,
      roth_accounts: 0,
      taxable_accounts: 0,
      other_assets: 0,
    };
    const { pretax, roth, taxable } = simulateAccumulation(inputs);
    const last = pretax.length - 1;
    expect(pretax[last]).toBeGreaterThan(pretax[0]);
    expect(roth[last]).toBe(0);
    expect(taxable[last]).toBe(0);
  });

  it('all-roth: roth grows, pretax and taxable stay near initial', () => {
    const inputs = {
      ...defaultInputs(),
      pretax_contribution_rate: 0.0,
      roth_contribution_rate: 1.0,
      pretax_accounts: 0,
      taxable_accounts: 0,
      other_assets: 0,
    };
    const { pretax, roth, taxable } = simulateAccumulation(inputs);
    const last = pretax.length - 1;
    expect(roth[last]).toBeGreaterThan(roth[0]);
    expect(pretax[last]).toBe(0);
    expect(taxable[last]).toBe(0);
  });

  it('rates exceeding 1.0 clamp taxable contributions to 0', () => {
    const inputs = {
      ...defaultInputs(),
      pretax_contribution_rate: 0.8,
      roth_contribution_rate: 0.5, // sum > 1.0
      taxable_accounts: 0,
      other_assets: 0,
    };
    const { taxable } = simulateAccumulation(inputs);
    // taxable should never grow beyond initial (no contributions)
    expect(taxable[taxable.length - 1]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FIRE number
// ---------------------------------------------------------------------------

describe('FIRE number', () => {
  it('basic formula: spending/SWR (no tax, no SS, no income)', () => {
    const inputs = {
      ...defaultInputs(),
      desired_spending_today_dollars: 80_000,
      healthcare_annual_bump: 0,
      safe_withdrawal_rate: 0.04,
      ss_monthly_benefit: 0,
      retirement_income_streams: [],
      pretax_accounts: 0,
      roth_accounts: 0,
      taxable_accounts: 0,
      other_assets: 0,
    };
    const fire = computeFireNumber(inputs, 0); // 0 pretax fraction → no tax
    expect(fire).toBeCloseTo(80_000 / 0.04, -3);
  });

  it('SS reduces FIRE number', () => {
    const base = computeFireNumber({ ...defaultInputs(), ss_monthly_benefit: 0, healthcare_annual_bump: 0 }, 0);
    const withSS = computeFireNumber({ ...defaultInputs(), ss_monthly_benefit: 2000, healthcare_annual_bump: 0 }, 0);
    expect(withSS).toBeLessThan(base);
  });

  it('higher SWR → lower FIRE number', () => {
    const inputs = defaultInputs();
    const fire4 = computeFireNumber({ ...inputs, safe_withdrawal_rate: 0.04 }, 0);
    const fire5 = computeFireNumber({ ...inputs, safe_withdrawal_rate: 0.05 }, 0);
    expect(fire5).toBeLessThan(fire4);
  });

  it('pretax fraction increases FIRE number (tax cost)', () => {
    const inputs = defaultInputs();
    const noTax = computeFireNumber(inputs, 0);
    const withTax = computeFireNumber(inputs, 0.9);
    expect(withTax).toBeGreaterThan(noTax);
  });
});

// ---------------------------------------------------------------------------
// Drawdown
// ---------------------------------------------------------------------------

describe('Drawdown', () => {
  it('zero return + no income → linear depletion', () => {
    const inputs = {
      ...defaultInputs(),
      investment_return_rate: 0,
      inflation_rate: 0,
      ss_monthly_benefit: 0,
      healthcare_annual_bump: 0,
      desired_spending_today_dollars: 50_000,
      retirement_income_streams: [],
      one_time_expenses: [],
      model_rmds: false,
    };
    const startBalance = 500_000;
    const { portfolioTotal } = simulateDrawdown(inputs, startBalance, 0, 0, 65);
    // Should deplete after ~10 years
    const depleted = portfolioTotal.findIndex(v => v <= 0);
    expect(depleted).toBeGreaterThan(0);
    expect(depleted).toBeLessThanOrEqual(11); // 500k / 50k = 10 years
  });
});

// ---------------------------------------------------------------------------
// End-to-end
// ---------------------------------------------------------------------------

describe('End-to-end', () => {
  it('runScenario with default inputs returns valid result', () => {
    const result = runScenario(defaultInputs());
    expect(result.fire_number).toBeGreaterThan(0);
    expect(result.ages.length).toBeGreaterThan(0);
    expect(result.portfolio_nominal.length).toBe(result.ages.length);
    expect(result.portfolio_real.length).toBe(result.ages.length);
    expect(result.portfolio_at_retirement).toBeGreaterThan(0);
  });

  it('portfolio is continuous at retirement boundary', () => {
    const inputs = defaultInputs();
    const result = runScenario(inputs);
    const retIdx = result.ages.indexOf(inputs.retirement_age);
    expect(retIdx).toBeGreaterThan(-1);
    const pre = result.portfolio_nominal[retIdx - 1];
    const at = result.portfolio_nominal[retIdx];
    const post = result.portfolio_nominal[retIdx + 1];
    // Should not jump wildly at the boundary
    expect(Math.abs(at - pre) / pre).toBeLessThan(0.2);
    expect(at).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(0);
  });

  it('FIRE age is <= retirement age (or null if never reached before target)', () => {
    const result = runScenario(defaultInputs());
    if (result.retirement_age_actual !== null) {
      expect(result.retirement_age_actual).toBeLessThanOrEqual(defaultInputs().retirement_age);
    }
  });

  it('single filer has higher FIRE number than MFJ at same income', () => {
    const base = defaultInputs();
    const mfj = runScenario({ ...base, filing_status: 'mfj' });
    const single = runScenario({ ...base, filing_status: 'single' });
    expect(single.fire_number).toBeGreaterThan(mfj.fire_number);
  });
});
