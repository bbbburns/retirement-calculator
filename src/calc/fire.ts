/**
 * FIRE number calculation, retirement age finder, and scenario orchestrator.
 */

import { ScenarioInputs, ScenarioResult } from '../types';
import { simulateAccumulation } from './accumulation';
import { simulateDrawdown } from './drawdown';
import { runMonteCarlo } from './monte_carlo';
import { marginalTax } from './tax';

const SS_FACTORS: Record<number, number> = {
  62: 0.70, 63: 0.75, 64: 0.80, 65: 0.867,
  66: 0.933, 67: 1.00, 68: 1.08, 69: 1.16, 70: 1.24,
};

function annualSsIncome(monthlyBenefit: number, claimingAge: number): number {
  const factor = SS_FACTORS[claimingAge] ?? 1.0;
  return monthlyBenefit * 12 * factor;
}

export function computeFireNumber(inputs: ScenarioInputs, pretaxFraction: number = 0): number {
  const ssAnnual = annualSsIncome(inputs.ss_monthly_benefit, inputs.ss_claiming_age);
  const yearsToClaiming = Math.max(inputs.ss_claiming_age - inputs.current_age, 0);
  const ssReal = ssAnnual / Math.pow(1 + inputs.inflation_rate, yearsToClaiming);

  const retIncomeReal = inputs.retirement_income_streams
    .filter(s => s.start_age <= inputs.retirement_age && inputs.retirement_age <= s.end_age)
    .reduce((sum, s) => {
      const yearsToStart = Math.max(s.start_age - inputs.current_age, 0);
      return sum + s.amount / Math.pow(1 + inputs.inflation_rate, yearsToStart);
    }, 0);

  const netSpending = Math.max(
    inputs.desired_spending_today_dollars + inputs.healthcare_annual_bump - ssReal - retIncomeReal,
    inputs.desired_spending_today_dollars * 0.1,
  );

  const swr = inputs.safe_withdrawal_rate;
  const fs = inputs.filing_status;
  const ssTaxable = ssReal * 0.85;

  let lo = netSpending / swr;
  let hi = netSpending / (swr * 0.63);

  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    const grossAnnual = mid * swr;
    const pretaxGross = grossAnnual * pretaxFraction;
    const taxes = marginalTax(pretaxGross + ssTaxable, fs) - marginalTax(ssTaxable, fs);
    const net = grossAnnual - taxes;
    if (net < netSpending) {
      lo = mid;
    } else {
      hi = mid;
    }
    if ((hi - lo) / Math.max(lo, 1) < 1e-7) break;
  }

  return (lo + hi) / 2;
}

export function findEarliestFireAge(
  inputs: ScenarioInputs,
  accumAges: number[],
  accumPortfolio: number[],
  pretaxFraction: number,
): number | null {
  for (let i = 0; i < accumAges.length; i++) {
    const age = accumAges[i];
    const nominalValue = accumPortfolio[i];
    const candidateInputs = { ...inputs, retirement_age: Math.round(age) };
    const candidateFireNumber = computeFireNumber(candidateInputs, pretaxFraction);
    const years = age - inputs.current_age;
    const realValue = nominalValue / Math.pow(1 + inputs.inflation_rate, years);
    if (realValue >= candidateFireNumber) return Math.round(age);
  }
  return null;
}

export function runScenario(inputs: ScenarioInputs): ScenarioResult {
  // 1. Accumulation
  const { ages: accumAges, pretax: accumPretax, roth: accumRoth, taxable: accumTaxable } =
    simulateAccumulation(inputs);
  const accumPortfolio = accumAges.map((_, i) => accumPretax[i] + accumRoth[i] + accumTaxable[i]);

  // 2. FIRE number — use pretax fraction from current balances
  const totalCurrent = inputs.pretax_accounts + inputs.roth_accounts
    + inputs.taxable_accounts + inputs.other_assets;
  const pretaxFractionCurrent = totalCurrent > 0
    ? inputs.pretax_accounts / totalCurrent
    : 0.9;
  const fireNumber = computeFireNumber(inputs, pretaxFractionCurrent);

  // Pretax fraction at target retirement (for max sustainable spending)
  const totalAtRetirement = accumPortfolio[accumPortfolio.length - 1];
  const pretaxFraction = totalAtRetirement > 0
    ? accumPretax[accumPretax.length - 1] / totalAtRetirement
    : 0.9;

  // income_covers_expenses: SS + retirement income >= desired spending + healthcare
  const ssAnnualVal = annualSsIncome(inputs.ss_monthly_benefit, inputs.ss_claiming_age);
  const yearsToClaiming = Math.max(inputs.ss_claiming_age - inputs.current_age, 0);
  const ssReal = ssAnnualVal / Math.pow(1 + inputs.inflation_rate, yearsToClaiming);
  const retIncomeReal = inputs.retirement_income_streams
    .filter(s => s.start_age <= inputs.retirement_age && inputs.retirement_age <= s.end_age)
    .reduce((sum, s) => {
      const yearsToStart = Math.max(s.start_age - inputs.current_age, 0);
      return sum + s.amount / Math.pow(1 + inputs.inflation_rate, yearsToStart);
    }, 0);
  const totalNet = inputs.desired_spending_today_dollars + inputs.healthcare_annual_bump - ssReal - retIncomeReal;
  const incomeCoversExpenses = (
    totalNet <= inputs.desired_spending_today_dollars * 0.1 &&
    inputs.desired_spending_today_dollars > 0
  );

  // 3. Earliest FIRE age — extend search window to at least age 80
  const searchEnd = Math.max(inputs.retirement_age, 80);
  let extAges = accumAges;
  let extPortfolio = accumPortfolio;
  if (searchEnd > inputs.retirement_age) {
    const extInputs = { ...inputs, retirement_age: searchEnd };
    const ext = simulateAccumulation(extInputs);
    extPortfolio = ext.ages.map((_, i) => ext.pretax[i] + ext.roth[i] + ext.taxable[i]);
    extAges = ext.ages;
  }
  const fireReachedAge = findEarliestFireAge(inputs, extAges, extPortfolio, pretaxFractionCurrent);

  // 4. Portfolio at target retirement
  const pretaxAtRetirement = accumPretax[accumPretax.length - 1];
  const rothAtRetirement = accumRoth[accumRoth.length - 1];
  const taxableAtRetirement = accumTaxable[accumTaxable.length - 1];
  const portfolioAtRetirement = totalAtRetirement;

  // 5. Drawdown from target retirement to MAX_AGE
  const retirementAge = inputs.retirement_age;
  const draw = simulateDrawdown(
    inputs, pretaxAtRetirement, rothAtRetirement, taxableAtRetirement, retirementAge,
  );

  // 6. Max sustainable spending
  const yearsToRetire = retirementAge - inputs.current_age;
  const grossWithdrawal = portfolioAtRetirement * inputs.safe_withdrawal_rate;
  const pretaxGrossAnnual = grossWithdrawal * pretaxFraction;
  const ssTaxable = ssReal * 0.85;
  const taxesOnWithdrawal =
    marginalTax(pretaxGrossAnnual + ssTaxable, inputs.filing_status) -
    marginalTax(ssTaxable, inputs.filing_status);
  const netPortfolioWithdrawalNominal = grossWithdrawal - taxesOnWithdrawal;
  const netPortfolioWithdrawalReal = netPortfolioWithdrawalNominal /
    Math.pow(1 + inputs.inflation_rate, yearsToRetire);
  const retIncomeAtRetire = inputs.retirement_income_streams
    .filter(s => s.start_age <= retirementAge && retirementAge <= s.end_age)
    .reduce((sum, s) => {
      const yearsToStart = Math.max(s.start_age - inputs.current_age, 0);
      return sum + s.amount / Math.pow(1 + inputs.inflation_rate, yearsToStart);
    }, 0);
  const maxSustainableSpending = netPortfolioWithdrawalReal + ssReal + retIncomeAtRetire;

  // 7. Combine time series.
  // Accumulation ends at retirementAge; drawdown starts at retirementAge.
  // Drop the last accumulation point (the shared boundary) and use drawdown's
  // version of retirementAge so that spending/income appear at that age.
  const allAges = [...accumAges.slice(0, -1), ...draw.ages];
  const allPortfolioNominal = [...accumPortfolio.slice(0, -1), ...draw.portfolioTotal];

  const deflator = allAges.map(age =>
    Math.pow(1 + inputs.inflation_rate, age - inputs.current_age)
  );
  const allPortfolioReal = allPortfolioNominal.map((v, i) => v / deflator[i]);

  const accumZeros = new Array<number>(accumAges.length - 1).fill(0);
  const allSpending = [...accumZeros, ...draw.spending];
  const allSs = [...accumZeros, ...draw.ssIncome];
  const allIncome = [...accumZeros, ...draw.retirementIncome];
  const allTaxes = [...accumZeros, ...draw.taxesPaid];
  const allRmds = [...accumZeros, ...draw.rmdAmounts];

  const allPretax = [...accumPretax.slice(0, -1), ...draw.pretax];
  const allRoth = [...accumRoth.slice(0, -1), ...draw.roth];
  const allTaxable = [...accumTaxable.slice(0, -1), ...draw.taxable];

  // 8. Monte Carlo (optional)
  let mcSuccessRate: number | null = null;
  let mcP10: number[] | null = null;
  let mcP50: number[] | null = null;
  let mcP90: number[] | null = null;

  if (inputs.use_monte_carlo) {
    const mc = runMonteCarlo(
      inputs, pretaxAtRetirement, rothAtRetirement, taxableAtRetirement, retirementAge,
    );
    mcSuccessRate = mc.successRate;
    const nAccum = accumAges.length - 1;
    const nanPad = new Array<number>(nAccum).fill(NaN);
    mcP10 = [...nanPad, ...mc.p10];
    mcP50 = [...nanPad, ...mc.p50];
    mcP90 = [...nanPad, ...mc.p90];
  }

  return {
    fire_number: fireNumber,
    income_covers_expenses: incomeCoversExpenses,
    retirement_age_actual: fireReachedAge,
    portfolio_at_retirement: portfolioAtRetirement,
    max_sustainable_spending: maxSustainableSpending,
    portfolio_depletion_age: draw.depletionAge,
    ages: allAges,
    portfolio_nominal: allPortfolioNominal,
    portfolio_real: allPortfolioReal,
    annual_spending_nominal: allSpending,
    annual_ss_income_nominal: allSs,
    annual_retirement_income_nominal: allIncome,
    pretax_nominal: allPretax,
    roth_nominal: allRoth,
    taxable_brokerage_nominal: allTaxable,
    annual_taxes_paid_nominal: allTaxes,
    annual_rmd_nominal: allRmds,
    mc_success_rate: mcSuccessRate,
    mc_percentile_10: mcP10,
    mc_percentile_50: mcP50,
    mc_percentile_90: mcP90,
  };
}
