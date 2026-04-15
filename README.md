# Retirement Calculator

A retirement planning calculator deployed as a Cloudflare Worker. Static frontend (vanilla JS + Plotly) backed by a stateless TypeScript API.

## Architecture

```
src/
  index.ts          Worker entry point
  routes.ts         Hono POST /api/calculate
  validate.ts       Input clamping and sanitization
  types.ts          ScenarioInputs, ScenarioResult interfaces
  calc/
    accumulation.ts Pre-retirement portfolio growth
    drawdown.ts     Post-retirement 3-bucket withdrawal simulation
    fire.ts         FIRE number, earliest FIRE age, scenario orchestrator
    monte_carlo.ts  Box-Muller log-normal MC with year-by-year percentiles
    rmd.ts          IRS Uniform Lifetime Table, RMD calculation (SECURE 2.0, age 73)
    tax.ts          2025 federal income tax brackets (MFJ / Single / HOH)
public/
  index.html        Single-page UI
  app.js            Input reading, debounced API calls, Plotly rendering, localStorage scenarios
  style.css         Layout and component styles (desktop + mobile ≤700px)
  how-it-works.html Standalone page documenting all calculation assumptions
test/
  calc.test.ts      Unit tests: tax, RMD, accumulation, FIRE number, drawdown, end-to-end
  api.test.ts       Integration tests via Hono app.request()
```

**Request flow:** sliders → `app.js` (300ms debounce) → `POST /api/calculate` → Worker computes `ScenarioResult` → Plotly chart + metrics table + year-by-year table.

**No database.** Scenarios are stored in `localStorage`. The Worker is fully stateless.

## UI notes

- **Dark mode** — ☾/☀︎ toggle in the top bar; preference stored in `localStorage` and synced across the main app and How It Works page. Theme is also applied on first load from `prefers-color-scheme`.
- **Mobile layout** — at ≤700px the sidebar stacks above the output panel, the scenario bar collapses into two rows (selector on top, action buttons below), and metric cards wrap 2-up.
- **Scenarios** — managed via the top bar dropdown. New, Copy, Rename, Delete. Auto-saved to `localStorage` on every recalculation.
- **Contribution hint** — live text below the Roth contribution slider shows how savings are split across buckets; warns if pre-tax + Roth exceed 100%.
- **Loading state** — metrics and chart fade while a recalculation is in-flight.
- **Disclaimer** — "For planning purposes only — not financial advice" shown in the sidebar footer and on the How It Works page.

## Development

```bash
npm install
npm run dev        # wrangler dev — serves at http://localhost:8787
npm test           # vitest (plain Node, no wrangler pool required)
npx tsc --noEmit   # type-check
```

## Deploy

```bash
wrangler deploy
```

## Calculation design

### Internal math

All simulation values are **nominal** (not inflation-adjusted). Real values are derived at display time by dividing by `(1 + inflation_rate)^(age - current_age)`.

### FIRE number

Computed via binary search (60 iterations) solving for the portfolio size where:

```
portfolio × SWR - taxes(portfolio × SWR × pretax_fraction) = net_spending
```

`net_spending = desired_spending + healthcare - ss_real - retirement_income_real`

SS and retirement income streams are discounted to today's dollars before subtracting:
- SS: `annual_ss / (1 + r)^(claiming_age - current_age)`
- Income streams: `amount / (1 + r)^(start_age - current_age)`

### Earliest FIRE age

Searches year-by-year through accumulation. At each candidate age, the FIRE number is recomputed with `retirement_age = candidate_age` (so income streams starting after that age are not counted prematurely). The portfolio is deflated to real dollars before comparing.

`pretax_fraction` from **current** balances is used here (not projected at-retirement fraction) to keep FIRE age stable when the retirement age slider moves.

### Drawdown simulation

Three-bucket tracking: pre-tax (401k/IRA), Roth, taxable brokerage.

Withdrawal strategies:
- **Conventional**: taxable → pre-tax → Roth
- **Roth-first**: Roth → pre-tax → taxable
- **Proportional**: withdraw from all buckets in proportion to their balance

RMDs (age 73+) are enforced when enabled: excess RMD over spending need is re-invested in the taxable account.

Tax on withdrawal uses a gross-up fixed-point iteration (6 rounds). Only pre-tax withdrawals are taxable; 85% of SS income is included in gross income.

Retirement income streams are **nominal** (fixed dollar amount each year, same as SS). Spending is inflated from current_age forward.

### Monte Carlo

Log-normal returns sampled via Box-Muller transform (no external library):
- `mu = ln(1 + r) - 0.5 * σ²`
- `sigma = monte_carlo_std`

Year-by-year p10/p50/p90 percentiles are computed by sorting per-year values across all simulations.

### Tax brackets

2025 federal brackets for MFJ, Single, and HOH. Update `src/calc/tax.ts` annually. Standard deductions: MFJ $30,000 / Single $15,000 / HOH $22,500.

## Test coverage

```
npx vitest run
```

31 tests across two files:

| Area | Tests |
|---|---|
| Tax brackets | 6 |
| RMD | 4 |
| Accumulation | 3 |
| FIRE number | 4 |
| Drawdown | 1 |
| End-to-end (runScenario) | 4 |
| API integration | 9 |
