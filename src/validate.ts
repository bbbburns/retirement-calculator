/**
 * Input validation and clamping for ScenarioInputs.
 * Applied at the API boundary before runScenario() to prevent NaN propagation,
 * CPU exhaustion from runaway MC sims, and 500s from impossible age combos.
 */

import { ScenarioInputs, FilingStatus, WithdrawalStrategy } from './types';
import { NUMBER_LIMITS, ENUM_VALUES, LIST_LIMITS, NAME_MAX_LENGTH } from '../public/input-limits.js';

const FILING_STATUSES = new Set<string>(ENUM_VALUES.filing_status);
const WITHDRAWAL_STRATEGIES = new Set<string>(ENUM_VALUES.withdrawal_strategy);
const L = NUMBER_LIMITS;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampDollar(v: unknown): number {
  if (typeof v !== 'number' || isNaN(v)) return 0;
  return clamp(v, LIST_LIMITS.amount.min, LIST_LIMITS.amount.max);
}

function clampRate(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || isNaN(v)) return fallback;
  return clamp(v, lo, hi);
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || isNaN(v)) return fallback;
  return clamp(Math.round(v), lo, hi);
}

export type ValidationResult =
  | { ok: true; inputs: ScenarioInputs }
  | { ok: false; error: string };

export function validateAndClampInputs(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const r = raw as Record<string, unknown>;

  // Ages
  const currentAge = clampInt(r.current_age, L.current_age.min, L.current_age.max, 45);
  const retirementAge = clampInt(r.retirement_age, Math.max(currentAge, L.retirement_age.min), L.retirement_age.max, 65);

  // Rates
  const investmentReturnRate = clampRate(r.investment_return_rate, L.investment_return_rate.min, L.investment_return_rate.max, 0.07);
  const inflationRate = clampRate(r.inflation_rate, L.inflation_rate.min, L.inflation_rate.max, 0.03);
  const salaryGrowthRate = clampRate(r.salary_growth_rate, L.salary_growth_rate.min, L.salary_growth_rate.max, 0.02);
  const savingsRate = clampRate(r.savings_rate, L.savings_rate.min, L.savings_rate.max, 0.20);
  const pretaxContributionRate = clampRate(r.pretax_contribution_rate, L.pretax_contribution_rate.min, L.pretax_contribution_rate.max, 0.70);
  const rothContributionRate = clampRate(r.roth_contribution_rate, L.roth_contribution_rate.min, L.roth_contribution_rate.max, 0.20);
  const safeWithdrawalRate = clampRate(r.safe_withdrawal_rate, L.safe_withdrawal_rate.min, L.safe_withdrawal_rate.max, 0.04);

  // SS
  const ssClaimingAge = clampInt(r.ss_claiming_age, L.ss_claiming_age.min, L.ss_claiming_age.max, 67);

  // Monte Carlo
  const monteCarloSimulations = clampInt(r.monte_carlo_simulations, L.monte_carlo_simulations.min, L.monte_carlo_simulations.max, 1000);
  const monteCarloStd = clampRate(r.monte_carlo_std, L.monte_carlo_std.min, L.monte_carlo_std.max, 0.15);

  // Dollar fields
  const pretaxAccounts = clampDollar(r.pretax_accounts);
  const rothAccounts = clampDollar(r.roth_accounts);
  const taxableAccounts = clampDollar(r.taxable_accounts);
  const otherAssets = clampDollar(r.other_assets);
  const annualIncome = clampDollar(r.annual_income);
  const annualSpending = clampDollar(r.annual_spending);
  const desiredSpending = clampDollar(r.desired_spending_today_dollars);
  const healthcareBump = clampDollar(r.healthcare_annual_bump);
  const ssMonthlyBenefit = clampDollar(r.ss_monthly_benefit);

  // Enums — coerce to defaults if invalid
  const filingStatus: FilingStatus = FILING_STATUSES.has(r.filing_status as string)
    ? (r.filing_status as FilingStatus)
    : 'mfj';
  const withdrawalStrategy: WithdrawalStrategy = WITHDRAWAL_STRATEGIES.has(r.withdrawal_strategy as string)
    ? (r.withdrawal_strategy as WithdrawalStrategy)
    : 'conventional';

  // Booleans
  const modelRmds = typeof r.model_rmds === 'boolean' ? r.model_rmds : true;
  const useMonteCarlo = typeof r.use_monte_carlo === 'boolean' ? r.use_monte_carlo : false;

  // Dynamic lists — cap at 50 each, filter malformed entries
  const rawOte = Array.isArray(r.one_time_expenses) ? r.one_time_expenses.slice(0, LIST_LIMITS.max_items) : [];
  const oneTimeExpenses = rawOte
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map(e => ({
      age: clampInt(e.age, LIST_LIMITS.age.min, LIST_LIMITS.age.max, 65),
      amount: clampDollar(e.amount),
      label: typeof e.label === 'string' ? e.label.slice(0, LIST_LIMITS.label_max_length) : 'Expense',
    }))
    .filter(e => e.amount > 0);

  const rawRis = Array.isArray(r.retirement_income_streams) ? r.retirement_income_streams.slice(0, LIST_LIMITS.max_items) : [];
  const retirementIncomeStreams = rawRis
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map(e => ({
      amount: clampDollar(e.amount),
      start_age: clampInt(e.start_age, LIST_LIMITS.age.min, LIST_LIMITS.age.max, 65),
      end_age: clampInt(e.end_age, LIST_LIMITS.age.min, LIST_LIMITS.age.max, 95),
      label: typeof e.label === 'string' ? e.label.slice(0, LIST_LIMITS.label_max_length) : 'Income',
    }))
    .filter(e => e.amount > 0);

  const name = typeof r.name === 'string' ? r.name.slice(0, NAME_MAX_LENGTH) : 'Scenario';

  const inputs: ScenarioInputs = {
    name,
    current_age: currentAge,
    retirement_age: retirementAge,
    pretax_accounts: pretaxAccounts,
    roth_accounts: rothAccounts,
    taxable_accounts: taxableAccounts,
    other_assets: otherAssets,
    annual_income: annualIncome,
    annual_spending: annualSpending,
    savings_rate: savingsRate,
    pretax_contribution_rate: pretaxContributionRate,
    roth_contribution_rate: rothContributionRate,
    investment_return_rate: investmentReturnRate,
    inflation_rate: inflationRate,
    salary_growth_rate: salaryGrowthRate,
    ss_monthly_benefit: ssMonthlyBenefit,
    ss_claiming_age: ssClaimingAge,
    desired_spending_today_dollars: desiredSpending,
    healthcare_annual_bump: healthcareBump,
    one_time_expenses: oneTimeExpenses,
    retirement_income_streams: retirementIncomeStreams,
    filing_status: filingStatus,
    model_rmds: modelRmds,
    withdrawal_strategy: withdrawalStrategy,
    safe_withdrawal_rate: safeWithdrawalRate,
    use_monte_carlo: useMonteCarlo,
    monte_carlo_simulations: monteCarloSimulations,
    monte_carlo_std: monteCarloStd,
  };

  return { ok: true, inputs };
}
