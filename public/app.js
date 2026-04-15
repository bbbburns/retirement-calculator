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
    pretax_accounts: 1_000_000,
    roth_accounts: 0,
    taxable_accounts: 100_000,
    other_assets: 0,
    annual_income: 120_000,
    annual_spending: 80_000,
    savings_rate: 0.20,
    pretax_contribution_rate: 0.70,
    roth_contribution_rate: 0.20,
    investment_return_rate: 0.07,
    inflation_rate: 0.03,
    salary_growth_rate: 0.02,
    ss_monthly_benefit: 2_000,
    ss_claiming_age: 67,
    desired_spending_today_dollars: 80_000,
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

  return {
    name: scenarios[activeIdx]?.name ?? 'Base Case',
    current_age: sl('current_age'),
    retirement_age: sl('retirement_age'),
    pretax_accounts: tx('pretax_accounts'),
    roth_accounts: tx('roth_accounts'),
    taxable_accounts: tx('taxable_accounts'),
    other_assets: tx('other_assets'),
    annual_income: tx('annual_income'),
    annual_spending: 0, // not used directly
    savings_rate: sl('savings_rate'),
    pretax_contribution_rate: sl('pretax_contribution_rate'),
    roth_contribution_rate: sl('roth_contribution_rate'),
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
  setSlider('savings_rate', inp.savings_rate);
  setSlider('pretax_contribution_rate', inp.pretax_contribution_rate);
  setSlider('roth_contribution_rate', inp.roth_contribution_rate);
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
  updateContributionHint();
  populating = false;
}

// ---------------------------------------------------------------------------
// Slider label updates
// ---------------------------------------------------------------------------

const PCT_SLIDERS = new Set([
  'savings_rate', 'pretax_contribution_rate', 'roth_contribution_rate',
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
    updateContributionHint();
    debouncedCalculate();
  });
});

function updateContributionHint() {
  const pretax = parseFloat(document.getElementById('pretax_contribution_rate')?.value ?? 0);
  const roth   = parseFloat(document.getElementById('roth_contribution_rate')?.value ?? 0);
  const hint   = document.getElementById('contribution-hint');
  if (!hint) return;
  const total = (pretax + roth) * 100;
  const taxable = Math.max(100 - total, 0);
  if (total > 100) {
    hint.textContent = `⚠ ${total.toFixed(0)}% allocated — capped at 100%, no taxable contribution`;
    hint.className = 'contribution-hint over';
  } else if (taxable > 0) {
    hint.textContent = `Remaining ${taxable.toFixed(0)}% goes to taxable brokerage`;
    hint.className = 'contribution-hint';
  } else {
    hint.textContent = '100% allocated — no taxable contribution';
    hint.className = 'contribution-hint';
  }
}

document.querySelectorAll('input[type="text"], select:not(#scenario-select)').forEach(el => {
  el.addEventListener('input', () => debouncedCalculate());
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
    <input type="text" placeholder="Age" value="${item.age}" style="max-width:40px">
    <input type="text" placeholder="Amount">
    <input type="text" placeholder="Label">
    <button onclick="this.closest('.list-item').remove(); debouncedCalculate();">&times;</button>
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
      <input type="text" placeholder="Amount ($/yr)" class="ris-amount">
      <button onclick="this.closest('.ris-item').remove(); debouncedCalculate();">&times;</button>
    </div>
    <div class="ris-row2">
      <label>From <input type="text" placeholder="65" class="ris-age"></label>
      <label>To <input type="text" placeholder="95" class="ris-age"></label>
      <input type="text" placeholder="Label" class="ris-label">
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

async function calculate() {
  const inputs = readInputs();
  if (!populating) {
    scenarios[activeIdx].inputs = inputs;
    saveToStorage();
  }
  const outputEl = document.getElementById('output');
  outputEl.classList.add('is-loading');
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    if (!res.ok) { console.error('API error', res.status); return; }
    lastResult = await res.json();
    mcResult = null; // clear stale MC on any input change
    document.getElementById('mc-result').textContent = '';
    renderResult(lastResult);
  } catch (e) {
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
  });
});

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

  updateThemeButton();
  populateInputs(scenarios[activeIdx].inputs);
  populateScenarioSelect();
  calculate();
}

boot();
