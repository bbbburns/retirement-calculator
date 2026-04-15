/**
 * Pre-retirement wealth accumulation simulation.
 */

import { ScenarioInputs } from '../types';

export interface AccumResult {
  ages: number[];
  pretax: number[];
  roth: number[];
  taxable: number[];
}

export function simulateAccumulation(inputs: ScenarioInputs): AccumResult {
  const years = inputs.retirement_age - inputs.current_age + 1;
  const ages: number[] = [];
  const pretax = new Array<number>(years).fill(0);
  const roth = new Array<number>(years).fill(0);
  const taxable = new Array<number>(years).fill(0);

  for (let i = 0; i < years; i++) {
    ages.push(inputs.current_age + i);
  }

  pretax[0] = inputs.pretax_accounts;
  roth[0] = inputs.roth_accounts;
  taxable[0] = inputs.taxable_accounts + inputs.other_assets;

  let income = inputs.annual_income;
  const r = inputs.investment_return_rate;
  const g = inputs.salary_growth_rate;
  const s = inputs.savings_rate;
  const pretaxRate = inputs.pretax_contribution_rate;
  const rothRate = inputs.roth_contribution_rate;
  const taxableRate = Math.max(1.0 - pretaxRate - rothRate, 0.0);

  for (let i = 1; i < years; i++) {
    const contributions = income * s;
    pretax[i] = pretax[i - 1] * (1 + r) + contributions * pretaxRate;
    roth[i] = roth[i - 1] * (1 + r) + contributions * rothRate;
    taxable[i] = taxable[i - 1] * (1 + r) + contributions * taxableRate;
    income *= (1 + g);
  }

  return { ages, pretax, roth, taxable };
}
