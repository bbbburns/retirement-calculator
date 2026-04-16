// Retirement Calculator — frontend JS
// Vanilla JS: reads inputs → POST /api/calculate → renders Plotly chart + table

'use strict';

// ---------------------------------------------------------------------------
// Constants & state
// ---------------------------------------------------------------------------

const API_URL = '/api/calculate';
const LS_KEY = 'retirement_scenarios';
const UNSAFE_CHARS = /[/\\:*?"<>|]/;

let scenarios = []; // [{name, inputs}]
let activeIdx = 0;
let lastResult = null;
let mcResult = null; // last Monte Carlo result
let populating = false; // true while populateInputs() is running — suppresses auto-save

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt$(v) {
  if (v == null || isNaN(v)) return '—';
  return '$' + Math.round(v).toLocaleString();
}

function parseDollar(s) {
  if (!s) return 0;
  const cleaned = String(s).replace(/[$,\s]/g, '');
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : Math.max(v, 0);
}

// ---------------------------------------------------------------------------
// Default inputs (mirror TypeScript defaultInputs())
// ---------------------------------------------------------------------------

function defaultInputs(name = 'Base Case') {
  return {
    name,
    current_age: 45,
    retirement_age: 65,
    pretax_accounts: 100_000,
    roth_accounts: 0,
    taxable_accounts: 10_000,
    other_assets: 0,
    annual_income: 80_000,
    annual_spending: 65_000,
    savings_rate: 0,
    pretax_contribution_rate: 0,
    roth_contribution_rate: 0,
    pretax_contribution_dollars: 0,
    roth_contribution_dollars: 0,
    taxable_contribution_dollars: 0,
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

// ---------------------------------------------------------------------------
// Read inputs from DOM → ScenarioInputs object
// ---------------------------------------------------------------------------


function readInputs() {
  const inp = scenarios[activeIdx]?.inputs ?? defaultInputs();

  // Helper: get slider value
  const sl = (id) => parseFloat(document.getElementById(id)?.value ?? 0);
  const tx = (id) => parseDollar(document.getElementById(id)?.value);
  const sel = (id) => document.getElementById(id)?.value ?? '';
  const chk = (id) => document.getElementById(id)?.checked ?? false;

  const income = tx('annual_income');
  const pretax$ = tx('pretax_contribution_dollars');
  const roth$ = tx('roth_contribution_dollars');
  const taxable$ = tx('taxable_contribution_dollars');
  const total$ = pretax$ + roth$ + taxable$;
  const savingsRate = income > 0 ? Math.min(total$ / income, 1) : 0;
  const pretaxFrac  = total$ > 0 ? pretax$ / total$ : 0;
  const rothFrac    = total$ > 0 ? roth$   / total$ : 0;

  const currentAge = sl('current_age');
  const rawRetAge = sl('retirement_age');
  if (rawRetAge < currentAge) {
    showError(`Retirement age (${rawRetAge}) is below current age (${currentAge}) — adjust the sliders.`);
  } else {
    hideError();
  }

  return {
    name: scenarios[activeIdx]?.name ?? 'Base Case',
    current_age: currentAge,
    retirement_age: Math.max(rawRetAge, currentAge),
    pretax_accounts: tx('pretax_accounts'),
    roth_accounts: tx('roth_accounts'),
    taxable_accounts: tx('taxable_accounts'),
    other_assets: tx('other_assets'),
    annual_income: income,
    annual_spending: 0, // not used directly
    savings_rate: savingsRate,
    pretax_contribution_rate: pretaxFrac,
    roth_contribution_rate: rothFrac,
    pretax_contribution_dollars: pretax$,
    roth_contribution_dollars: roth$,
    taxable_contribution_dollars: taxable$,
    investment_return_rate: sl('investment_return_rate'),
    inflation_rate: sl('inflation_rate'),
    salary_growth_rate: sl('salary_growth_rate'),
    ss_monthly_benefit: tx('ss_monthly_benefit'),
    ss_claiming_age: sl('ss_claiming_age'),
    desired_spending_today_dollars: tx('desired_spending_today_dollars'),
    healthcare_annual_bump: tx('healthcare_annual_bump'),
    one_time_expenses: readOneTimeExpenses(),
    retirement_income_streams: readIncomeStreams(),
    filing_status: sel('filing_status'),
    model_rmds: chk('model_rmds'),
    withdrawal_strategy: sel('withdrawal_strategy'),
    safe_withdrawal_rate: sl('safe_withdrawal_rate'),
    use_monte_carlo: false,
    monte_carlo_simulations: sl('monte_carlo_simulations') || 1000,
    monte_carlo_std: sl('monte_carlo_std') || 0.15,
  };
}

// ---------------------------------------------------------------------------
// Populate DOM from inputs object
// ---------------------------------------------------------------------------

function populateInputs(inp) {
  populating = true;
  const setSlider = (id, val) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; updateSliderLabel(id, val); }
  };
  const setDollar = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val == null ? '' : Math.round(val).toLocaleString();
  };
  const setSel = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  const setChk = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };

  setSlider('current_age', inp.current_age);
  setSlider('retirement_age', inp.retirement_age);
  setDollar('pretax_accounts', inp.pretax_accounts);
  setDollar('roth_accounts', inp.roth_accounts);
  setDollar('taxable_accounts', inp.taxable_accounts);
  setDollar('other_assets', inp.other_assets);
  setDollar('annual_income', inp.annual_income);
  // Per-bucket dollar contributions. If the scenario predates this UI it
  // won't have these fields — fall back to empty (forces user re-entry).
  const hasDollars = inp.pretax_contribution_dollars !== undefined
                  || inp.roth_contribution_dollars !== undefined
                  || inp.taxable_contribution_dollars !== undefined;
  setDollar('pretax_contribution_dollars',  hasDollars ? inp.pretax_contribution_dollars  : 0);
  setDollar('roth_contribution_dollars',    hasDollars ? inp.roth_contribution_dollars    : 0);
  setDollar('taxable_contribution_dollars', hasDollars ? inp.taxable_contribution_dollars : 0);
  setSlider('salary_growth_rate', inp.salary_growth_rate);
  setSlider('investment_return_rate', inp.investment_return_rate);
  setSlider('inflation_rate', inp.inflation_rate);
  setDollar('desired_spending_today_dollars', inp.desired_spending_today_dollars);
  setDollar('healthcare_annual_bump', inp.healthcare_annual_bump);
  setDollar('ss_monthly_benefit', inp.ss_monthly_benefit);
  setSlider('ss_claiming_age', inp.ss_claiming_age);
  setSel('filing_status', inp.filing_status);
  setSel('withdrawal_strategy', inp.withdrawal_strategy);
  setChk('model_rmds', inp.model_rmds);
  setSlider('safe_withdrawal_rate', inp.safe_withdrawal_rate);
  setSlider('monte_carlo_simulations', inp.monte_carlo_simulations ?? 1000);
  setSlider('monte_carlo_std', inp.monte_carlo_std ?? 0.15);

  renderOneTimeExpenses(inp.one_time_expenses ?? []);
  renderIncomeStreams(inp.retirement_income_streams ?? []);
  updateSavingsSummary();
  populating = false;
}

// ---------------------------------------------------------------------------
// Slider label updates
// ---------------------------------------------------------------------------

const PCT_SLIDERS = new Set([
  'salary_growth_rate', 'investment_return_rate', 'inflation_rate', 'safe_withdrawal_rate',
  'monte_carlo_std',
]);

function updateSliderLabel(id, val) {
  const el = document.getElementById('val-' + id);
  if (!el) return;
  if (PCT_SLIDERS.has(id)) {
    el.textContent = (parseFloat(val) * 100).toFixed(1) + '%';
  } else {
    el.textContent = val;
  }
}

document.querySelectorAll('input[type="range"]').forEach(el => {
  el.addEventListener('input', () => {
    updateSliderLabel(el.id, el.value);
    debouncedCalculate();
  });
});

const SAVINGS_INPUT_IDS = new Set([
  'annual_income',
  'pretax_contribution_dollars',
  'roth_contribution_dollars',
  'taxable_contribution_dollars',
]);

function updateSavingsSummary() {
  const income = parseDollar(document.getElementById('annual_income')?.value);
  const total  = parseDollar(document.getElementById('pretax_contribution_dollars')?.value)
               + parseDollar(document.getElementById('roth_contribution_dollars')?.value)
               + parseDollar(document.getElementById('taxable_contribution_dollars')?.value);
  document.getElementById('ss-total').textContent = fmt$(total);
  const pct = income > 0 ? (total / income * 100).toFixed(1) + '%' : '—';
  document.getElementById('ss-pct').textContent = `(${pct})`;
  const summary = document.getElementById('savings-summary');
  summary.classList.toggle('over', income > 0 && total > income);
}

document.querySelectorAll('input[type="text"], select:not(#scenario-select)').forEach(el => {
  el.addEventListener('input', () => {
    if (SAVINGS_INPUT_IDS.has(el.id)) updateSavingsSummary();
    debouncedCalculate();
  });
  el.addEventListener('change', () => debouncedCalculate());
});

document.querySelectorAll('input[type="checkbox"]').forEach(el => {
  el.addEventListener('change', () => debouncedCalculate());
});

// Event delegation for dynamic list containers — catches input from any
// child row, including rows added after page load.
// Event delegation for dynamic list containers.
document.getElementById('ote-rows').addEventListener('input', () => debouncedCalculate());
document.getElementById('ris-rows').addEventListener('input', () => debouncedCalculate());

// ---------------------------------------------------------------------------
// Dynamic lists: one-time expenses
// ---------------------------------------------------------------------------

function readOneTimeExpenses() {
  const rows = document.querySelectorAll('#ote-rows .list-item');
  const result = [];
  rows.forEach(row => {
    const [ageEl, amtEl, lblEl] = row.querySelectorAll('input');
    const age = parseInt(ageEl.value);
    const amount = parseDollar(amtEl.value);
    const label = lblEl.value || 'Expense';
    if (!isNaN(age) && amount > 0) result.push({ age, amount, label });
  });
  return result;
}

function renderOneTimeExpenses(list) {
  const container = document.getElementById('ote-rows');
  container.innerHTML = '';
  list.forEach((item, i) => addOneTimeExpenseRow(item, i));
}

function addOneTimeExpense() {
  addOneTimeExpenseRow({ age: 65, amount: 0, label: '' }, null);
  debouncedCalculate();
}

function addOneTimeExpenseRow(item, _idx) {
  const container = document.getElementById('ote-rows');
  const row = document.createElement('div');
  row.className = 'list-item';
  row.innerHTML = `
    <input type="number" placeholder="Age" value="${item.age}" min="20" max="120" step="1" aria-label="Expense age" style="max-width:40px">
    <input type="text" placeholder="Amount" inputmode="numeric" aria-label="Expense amount">
    <input type="text" placeholder="Label" aria-label="Expense label">
    <button onclick="this.closest('.list-item').remove(); debouncedCalculate();" aria-label="Remove expense">&times;</button>
  `;
  row.querySelectorAll('input')[1].value = item.amount ? Math.round(item.amount).toLocaleString() : '';
  row.querySelectorAll('input')[2].value = item.label || '';
  container.appendChild(row);
}

// ---------------------------------------------------------------------------
// Dynamic lists: retirement income streams
// ---------------------------------------------------------------------------

function readIncomeStreams() {
  const rows = document.querySelectorAll('#ris-rows .ris-item');
  const result = [];
  rows.forEach(row => {
    const amount = parseDollar(row.querySelector('.ris-amount').value);
    const ages = row.querySelectorAll('.ris-age');
    const start_age = parseInt(ages[0].value);
    const end_age = parseInt(ages[1].value);
    const label = row.querySelector('.ris-label').value || 'Income';
    if (amount > 0 && !isNaN(start_age) && !isNaN(end_age)) {
      result.push({ amount, start_age, end_age, label });
    }
  });
  return result;
}

function renderIncomeStreams(list) {
  const container = document.getElementById('ris-rows');
  container.innerHTML = '';
  list.forEach((item) => addIncomeStreamRow(item));
}

function addIncomeStream() {
  addIncomeStreamRow({ amount: 0, start_age: 65, end_age: 95, label: '' });
  debouncedCalculate();
}

function addIncomeStreamRow(item) {
  const container = document.getElementById('ris-rows');
  const row = document.createElement('div');
  row.className = 'ris-item';
  row.innerHTML = `
    <div class="ris-row1">
      <input type="text" placeholder="Amount ($/yr)" class="ris-amount" inputmode="numeric" aria-label="Annual income amount">
      <button onclick="this.closest('.ris-item').remove(); debouncedCalculate();" aria-label="Remove income stream">&times;</button>
    </div>
    <div class="ris-row2">
      <label>From <input type="number" placeholder="65" class="ris-age" min="20" max="120" step="1" aria-label="Income start age"></label>
      <label>To <input type="number" placeholder="95" class="ris-age" min="20" max="120" step="1" aria-label="Income end age"></label>
      <input type="text" placeholder="Label" class="ris-label" aria-label="Income stream label">
    </div>
  `;
  row.querySelector('.ris-amount').value = item.amount ? Math.round(item.amount).toLocaleString() : '';
  row.querySelectorAll('.ris-age')[0].value = item.start_age ?? 65;
  row.querySelectorAll('.ris-age')[1].value = item.end_age ?? 95;
  row.querySelector('.ris-label').value = item.label || '';
  container.appendChild(row);
}

// ---------------------------------------------------------------------------
// Collapsible list sections
// ---------------------------------------------------------------------------

function toggleList(which) {
  const listEl = document.getElementById(which + '-list');
  const btn = listEl.previousElementSibling;
  const open = listEl.classList.toggle('open');
  btn.textContent = (open ? '▼ ' : '▶ ') + btn.textContent.slice(2);
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

let calcTimer = null;
function debouncedCalculate() {
  clearTimeout(calcTimer);
  calcTimer = setTimeout(calculate, 300);
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.hidden = false;
}

function hideError() {
  const banner = document.getElementById('error-banner');
  banner.hidden = true;
}

async function calculate() {
  const inputs = readInputs();
  if (!populating) {
    scenarios[activeIdx].inputs = inputs;
    saveToStorage();
    if (compareResults) { compareDirty = true; updateCompareStatus(); }
  }
  const outputEl = document.getElementById('output');
  outputEl.classList.add('is-loading');
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    if (!res.ok) {
      showError(`Server error (HTTP ${res.status}). Check for out-of-range values.`);
      console.error('API error', res.status);
      return;
    }
    hideError();
    lastResult = await res.json();
    mcResult = null; // clear stale MC on any input change
    document.getElementById('mc-result').textContent = '';
    renderResult(lastResult);
  } catch (e) {
    showError('Could not reach the server. Check your connection and try again.');
    console.error('Fetch error', e);
  } finally {
    outputEl.classList.remove('is-loading');
  }
}

// ---------------------------------------------------------------------------
// Render result
// ---------------------------------------------------------------------------

function renderResult(result) {
  renderMetrics(result);
  renderChart(result, 'nominal');
  renderChart(result, 'real');
  renderTable(result);
  renderBanner(result);
}

function renderMetrics(result) {
  const retAge = document.querySelector('input#retirement_age')?.value ?? 65;

  document.getElementById('m-fire-number').textContent = fmt$(result.fire_number);
  document.getElementById('m-max-spending').textContent = fmt$(result.max_sustainable_spending);
  document.getElementById('m-portfolio-at-retirement').textContent = fmt$(result.portfolio_at_retirement);

  const fireAgeEl = document.getElementById('m-fire-age');
  if (result.retirement_age_actual != null) {
    fireAgeEl.textContent = result.retirement_age_actual;
    fireAgeEl.className = 'value ' + (result.retirement_age_actual <= retAge ? 'good' : '');
  } else {
    fireAgeEl.textContent = 'Not reachable before 80';
    fireAgeEl.className = 'value warn';
  }

  const depEl = document.getElementById('m-depletion-age');
  if (result.portfolio_depletion_age != null) {
    depEl.textContent = result.portfolio_depletion_age;
    depEl.className = 'value bad';
  } else {
    depEl.textContent = '95+ ✓';
    depEl.className = 'value good';
    depEl.title = 'Portfolio lasted to age 95, the end of the simulation. It may last longer in reality.';
  }
}

function renderBanner(result) {
  const bannerEl = document.getElementById('banner');
  if (result.income_covers_expenses) {
    bannerEl.className = 'banner info';
    bannerEl.textContent = 'SS + retirement income covers all expenses — portfolio withdrawal is minimal.';
  } else if (result.desired_spending_today_dollars === 0 || result.fire_number < 1) {
    bannerEl.className = 'banner warning';
    bannerEl.textContent = 'Spending is $0 — enter a desired retirement spending amount.';
  } else {
    bannerEl.className = 'banner';
    bannerEl.textContent = '';
  }
}

function renderChart(result, type) {
  const elemId = 'chart-' + type;
  const isReal = type === 'real';
  const portfolio = isReal ? result.portfolio_real : result.portfolio_nominal;
  const ages = result.ages;
  const retAge = parseInt(document.querySelector('input#retirement_age')?.value ?? 65);
  const fireAge = result.retirement_age_actual;

  const retIdx = ages.indexOf(retAge);
  const accumAges = retIdx >= 0 ? ages.slice(0, retIdx + 1) : ages;
  const drawAges = retIdx >= 0 ? ages.slice(retIdx) : [];
  const accumVals = retIdx >= 0 ? portfolio.slice(0, retIdx + 1) : portfolio;
  const drawVals = retIdx >= 0 ? portfolio.slice(retIdx) : [];

  // MC fan traces go FIRST so portfolio lines render on top of the shading
  const traces = [];

  if (mcResult && !isReal) {
    // mcResult stores the full-length arrays as returned by the API (NaN-padded
    // for accumulation years). Slice to drawdown-only by finding the retirement
    // index in the ages array — same boundary used for accumAges/drawAges split.
    const mcStartIdx = ages.indexOf(retAge);
    const mcAges = mcStartIdx >= 0 ? ages.slice(mcStartIdx) : [];
    const p10 = mcStartIdx >= 0 ? mcResult.p10.slice(mcStartIdx) : [];
    const p50 = mcStartIdx >= 0 ? mcResult.p50.slice(mcStartIdx) : [];
    const p90 = mcStartIdx >= 0 ? mcResult.p90.slice(mcStartIdx) : [];

    if (mcAges.length > 0 && p90.length === mcAges.length) {
      traces.push({
        x: [...mcAges, ...mcAges.slice().reverse()],
        y: [...p90, ...p10.slice().reverse()],
        fill: 'toself', fillcolor: 'rgba(249,115,22,0.12)',
        line: { color: 'transparent' }, name: 'MC 10–90%', showlegend: true,
        hoverinfo: 'skip',
      });
      traces.push({
        x: mcAges, y: p50,
        name: 'MC median', type: 'scatter', mode: 'lines',
        line: { color: '#d97706', width: 1.5, dash: 'dot' },
      });
    }
  }

  traces.push({
    x: accumAges, y: accumVals, name: 'Accumulation',
    type: 'scatter', mode: 'lines',
    line: { color: '#3b82f6', width: 2 },
    fill: 'tozeroy', fillcolor: 'rgba(59,130,246,0.08)',
  });
  traces.push({
    x: drawAges, y: drawVals, name: 'Drawdown',
    type: 'scatter', mode: 'lines',
    line: { color: '#f97316', width: 2 },
    fill: 'tozeroy', fillcolor: 'rgba(249,115,22,0.08)',
  });

  // FIRE age marker
  if (fireAge != null && fireAge < retAge) {
    const fireIdx = ages.indexOf(fireAge);
    if (fireIdx >= 0) {
      traces.push({
        x: [fireAge], y: [portfolio[fireIdx]],
        name: 'FIRE Age', type: 'scatter', mode: 'markers',
        marker: { color: '#16a34a', size: 10, symbol: 'diamond' },
      });
    }
  }

  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const plotBg    = dark ? '#1e293b' : '#ffffff';
  const paperBg   = dark ? '#1e293b' : '#ffffff';
  const gridColor = dark ? '#334155' : '#e5e7eb';
  const textColor = dark ? '#94a3b8' : '#374151';

  Plotly.react(elemId, traces, {
    margin: { t: 10, r: 10, b: 60, l: 20 },
    paper_bgcolor: paperBg,
    plot_bgcolor:  plotBg,
    font: { color: textColor },
    xaxis: { title: 'Age', fixedrange: false, gridcolor: gridColor, zerolinecolor: gridColor },
    yaxis: {
      title: isReal ? "Portfolio Value (today's $)" : 'Portfolio Value',
      tickformat: '$,.0f',
      automargin: true,
      gridcolor: gridColor,
      zerolinecolor: gridColor,
    },
    legend: { orientation: 'h', y: -0.2, font: { color: textColor }, xanchor: 'center', x: 0.5 },
    hovermode: 'x unified',
    shapes: [{
      type: 'line', x0: retAge, x1: retAge, y0: 0, y1: 1,
      xref: 'x', yref: 'paper',
      line: { color: dark ? '#475569' : '#94a3b8', width: 1, dash: 'dot' },
    }],
  }, { responsive: true });
}

function renderTable(result) {
  const retAge = parseInt(document.querySelector('input#retirement_age')?.value ?? 65);
  const fireAge = result.retirement_age_actual;
  const depAge = result.portfolio_depletion_age;

  const tbody = document.getElementById('table-body');
  const rows = [];

  for (let i = 0; i < result.ages.length; i++) {
    const age = result.ages[i];
    let cls = '';
    if (age === retAge) cls = 'retirement-row';
    else if (age === fireAge) cls = 'fire-row';
    else if (age === depAge) cls = 'depletion-row';

    rows.push(`<tr class="${cls}">
      <td>${age}${age === retAge ? ' 🎯' : age === fireAge ? ' ⚡' : age === depAge ? ' ⚠' : ''}</td>
      <td>${fmt$(result.portfolio_nominal[i])}</td>
      <td>${fmt$(result.portfolio_real[i])}</td>
      <td>${result.annual_spending_nominal[i] ? fmt$(result.annual_spending_nominal[i]) : '—'}</td>
      <td>${result.annual_ss_income_nominal[i] ? fmt$(result.annual_ss_income_nominal[i]) : '—'}</td>
      <td>${result.annual_retirement_income_nominal[i] ? fmt$(result.annual_retirement_income_nominal[i]) : '—'}</td>
      <td>${result.annual_taxes_paid_nominal[i] ? fmt$(result.annual_taxes_paid_nominal[i]) : '—'}</td>
      <td>${result.annual_rmd_nominal[i] ? fmt$(result.annual_rmd_nominal[i]) : '—'}</td>
      <td>${fmt$(result.pretax_nominal[i])}</td>
      <td>${fmt$(result.roth_nominal[i])}</td>
      <td>${fmt$(result.taxable_brokerage_nominal[i])}</td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('');
}

// ---------------------------------------------------------------------------
// Monte Carlo
// ---------------------------------------------------------------------------

document.getElementById('btn-mc').addEventListener('click', async () => {
  const btn = document.getElementById('btn-mc');
  btn.disabled = true;
  btn.textContent = 'Running…';
  const inputs = { ...readInputs(), use_monte_carlo: true };
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    if (!res.ok) return;
    const result = await res.json();
    // Store full-length arrays (NaN-padded for accumulation years).
    // renderChart slices to drawdown-only by retirement_age index.
    mcResult = {
      p10: result.mc_percentile_10,
      p50: result.mc_percentile_50,
      p90: result.mc_percentile_90,
    };
    document.getElementById('mc-result').textContent =
      `Success rate: ${(result.mc_success_rate * 100).toFixed(1)}% (portfolio survives to 95)`;
    if (lastResult) renderChart(lastResult, 'nominal');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Monte Carlo';
  }
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    // Reflow Plotly on tab show
    if (btn.dataset.tab === 'nominal') Plotly.Plots.resize('chart-nominal');
    if (btn.dataset.tab === 'real') Plotly.Plots.resize('chart-real');
    if (btn.dataset.tab === 'compare') renderCompareCheckboxes();
  });
});

// ---------------------------------------------------------------------------
// Scenario comparison
// ---------------------------------------------------------------------------

let compareResults = null; // { names: [], results: [] } — last comparison
let compareDirty = false;

function renderCompareCheckboxes() {
  const box = document.getElementById('compare-checkboxes');
  // Preserve any existing checkbox state by name
  const checked = new Set();
  box.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => checked.add(cb.value));
  if (checked.size === 0) checked.add(scenarios[activeIdx].name);

  box.innerHTML = '';
  scenarios.forEach((s) => {
    const id = 'cmp-' + s.name.replace(/\W+/g, '_');
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" id="${id}" value="${escapeHtml(s.name)}" ${checked.has(s.name) ? 'checked' : ''}> ${escapeHtml(s.name)}`;
    box.appendChild(label);
  });
  box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', updateCompareButton);
  });
  updateCompareButton();
  updateCompareStatus();
}

function getCheckedScenarioNames() {
  return Array.from(document.querySelectorAll('#compare-checkboxes input[type="checkbox"]:checked'))
    .map(cb => cb.value);
}

function updateCompareButton() {
  document.getElementById('btn-compare').disabled = getCheckedScenarioNames().length < 2;
}

function updateCompareStatus() {
  const status = document.getElementById('compare-status');
  const btn = document.getElementById('btn-compare');
  if (compareDirty && compareResults) {
    status.textContent = 'Inputs changed since last run.';
    status.className = 'stale';
    if (!btn.disabled) btn.textContent = 'Refresh compare';
  } else {
    status.textContent = '';
    status.className = '';
    if (!btn.disabled) btn.textContent = 'Compare selected';
  }
}

document.getElementById('btn-compare').addEventListener('click', runComparison);

async function runComparison() {
  const names = getCheckedScenarioNames();
  if (names.length < 2) return;
  const picked = names
    .map(n => scenarios.find(s => s.name === n))
    .filter(Boolean);

  const btn = document.getElementById('btn-compare');
  const status = document.getElementById('compare-status');
  btn.disabled = true;
  status.className = '';

  const results = [];
  for (let i = 0; i < picked.length; i++) {
    status.textContent = `Computing ${i + 1}/${picked.length}…`;
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(picked[i].inputs),
      });
      if (!res.ok) {
        status.textContent = `Error computing "${picked[i].name}"`;
        btn.disabled = false;
        return;
      }
      results.push(await res.json());
    } catch (e) {
      status.textContent = `Error: ${e.message}`;
      btn.disabled = false;
      return;
    }
  }

  compareResults = { names: picked.map(s => s.name), inputs: picked.map(s => s.inputs), results };
  compareDirty = false;
  status.textContent = '';
  btn.disabled = false;
  btn.textContent = 'Compare selected';
  renderCompareTable(compareResults);
}

function totalLifetimeTaxes(result) {
  return (result.annual_taxes_paid_nominal || []).reduce((a, b) => a + (b || 0), 0);
}

function renderCompareTable(c) {
  const fmtAge = (a) => a == null ? '95+ ✓' : String(a);
  const fmtFireAge = (a) => a == null ? 'Not reached' : String(a);

  const rows = [
    { label: 'FIRE Number', values: c.results.map(r => r.fire_number), fmt: fmt$, best: 'min' },
    { label: 'FIRE Age', values: c.results.map(r => r.retirement_age_actual), fmt: fmtFireAge, best: 'min', skipNull: true },
    { label: 'Portfolio at Retirement', values: c.results.map(r => r.portfolio_at_retirement), fmt: fmt$, best: 'max' },
    { label: 'Max Sustainable Spending', values: c.results.map(r => r.max_sustainable_spending), fmt: fmt$, best: 'max' },
    { label: 'Depletion Age', values: c.results.map(r => r.portfolio_depletion_age), fmt: fmtAge, best: 'max', nullIsBest: true },
    { label: 'Total Lifetime Taxes', values: c.results.map(r => totalLifetimeTaxes(r)), fmt: fmt$, best: 'min' },
  ];

  let html = '<table class="compare-table"><thead><tr><th>Metric</th>';
  c.names.forEach(n => { html += `<th>${escapeHtml(n)}</th>`; });
  html += '</tr></thead><tbody>';

  rows.forEach(row => {
    const winnerIdx = pickWinner(row.values, row.best, row.nullIsBest);
    html += `<tr><td>${row.label}</td>`;
    row.values.forEach((v, i) => {
      const cls = i === winnerIdx ? 'winner' : '';
      const display = (row.skipNull && v == null) ? '—' : row.fmt(v);
      html += `<td class="${cls}">${display}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('compare-result').innerHTML = html;
}

function pickWinner(values, mode, nullIsBest) {
  let bestIdx = -1;
  let bestVal = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      if (nullIsBest) {
        if (bestVal !== 'null') { bestIdx = i; bestVal = 'null'; }
      }
      continue;
    }
    if (bestVal === 'null') continue; // null already wins
    if (bestVal == null) { bestIdx = i; bestVal = v; continue; }
    if (mode === 'min' && v < bestVal) { bestIdx = i; bestVal = v; }
    if (mode === 'max' && v > bestVal) { bestIdx = i; bestVal = v; }
  }
  // Don't highlight if all values are equal
  const allEqual = values.every(v => v === values[0]);
  return allEqual ? -1 : bestIdx;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------------------------------------------------------------------------
// Scenario management (localStorage)
// ---------------------------------------------------------------------------

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveToStorage() {
  localStorage.setItem(LS_KEY, JSON.stringify({ scenarios, activeIdx }));
}

function populateScenarioSelect() {
  const sel = document.getElementById('scenario-select');
  sel.innerHTML = '';
  scenarios.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  sel.value = activeIdx;
  document.getElementById('btn-delete').disabled = scenarios.length <= 1;
  // Keep compare checkboxes in sync with the scenario list
  if (document.getElementById('tab-compare')?.classList.contains('active')) {
    renderCompareCheckboxes();
  }
}

document.getElementById('scenario-select').addEventListener('change', (e) => {
  activeIdx = parseInt(e.target.value);
  mcResult = null;
  populateInputs(scenarios[activeIdx].inputs);
  populateScenarioSelect();
  calculate();
});

// New
document.getElementById('btn-new').addEventListener('click', () => {
  const name = uniqueName('New Scenario');
  scenarios.push({ name, inputs: defaultInputs(name) });
  activeIdx = scenarios.length - 1;
  populateInputs(scenarios[activeIdx].inputs);
  populateScenarioSelect();
  saveToStorage();
  calculate();
});

// Copy
document.getElementById('btn-copy').addEventListener('click', () => {
  const orig = scenarios[activeIdx];
  const name = uniqueName(orig.name + ' Copy');
  scenarios.push({ name, inputs: { ...deepClone(orig.inputs), name } });
  activeIdx = scenarios.length - 1;
  populateInputs(scenarios[activeIdx].inputs);
  populateScenarioSelect();
  saveToStorage();
  calculate();
});

// Delete
document.getElementById('btn-delete').addEventListener('click', () => {
  if (scenarios.length <= 1) return;
  scenarios.splice(activeIdx, 1);
  activeIdx = Math.min(activeIdx, scenarios.length - 1);
  populateInputs(scenarios[activeIdx].inputs);
  populateScenarioSelect();
  saveToStorage();
  calculate();
});


// Rename
document.getElementById('btn-rename').addEventListener('click', () => {
  openModal('Rename Scenario', scenarios[activeIdx].name, (newName) => {
    const err = validateName(newName);
    if (err) return err;
    scenarios[activeIdx].name = newName;
    scenarios[activeIdx].inputs.name = newName;
    populateScenarioSelect();
    saveToStorage();
    return null;
  });
});

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

let _modalCallback = null;

function openModal(title, initialValue, callback) {
  _modalCallback = callback;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-input').value = initialValue;
  document.getElementById('modal-error').textContent = '';
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-input').focus();
  document.getElementById('modal-input').select();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  _modalCallback = null;
}


document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-confirm').addEventListener('click', () => {
  const val = document.getElementById('modal-input').value.trim();
  const err = _modalCallback?.(val);
  if (err) {
    document.getElementById('modal-error').textContent = err;
  } else {
    closeModal();
  }
});
document.getElementById('modal-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('modal-confirm').click();
  if (e.key === 'Escape') closeModal();
});
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ---------------------------------------------------------------------------
// Validation & utilities
// ---------------------------------------------------------------------------

function validateName(name) {
  if (!name) return 'Name cannot be empty.';
  if (name.length > 100) return 'Name too long (max 100 characters).';
  if (UNSAFE_CHARS.test(name)) return 'Name contains invalid characters.';
  if (name.startsWith('.')) return 'Name cannot start with a dot.';
  const lower = name.toLowerCase();
  const dup = scenarios.some((s, i) => i !== activeIdx && s.name.toLowerCase() === lower);
  if (dup) return 'A scenario with that name already exists.';
  return null;
}

function uniqueName(base) {
  let name = base;
  let n = 1;
  const existing = new Set(scenarios.map(s => s.name.toLowerCase()));
  while (existing.has(name.toLowerCase())) {
    name = base + ' ' + (++n);
  }
  return name;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Share via URL
// ---------------------------------------------------------------------------

const LIST_KEYS = new Set(['one_time_expenses', 'retirement_income_streams']);
const BOOL_KEYS = new Set(['model_rmds', 'use_monte_carlo']);
const STRING_KEYS = new Set(['name', 'filing_status', 'withdrawal_strategy']);

function encodeScenarioToQuery(inputs) {
  const defaults = defaultInputs();
  const params = new URLSearchParams();
  // Always include name (so receivers see the source label)
  if (inputs.name) params.set('name', inputs.name);
  for (const key of Object.keys(defaults)) {
    if (key === 'name') continue;
    const val = inputs[key];
    const def = defaults[key];
    if (LIST_KEYS.has(key)) {
      if (Array.isArray(val) && val.length > 0) {
        params.set(key, JSON.stringify(val));
      }
    } else if (BOOL_KEYS.has(key)) {
      if (!!val !== !!def) params.set(key, val ? '1' : '0');
    } else {
      if (val !== def && val != null) params.set(key, String(val));
    }
  }
  return `${location.origin}${location.pathname}?${params.toString()}`;
}

function decodeQueryToScenario() {
  const params = new URLSearchParams(location.search);
  if ([...params.keys()].length === 0) return null;
  const defaults = defaultInputs();
  const inputs = { ...defaults };
  let touched = false;
  for (const key of Object.keys(defaults)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    try {
      if (LIST_KEYS.has(key)) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) inputs[key] = parsed;
      } else if (BOOL_KEYS.has(key)) {
        inputs[key] = raw === '1' || raw === 'true';
      } else if (STRING_KEYS.has(key)) {
        inputs[key] = raw;
      } else {
        const n = Number(raw);
        if (!isNaN(n)) inputs[key] = n;
      }
      touched = true;
    } catch (e) {
      console.warn('Skipping bad share param', key, e);
    }
  }
  if (!touched) return null;
  const name = inputs.name || 'Shared Scenario';
  return { name, inputs };
}

function importSharedScenarioIfPresent() {
  const shared = decodeQueryToScenario();
  if (!shared) return false;
  const safeName = (shared.name || '').slice(0, 100).replace(/[/\\:*?"<>|]/g, '_');
  const importName = uniqueName(`Shared: ${safeName}`);
  shared.inputs.name = importName;
  scenarios.push({ name: importName, inputs: shared.inputs });
  activeIdx = scenarios.length - 1;
  saveToStorage();
  history.replaceState({}, '', location.pathname);
  return true;
}

document.getElementById('btn-share').addEventListener('click', async () => {
  const url = encodeScenarioToQuery(scenarios[activeIdx].inputs);
  const btn = document.getElementById('btn-share');
  const restore = () => {
    btn.textContent = 'Share';
    btn.classList.remove('copied');
  };
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(restore, 1500);
  } catch (e) {
    // Fallback: show URL in modal pre-selected for manual copy (Ctrl+C / Cmd+C)
    openModal('Copy this link (Ctrl+C / Cmd+C)', url, () => null);
  }
});

// ---------------------------------------------------------------------------
// Dark mode
// ---------------------------------------------------------------------------

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved ? saved === 'dark' : prefersDark;
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
})();

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
  updateThemeButton();
  // Re-render charts with updated paper/plot background
  if (lastResult) { renderChart(lastResult, 'nominal'); renderChart(lastResult, 'real'); }
}

function updateThemeButton() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.getElementById('btn-theme').textContent = isDark ? '\u2600\uFE0E' : '☾';
  document.getElementById('btn-theme').title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

document.getElementById('btn-theme').addEventListener('click', toggleTheme);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  const stored = loadFromStorage();
  if (stored?.scenarios?.length) {
    scenarios = stored.scenarios;
    activeIdx = Math.min(stored.activeIdx ?? 0, scenarios.length - 1);
  } else {
    scenarios = [{ name: 'Base Case', inputs: defaultInputs('Base Case') }];
    activeIdx = 0;
  }

  importSharedScenarioIfPresent();

  updateThemeButton();
  populateInputs(scenarios[activeIdx].inputs);
  populateScenarioSelect();
  calculate();
}

boot();
