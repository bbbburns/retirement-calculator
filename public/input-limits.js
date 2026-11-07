// Input limits shared by the API (src/validate.ts) and the browser
// (public/scenario-file.js). This lives in public/ so the browser can load it;
// the Worker bundles it at build time.
//
// The sliders in index.html may use a narrower range than these limits (they
// must stay inside them — test/scenario-file.test.ts checks this).

const DOLLARS = Object.freeze({ min: 0, max: 1e9, integer: false });

export const NUMBER_LIMITS = Object.freeze({
  current_age:            { min: 18,    max: 100,  integer: true },
  retirement_age:         { min: 40,    max: 100,  integer: true }, // also >= current_age
  investment_return_rate: { min: -0.20, max: 0.30, integer: false },
  inflation_rate:         { min: -0.05, max: 0.20, integer: false },
  salary_growth_rate:     { min: 0,     max: 0.20, integer: false },
  savings_rate:           { min: 0,     max: 1,    integer: false },
  pretax_contribution_rate: { min: 0,   max: 1,    integer: false },
  roth_contribution_rate: { min: 0,     max: 1,    integer: false },
  safe_withdrawal_rate:   { min: 0.005, max: 0.20, integer: false },
  ss_claiming_age:        { min: 62,    max: 70,   integer: true },
  monte_carlo_simulations: { min: 100,  max: 2000, integer: true },
  monte_carlo_std:        { min: 0.01,  max: 0.50, integer: false },

  pretax_accounts: DOLLARS,
  roth_accounts: DOLLARS,
  taxable_accounts: DOLLARS,
  other_assets: DOLLARS,
  annual_income: DOLLARS,
  annual_spending: DOLLARS,
  desired_spending_today_dollars: DOLLARS,
  healthcare_annual_bump: DOLLARS,
  ss_monthly_benefit: DOLLARS,
  // Browser-only: the UI converts these to the *_rate fields before calling the API.
  pretax_contribution_dollars: DOLLARS,
  roth_contribution_dollars: DOLLARS,
  taxable_contribution_dollars: DOLLARS,
});

export const ENUM_VALUES = Object.freeze({
  filing_status: Object.freeze(['mfj', 'single', 'hoh']),
  withdrawal_strategy: Object.freeze(['conventional', 'roth_first', 'proportional']),
});

export const LIST_LIMITS = Object.freeze({
  max_items: 50,
  label_max_length: 100,
  age: Object.freeze({ min: 0, max: 120, integer: true }),
  amount: DOLLARS,
});

export const NAME_MAX_LENGTH = 100;
