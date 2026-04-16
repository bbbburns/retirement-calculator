export interface OneTimeExpense {
  age: number;
  amount: number;
  label: string;
}

export interface IncomeStream {
  amount: number;
  start_age: number;
  end_age: number;
  label: string;
}

export type FilingStatus = 'mfj' | 'single' | 'hoh';
export type WithdrawalStrategy = 'conventional' | 'roth_first' | 'proportional';

export interface ScenarioInputs {
  name: string;

  // Ages
  current_age: number;
  retirement_age: number;

  // Account balances (today's dollars)
  pretax_accounts: number;
  roth_accounts: number;
  taxable_accounts: number;
  other_assets: number;

  // Income & savings
  annual_income: number;
  annual_spending: number;
  savings_rate: number;
  pretax_contribution_rate: number;
  roth_contribution_rate: number;

  // Growth assumptions (nominal rates as decimals)
  investment_return_rate: number;
  inflation_rate: number;
  salary_growth_rate: number;

  // Social Security
  ss_monthly_benefit: number;
  ss_claiming_age: number;

  // Retirement spending
  desired_spending_today_dollars: number;
  healthcare_annual_bump: number;
  one_time_expenses: OneTimeExpense[];
  retirement_income_streams: IncomeStream[];

  // Tax & withdrawal
  filing_status: FilingStatus;
  model_rmds: boolean;
  withdrawal_strategy: WithdrawalStrategy;
  safe_withdrawal_rate: number;

  // Monte Carlo
  use_monte_carlo: boolean;
  monte_carlo_simulations: number;
  monte_carlo_std: number;
}

export interface ScenarioResult {
  // Key scalar outputs
  fire_number: number;
  income_covers_expenses: boolean;
  retirement_age_actual: number | null;
  portfolio_at_retirement: number;
  max_sustainable_spending: number;
  portfolio_depletion_age: number | null;

  // Time series (one entry per year from current_age to MAX_AGE)
  ages: number[];
  portfolio_nominal: number[];
  portfolio_real: number[];
  annual_spending_nominal: number[];
  annual_ss_income_nominal: number[];
  annual_retirement_income_nominal: number[];

  // Per-bucket time series
  pretax_nominal: number[];
  roth_nominal: number[];
  taxable_brokerage_nominal: number[];
  annual_taxes_paid_nominal: number[];
  annual_rmd_nominal: number[];

  // Monte Carlo (populated when use_monte_carlo=true)
  mc_success_rate: number | null;
  mc_percentile_10: number[] | null;
  mc_percentile_50: number[] | null;
  mc_percentile_90: number[] | null;
}

export function defaultInputs(): ScenarioInputs {
  return {
    name: 'Base Case',
    current_age: 45,
    retirement_age: 65,
    pretax_accounts: 100_000,
    roth_accounts: 0,
    taxable_accounts: 10_000,
    other_assets: 0,
    annual_income: 80_000,
    annual_spending: 65_000,
    savings_rate: 0.20,
    pretax_contribution_rate: 0.70,
    roth_contribution_rate: 0.20,
    investment_return_rate: 0.07,
    inflation_rate: 0.03,
    salary_growth_rate: 0.02,
    ss_monthly_benefit: 1_800,
    ss_claiming_age: 67,
    desired_spending_today_dollars: 65_000,
    healthcare_annual_bump: 5_000,
    one_time_expenses: [],
    retirement_income_streams: [],
    filing_status: 'mfj',
    model_rmds: true,
    withdrawal_strategy: 'conventional',
    safe_withdrawal_rate: 0.04,
    use_monte_carlo: false,
    monte_carlo_simulations: 1000,
    monte_carlo_std: 0.15,
  };
}
