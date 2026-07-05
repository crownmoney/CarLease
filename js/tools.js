/* Mini-calculator tabs: tab switching, the eight standalone tools, their
   charts, and cross-tab prefill into the flagship comparison (app.js).
   All maths comes from calculator.js / data.js. */

import { AU_DATA } from './data.js';
import {
  loanSummary, energyCost, fuelEconomy, emissionsPerYear, breakEven,
  stampDuty, novatedLease, resaleValue,
} from './calculator.js';

const $ = (id) => document.getElementById(id);

const fmt$ = new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
});
const money = (v) => fmt$.format(Math.round(v));
const money2 = (v) => new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(v);
const num = (id, fallback = 0) => {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : fallback;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const stat = (label, value, hero = false) =>
  `<div class="stat${hero ? ' hero-stat' : ''}"><p class="stat-label">${label}</p>
     <p class="stat-value">${value}</p></div>`;

/* ------------------------------------------------------ chart helpers --- */
/* Small SVG charts following the same mark specs as the main charts:
   thin bars with rounded data-ends, 2px lines, hairline grid, text tokens. */

function compactMoney(v) {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(Math.abs(v) >= 100000 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
}

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

/** Horizontal bars: rows = [{label, value, color?, hl?, valueText?}] */
function miniBars(rows, { fmt = money, labelW = 92 } = {}) {
  const W = 560, ROW = 30, PADR = 86;
  const H = rows.length * ROW + 6;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const baseColor = cssVar('--series-outright');
  const bars = rows.map((r, i) => {
    const y = 4 + i * ROW;
    const w = Math.max(2, (r.value / max) * (W - labelW - PADR));
    const c = r.color || (r.hl ? cssVar('--accent') : baseColor);
    return `
      <text x="${labelW - 8}" y="${y + 15}" text-anchor="end" font-size="12"
        font-weight="${r.hl ? 700 : 500}" fill="var(--text-secondary)">${esc(r.label)}</text>
      <rect x="${labelW}" y="${y + 3}" width="${w}" height="16" rx="4" fill="${c}"
        opacity="${r.hl === false ? 0.55 : 1}" />
      <rect x="${labelW}" y="${y + 3}" width="${Math.min(5, w / 2)}" height="16" fill="${c}" />
      <text x="${labelW + w + 7}" y="${y + 15}" font-size="12" font-weight="${r.hl ? 700 : 600}"
        fill="var(--text-primary)" font-variant="tabular-nums">${esc(r.valueText ?? fmt(r.value))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;display:block">
    <line x1="${labelW}" y1="2" x2="${labelW}" y2="${H - 2}" stroke="var(--baseline)" stroke-width="1" />
    ${bars}</svg>`;
}

/** One horizontal stacked bar with a legend. segments = [{label, value, color}] */
function stackedBar(segments, { fmt = money } = {}) {
  const W = 560, H = 26;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let x = 0;
  const rects = segments.filter((s) => s.value > 0).map((s, i, arr) => {
    const w = (s.value / total) * W;
    const gap = i < arr.length - 1 ? 2 : 0;
    const r = `<rect x="${x}" y="4" width="${Math.max(1, w - gap)}" height="18" fill="${s.color}"
      ${i === 0 ? 'rx="4"' : ''} ${i === arr.length - 1 ? 'rx="4"' : ''} />`;
    x += w;
    return r;
  }).join('');
  const legend = segments.filter((s) => s.value > 0).map((s) =>
    `<span class="key"><span class="swatch" style="background:${s.color}"></span>
      ${esc(s.label)} <strong>${fmt(s.value)}</strong></span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;display:block">${rects}</svg>
    <div class="legend mini-legend">${legend}</div>`;
}

/** Line chart: series = [{label, color, points}] over integer x 0..n-1 */
function miniLine(series, { xLabel = (i) => String(i), fmt = compactMoney, height = 220 } = {}) {
  const W = 560, H = height, PADL = 52, PADR = 16, PADT = 10, PADB = 26;
  const n = Math.max(...series.map((s) => s.points.length));
  const all = series.flatMap((s) => s.points);
  const maxV = Math.max(...all, 1);
  const minV = Math.min(...all, 0);
  const step = niceStep((maxV - minV) / 4);
  const yMax = Math.ceil(maxV / step) * step;
  const yMin = Math.min(0, Math.floor(minV / step) * step);
  const x = (i) => PADL + (i / (n - 1)) * (W - PADL - PADR);
  const y = (v) => PADT + (1 - (v - yMin) / (yMax - yMin)) * (H - PADT - PADB);
  let grid = '';
  for (let v = yMin; v <= yMax + 1e-9; v += step) {
    grid += `<line x1="${PADL}" y1="${y(v)}" x2="${W - PADR}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>
      <text x="${PADL - 7}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)"
        font-variant="tabular-nums">${esc(fmt(v))}</text>`;
  }
  let ticks = '';
  const every = n > 8 ? 2 : 1;
  for (let i = 0; i < n; i += every) {
    ticks += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11"
      fill="var(--text-muted)">${esc(xLabel(i))}</text>`;
  }
  const paths = series.map((s) => {
    const d = s.points.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
    const end = s.points.length - 1;
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(end)}" cy="${y(s.points[end])}" r="4" fill="${s.color}"
        stroke="var(--surface-1)" stroke-width="2"/>`;
  }).join('');
  const legend = series.length > 1
    ? `<div class="legend mini-legend">${series.map((s) =>
        `<span class="key"><span class="swatch" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('')}</div>`
    : '';
  return `${legend}<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;height:auto;display:block">
    ${grid}<line x1="${PADL}" y1="${y(Math.max(0, yMin))}" x2="${W - PADR}" y2="${y(Math.max(0, yMin))}"
      stroke="var(--baseline)" stroke-width="1"/>${ticks}${paths}</svg>`;
}

const chartTitle = (t) => `<p class="chart-h">${t}</p>`;

/* ------------------------------------------------------------- tabs --- */

const TAB_IDS = ['compare', 'loan', 'novated', 'duty', 'fuel', 'depreciation', 'economy', 'emissions', 'breakeven'];

/* Hero copy follows the selected calculator. The compare entry mirrors the
   static HTML (which is what crawlers index). */
const HERO_COPY = {
  compare: {
    title: 'Novated lease, car loan, or cash — which really costs less?',
    sub: `The honest three-way comparison for Australia — same car, same years, income tax, FBT,
      GST and your state's stamp duty done properly, with what your money would have earned
      <em>invested</em> counted for every method. Plus eight more calculators: loan repayments,
      stamp duty & rego, fuel, depreciation, emissions and EV break-even — one page for
      every car number.`,
    doc: 'Car Calculator — novated lease vs car loan vs cash | Crown Money',
  },
  loan: {
    title: 'What will a car loan really cost?',
    sub: `Repayments weekly, fortnightly or monthly — plus the total interest, the fees, and how
      the balance falls year by year. Balloon payments handled properly.`,
    doc: 'Car loan repayment calculator | Car Calculator by Crown Money',
  },
  novated: {
    title: 'What would a novated lease do to your pay?',
    sub: `Your salary deduction, the tax you'd save, the pre-tax / post-tax split and the residual
      at the end — with the EV exemption applied automatically when it should be.`,
    doc: 'Novated lease calculator | Car Calculator by Crown Money',
  },
  duty: {
    title: 'Stamp duty &amp; rego — every state, one look',
    sub: `Your state's duty on the exact car, first-year rego + CTP, a drive-away estimate — and
      the same car priced across all eight states and territories side by side.`,
    doc: 'Car stamp duty & rego calculator (all states) | Car Calculator',
  },
  fuel: {
    title: 'What does every kilometre cost you?',
    sub: `Fuel or charging costs per week, month and year from your real driving — and what the
      same distance would cost in an EV.`,
    doc: 'Fuel & charging cost calculator | Car Calculator by Crown Money',
  },
  depreciation: {
    title: 'What will your car be worth later?',
    sub: `A year-by-year value estimate for up to ten years — industry-average curve or your own
      rate — because depreciation is usually a car's single biggest cost.`,
    doc: 'Car depreciation calculator | Car Calculator by Crown Money',
  },
  economy: {
    title: 'How thirsty is your car, really?',
    sub: `Turn one fill-up into your true consumption: L/100 km, km per litre, MPG conversions
      and what it means per 100 km in dollars.`,
    doc: 'Fuel economy calculator (L/100km, MPG) | Car Calculator',
  },
  emissions: {
    title: 'How much CO₂ does your driving make?',
    sub: `Tonnes per year for petrol, diesel, hybrid or grid-charged EV — with the tree-equivalent
      to make it real, and how you compare to a typical car.`,
    doc: 'Car CO₂ emissions calculator | Car Calculator by Crown Money',
  },
  breakeven: {
    title: 'When does an EV pay for itself?',
    sub: `The extra purchase price against the fuel and servicing you'd stop paying — how many
      years until the electric car comes out ahead.`,
    doc: 'EV vs petrol break-even calculator | Car Calculator by Crown Money',
  },
};

function setHero(name) {
  const copy = HERO_COPY[name];
  if (!copy) return;
  const title = $('heroTitle');
  const sub = $('heroSub');
  if (!title || !sub) return;
  if (title.dataset.tab === name) return;
  title.dataset.tab = name;
  const swap = () => { title.innerHTML = copy.title; sub.innerHTML = copy.sub; };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    swap();
  } else {
    [title, sub].forEach((el) => { el.classList.remove('hero-swap'); });
    void title.offsetWidth; // restart the animation
    swap();
    [title, sub].forEach((el) => el.classList.add('hero-swap'));
  }
  document.title = copy.doc;
}

function activateTab(name, updateHash = true) {
  if (!TAB_IDS.includes(name)) return;
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  });
  TAB_IDS.forEach((t) => { $(`tab-${t}`).hidden = t !== name; });
  setHero(name);
  if (updateHash) history.replaceState(null, '', name === 'compare' ? '#calculator' : `#${name}`);
  if (window.gtag) window.gtag('event', 'calculator_tab', { tab: name });
}

function initTabs() {
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => {
    b.addEventListener('click', () => activateTab(b.dataset.tab));
  });
  // Delegated: results panels re-render on input, so per-node listeners would
  // be lost (or race a blur-triggered re-render mid-click).
  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { e.preventDefault(); activateTab(goto.dataset.goto); return; }
    const btn = e.target.closest('.prefill-btn');
    if (btn) {
      const host = btn.closest('.tab-panel [id]');
      const fn = host && PREFILL_SOURCES[host.id];
      if (fn) prefillCompare(fn());
    }
  });
  const h = location.hash.replace('#', '');
  if (TAB_IDS.includes(h)) activateTab(h, false);
  window.addEventListener('hashchange', () => {
    const t = location.hash.replace('#', '');
    if (TAB_IDS.includes(t)) activateTab(t, false);
  });
}

/* ------------------------------------------------- cross-tab prefill --- */

/**
 * Carry values into the flagship comparison so users never retype.
 * Keys: price, vehicleType, state, term (1-5), salary, km, loanRate,
 * leaseRate, loanBalloon (% of price).
 */
function prefillCompare(vals) {
  if (vals.vehicleType) {
    const btn = document.querySelector(`#vehicleType button[data-value="${vals.vehicleType}"]`);
    if (btn) btn.click();
  }
  const map = {
    price: 'price', term: 'term', salary: 'salary', km: 'km',
    loanRate: 'loanRate', leaseRate: 'leaseRate', loanBalloon: 'loanBalloon',
  };
  for (const [k, id] of Object.entries(map)) {
    if (vals[k] != null) $(id).value = vals[k];
  }
  if (vals.state != null) {
    $('state').value = vals.state;
    $('state').dispatchEvent(new Event('change', { bubbles: true })); // re-seeds rego too
  }
  $('inputs').dispatchEvent(new Event('input', { bubbles: true }));
  activateTab('compare');
  $('calculator').scrollIntoView({ block: 'start' });
  if (window.gtag) window.gtag('event', 'prefill_compare', { from: vals.from || 'unknown' });
}

/** A "take these numbers to the comparison" button; returns its HTML. */
const compareBtn = (label) => `<button type="button" class="prefill-btn">${label} →</button>`;

/* Registry consumed by the delegated click handler in initTabs — the button
   nodes themselves are ephemeral (re-created on every render). */
const PREFILL_SOURCES = {};
function wirePrefill(containerId, valsFn) {
  PREFILL_SOURCES[containerId] = valsFn;
}

/* --------------------------------------------------------------- loan --- */

function renderLoan() {
  const perYear = parseInt($('ln-freq').value, 10);
  const amount = num('ln-amount', 40000);
  const years = num('ln-years', 5);
  const appFee = num('ln-appfee', 0);
  const monthFee = num('ln-monthfee', 0);
  const periodFee = (monthFee * 12) / perYear;
  const s = loanSummary({
    amount,
    annualRate: num('ln-rate', 7.5) / 100,
    years,
    balloonPct: num('ln-balloon', 0) / 100,
    perYear,
    appFee,
    periodFee,
  });
  const freqWord = { 12: 'month', 26: 'fortnight', 52: 'week' }[perYear];

  const principal = amount + appFee - s.balloon;
  const composition = stackedBar([
    { label: 'Principal repaid', value: principal, color: cssVar('--series-outright') },
    { label: 'Interest', value: s.interest, color: cssVar('--series-lease') },
    { label: 'Fees', value: monthFee * 12 * years, color: cssVar('--baseline') },
    { label: 'Balloon at end', value: s.balloon, color: cssVar('--series-loan') },
  ]);

  const balanceChart = miniLine(
    [{ label: 'Owing', color: cssVar('--series-outright'), points: s.balances }],
    { xLabel: (i) => (i === 0 ? 'Start' : `Yr ${i}`) },
  );

  $('ln-results').innerHTML = `
    <div class="stat-grid">
      ${stat(`Repayment per ${freqWord}`, money2(s.repayment + periodFee), true)}
      ${stat('Total interest', money(s.interest))}
      ${stat('Total fees', money(s.fees))}
      ${stat(`Total repaid over ${years} yrs`, money(s.totalCost))}
      ${stat('Cost per $1 borrowed', `$${((s.totalCost) / (amount || 1)).toFixed(2)}`)}
      ${s.balloon > 0 ? stat('Balloon due at end', money(s.balloon)) : ''}
    </div>
    ${chartTitle('Where the money goes')}
    ${composition}
    ${chartTitle('Balance over time')}
    ${balanceChart}
    ${compareBtn('Compare this loan with cash & novated lease')}
    <p class="result-note">Assumes the application fee is financed and repayments stay fixed.
      The comparison uses a 5-year maximum term.</p>`;
  wirePrefill('ln-results', () => ({
    from: 'loan',
    price: amount,
    term: Math.min(5, Math.max(1, Math.round(years))),
    loanRate: num('ln-rate', 7.5),
    loanBalloon: num('ln-balloon', 0),
  }));
}

/* ------------------------------------------------------------ novated --- */

function renderNovated() {
  const type = $('nv-type').value;
  const d = AU_DATA.defaults.byVehicleType[type];
  const price = num('nv-price', 50000);
  const term = parseInt($('nv-term').value, 10);
  const inputs = {
    price,
    vehicleType: type,
    state: $('nv-state').value,
    termYears: term,
    salary: num('nv-salary', 100000),
    kmPerYear: num('nv-km', 13000),
    sellAtEnd: false,
    includeOpportunityCost: false,
    investRate: 0,
    leaseRate: AU_DATA.lease.defaultRate,
    insurancePerYear: AU_DATA.defaults.insurancePerYear,
    servicePerYear: d.servicePerYear,
    tyresPerYear: AU_DATA.defaults.tyresPerYear,
    fuelPerLitre: type === 'ev' ? 0 : d.energyPrice,
    fuelLPer100km: type === 'ev' ? 0 : d.consumption,
    electricityPerKwh: type === 'ev' ? d.energyPrice : 0,
    evKwhPer100km: type === 'ev' ? d.consumption : 0,
    resaleOverride: null,
  };
  const r = novatedLease(inputs);

  const runningMonthly = r.packageMonthly - r.financePayment
    - (AU_DATA.lease.adminFeePerMonth) - (r.postTaxAnnual / 11 / 12);
  const composition = stackedBar([
    { label: 'Finance', value: r.financePayment, color: cssVar('--series-lease') },
    { label: 'Running costs', value: runningMonthly, color: cssVar('--series-outright') },
    { label: 'Admin', value: AU_DATA.lease.adminFeePerMonth, color: cssVar('--baseline') },
    { label: 'GST on ECM', value: r.postTaxAnnual / 11 / 12, color: cssVar('--series-loan') },
  ], { fmt: (v) => `${money(v)}/mo` });

  const splitBars = miniBars([
    { label: 'Pre-tax', value: r.preTaxAnnual / 12, valueText: `${money(r.preTaxAnnual / 12)}/mo` },
    { label: 'Post-tax (ECM)', value: r.postTaxAnnual / 12, valueText: `${money(r.postTaxAnnual / 12)}/mo`, color: cssVar('--series-lease') },
    { label: 'Tax saved', value: r.annualTaxSaved / 12, valueText: `−${money(r.annualTaxSaved / 12)}/mo`, color: cssVar('--series-loan') },
  ]);

  $('nv-results').innerHTML = `
    <div class="stat-grid">
      ${stat('Salary deduction', `${money(r.packageMonthly)}<small>/month</small>`, true)}
      ${stat('True cost after tax saving', `${money(r.monthlyOutgoing)}<small>/month</small>`)}
      ${stat('Income tax saved', `${money(r.annualTaxSaved)}<small>/year</small>`)}
      ${stat(`Residual after ${term} yrs (incl. GST)`, money(r.residualWithGst))}
      ${r.impliedRate != null ? stat('Effective rate after tax', `${(r.impliedRate * 100).toFixed(1)}%<small> p.a.</small>`) : ''}
      ${stat('FBT status', r.fbtExempt ? 'Exempt EV ✓' : 'Offset via ECM')}
    </div>
    ${chartTitle('What each month’s package is made of')}
    ${composition}
    ${chartTitle('Pre-tax vs post-tax, and what the tax office gives back')}
    ${splitBars}
    ${r.fbtExempt
      ? '<p class="result-note"><strong>FBT-exempt EV:</strong> the whole package is pre-tax — no post-tax contribution required.</p>'
      : ''}
    ${compareBtn('Compare this lease with cash & a car loan')}
    <p class="result-note">Fully-maintained lease with typical running costs and a
      ${(AU_DATA.lease.defaultRate * 100).toFixed(1)}% effective rate — every number is editable
      in the comparison.</p>`;
  wirePrefill('nv-results', () => ({
    from: 'novated',
    price,
    vehicleType: type,
    state: $('nv-state').value,
    term,
    salary: num('nv-salary', 100000),
    km: num('nv-km', 13000),
  }));
}

/* --------------------------------------------------------------- duty --- */

function renderDuty() {
  const price = num('sd-price', 50000);
  const type = $('sd-type').value;
  const home = $('sd-state').value;
  const duty = stampDuty(home, price, type);
  const rego = AU_DATA.states[home].regoCtpPerYear;
  const rows = Object.keys(AU_DATA.states)
    .map((code) => ({ code, duty: stampDuty(code, price, type) }))
    .sort((a, b) => a.duty - b.duty);
  const chart = miniBars(rows.map((r) => ({
    label: r.code, value: r.duty, hl: r.code === home,
  })), { labelW: 56 });

  $('sd-results').innerHTML = `
    <div class="stat-grid">
      ${stat(`Stamp duty in ${home}`, money(duty), true)}
      ${stat('Rego + CTP (first year)', money(rego))}
      ${stat('Drive-away estimate', money(price + duty + rego))}
    </div>
    ${chartTitle('The same car, stamped in every state — cheapest first')}
    ${chart}
    ${compareBtn('See the full cost of owning this car')}
    <p class="result-note">${AU_DATA.states[home].dutyNote}. Duty is charged on the dutiable value
      (price including GST and accessories); dealer delivery may add to it. Rego + CTP figures are
      typical for a standard passenger car, metro rates.</p>`;
  wirePrefill('sd-results', () => ({
    from: 'duty', price, vehicleType: type === 'petrol' ? 'petrol' : type, state: home,
  }));
}

/* --------------------------------------------------------------- fuel --- */

function renderFuel() {
  const type = $('fu-type').value;
  const km = num('fu-km', 13000);
  const cons = num('fu-cons', 7.5);
  const unit = num('fu-price', 1.8);
  const cost = energyCost({ kmPerYear: km, per100km: cons, unitPrice: unit });

  const scenarios = [
    { label: 'Petrol', per100km: type === 'petrol' ? cons : 7.5, unitPrice: type === 'petrol' ? unit : 1.8, color: cssVar('--series-lease') },
    { label: 'Diesel', per100km: type === 'diesel' ? cons : 6.5, unitPrice: type === 'diesel' ? unit : 1.8, color: cssVar('--series-outright') },
    { label: 'EV (home)', per100km: type === 'ev' ? cons : 17, unitPrice: type === 'ev' ? unit : 0.30, color: cssVar('--series-loan') },
  ];
  const chart = miniBars(scenarios.map((s) => ({
    label: s.label,
    value: energyCost({ kmPerYear: km, per100km: s.per100km, unitPrice: s.unitPrice }).perYear,
    color: s.color,
    hl: s.label.toLowerCase().startsWith(type === 'ev' ? 'ev' : type),
    valueText: `${money(energyCost({ kmPerYear: km, per100km: s.per100km, unitPrice: s.unitPrice }).perYear)}/yr`,
  })), { labelW: 88 });

  $('fu-results').innerHTML = `
    <div class="stat-grid">
      ${stat('Per year', money(cost.perYear), true)}
      ${stat('Per month', money(cost.perMonth))}
      ${stat('Per week', money2(cost.perWeek))}
      ${stat('Per km', `${(cost.perKm * 100).toFixed(1)}<small>c</small>`)}
    </div>
    ${chartTitle(`Your ${km.toLocaleString('en-AU')} km/yr, three ways to power it`)}
    ${chart}
    <p class="result-note">Petrol/diesel at typical consumption and mid-2026 prices; EV at 17 kWh/100 km
      on 30c home charging. Curious when an EV pays for itself?
      Try the <a href="#" data-goto="breakeven">break-even tab</a>.</p>`;
  wireGoto('fu-results');
}

function syncFuelLabels() {
  const ev = $('fu-type').value === 'ev';
  $('fu-cons-label').innerHTML = ev
    ? 'Consumption <span class="hint">kWh/100 km</span>' : 'Consumption <span class="hint">L/100 km</span>';
  $('fu-price-label').innerHTML = ev
    ? 'Electricity <span class="hint">$/kWh</span>' : 'Fuel price <span class="hint">$/L</span>';
  $('fu-cons').value = ev ? 17 : ($('fu-type').value === 'diesel' ? 6.5 : 7.5);
  $('fu-price').value = ev ? 0.30 : 1.80;
}

/* ------------------------------------------------------- depreciation --- */

function renderDepreciation() {
  const price = num('dp-price', 50000);
  const years = parseInt($('dp-years').value, 10);
  const custom = $('dp-mode').value === 'custom';
  $('dp-custom-wrap').style.display = custom ? '' : 'none';
  const rate = num('dp-custom', 14) / 100;
  const valueAt = (y) =>
    y === 0 ? price : custom ? price * Math.pow(1 - rate, y) : resaleValue(price, y);

  const points = [];
  for (let y = 0; y <= years; y++) points.push(valueAt(y));
  const chart = miniLine(
    [{ label: 'Value', color: cssVar('--series-outright'), points }],
    { xLabel: (i) => (i === 0 ? 'New' : `Yr ${i}`) },
  );

  const rows = [];
  for (let y = 1; y <= years; y++) {
    rows.push(`<tr${y === years ? ' class="hl"' : ''}><td>Year ${y}</td><td>${money(valueAt(y))}</td>
      <td>−${money(valueAt(y - 1) - valueAt(y))}</td></tr>`);
  }
  const end = valueAt(years);
  $('dp-results').innerHTML = `
    <div class="stat-grid">
      ${stat(`Value after ${years} year${years > 1 ? 's' : ''}`, money(end), true)}
      ${stat('Total depreciation', money(price - end))}
      ${stat('Average per year', money((price - end) / years))}
      ${stat('Retained', `${Math.round((end / price) * 100)}<small>%</small>`)}
    </div>
    ${chartTitle('Estimated value over time')}
    ${chart}
    <table class="mini">
      <thead><tr><th>Year</th><th>Estimated value</th><th>Loss that year</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table>
    ${compareBtn('See what this car costs to own, all-in')}
    <p class="result-note">Depreciation is usually a car's single biggest cost — bigger than fuel or
      insurance. It's counted automatically in the full comparison.</p>`;
  wirePrefill('dp-results', () => ({
    from: 'depreciation', price, term: Math.min(5, years),
  }));
}

/* ------------------------------------------------------------ economy --- */

function renderEconomy() {
  const r = fuelEconomy({ km: num('fe-km', 0), litres: num('fe-litres', 0) });
  if (!r) { $('fe-results').innerHTML = '<p class="result-note">Enter a distance and litres used.</p>'; return; }
  const price = num('fe-price', 0);
  const chart = miniBars([
    { label: 'Hybrid', value: 4.5, valueText: '4.5' },
    { label: 'Small petrol', value: 6.5, valueText: '6.5' },
    { label: 'Your car', value: r.lPer100km, valueText: r.lPer100km.toFixed(1), hl: true },
    { label: 'Typical SUV', value: 9.0, valueText: '9.0' },
    { label: 'Large 4WD', value: 11.5, valueText: '11.5' },
  ].sort((a, b) => a.value - b.value), { labelW: 104, fmt: (v) => v.toFixed(1) });

  $('fe-results').innerHTML = `
    <div class="stat-grid">
      ${stat('Consumption', `${r.lPer100km.toFixed(1)}<small> L/100 km</small>`, true)}
      ${stat('Distance per litre', `${r.kmPerL.toFixed(1)}<small> km/L</small>`)}
      ${stat('MPG (US)', r.mpgUS.toFixed(1))}
      ${stat('MPG (imperial)', r.mpgImp.toFixed(1))}
      ${price > 0 ? stat('Fuel cost', `${money2(r.lPer100km * price)}<small> /100 km</small>`) : ''}
    </div>
    ${chartTitle('Where you sit (L/100 km — shorter is thriftier)')}
    ${chart}
    <p class="result-note">Real-world figures usually run 10-20% above the windscreen-sticker
      number, so don't be alarmed if yours does too.</p>`;
}

/* ---------------------------------------------------------- emissions --- */

function renderEmissions() {
  const type = $('em-type').value;
  const km = num('em-km', 13000);
  const cons = num('em-cons', 7.5);
  const kg = emissionsPerYear({ fuelType: type, per100km: cons, kmPerYear: km });
  const trees = Math.round(kg / AU_DATA.emissions.treeKgPerYear);

  const scenarios = [
    { label: 'EV (grid)', fuelType: 'ev', per100km: type === 'ev' ? cons : 17 },
    { label: 'Hybrid', fuelType: 'hybrid', per100km: type === 'hybrid' ? cons : 4.5 },
    { label: 'Diesel', fuelType: 'diesel', per100km: type === 'diesel' ? cons : 6.5 },
    { label: 'Petrol', fuelType: 'petrol', per100km: type === 'petrol' ? cons : 7.5 },
  ];
  const chart = miniBars(scenarios.map((s) => {
    const t = emissionsPerYear({ fuelType: s.fuelType, per100km: s.per100km, kmPerYear: km }) / 1000;
    return {
      label: s.label, value: t, hl: s.fuelType === type,
      valueText: `${t.toFixed(2)} t/yr`,
    };
  }), { labelW: 86 });

  $('em-results').innerHTML = `
    <div class="stat-grid">
      ${stat('CO₂-e per year', `${(kg / 1000).toFixed(2)}<small> tonnes</small>`, true)}
      ${stat('Per km', `${(kg / km * 1000).toFixed(0)}<small> g</small>`)}
      ${stat('Trees to absorb it', `≈ ${trees}`)}
    </div>
    ${chartTitle(`Same ${km.toLocaleString('en-AU')} km/yr, four drivetrains`)}
    ${chart}
    <p class="result-note">${type === 'ev'
      ? 'Grid-average charging (~0.60 kg/kWh nationally, falling yearly). On GreenPower or home solar an EV’s charging emissions approach zero.'
      : 'Factors: petrol 2.31 kg/L, diesel 2.66 kg/L, grid electricity ~0.60 kg/kWh (national average, falling each year).'}</p>`;
}

function syncEmissionsLabels() {
  const ev = $('em-type').value === 'ev';
  $('em-cons-label').innerHTML = ev
    ? 'Consumption <span class="hint">kWh/100 km</span>' : 'Consumption <span class="hint">L/100 km</span>';
  $('em-cons').value = ev ? 17 : ($('em-type').value === 'diesel' ? 6.5 : $('em-type').value === 'hybrid' ? 4.5 : 7.5);
}

/* ---------------------------------------------------------- breakeven --- */

function renderBreakeven() {
  const km = num('be-km', 13000);
  const aPrice = num('be-a-price', 40000);
  const bPrice = num('be-b-price', 55000);
  const aRun = energyCost({ kmPerYear: km, per100km: num('be-a-cons', 7.5), unitPrice: num('be-a-fuel', 1.8) }).perYear
    + num('be-a-service', 600);
  const bRun = energyCost({ kmPerYear: km, per100km: num('be-b-cons', 17), unitPrice: num('be-b-power', 0.3) }).perYear
    + num('be-b-service', 400);
  const annualSaving = aRun - bRun;
  const extraUpfront = bPrice - aPrice;
  const years = breakEven({ extraUpfront, annualSaving });

  const horizon = Math.max(8, years == null ? 10 : Math.min(15, Math.ceil(years) + 2));
  const petrolPts = [], evPts = [];
  for (let y = 0; y <= horizon; y++) {
    petrolPts.push(aPrice + aRun * y);
    evPts.push(bPrice + bRun * y);
  }
  const chart = miniLine([
    { label: 'Petrol car', color: cssVar('--series-lease'), points: petrolPts },
    { label: 'Electric car', color: cssVar('--series-loan'), points: evPts },
  ], { xLabel: (i) => (i === 0 ? 'Buy' : `Yr ${i}`) });

  const verdict = years == null
    ? 'The EV never breaks even on running costs alone at these numbers.'
    : years === 0
      ? 'The EV is cheaper from day one.'
      : `The lines cross at <strong>${years.toFixed(1)} years</strong> — after that the EV is money ahead.`;
  $('be-results').innerHTML = `
    <div class="stat-grid">
      ${stat('Break-even', years == null ? 'Never' : years === 0 ? 'Day one' : `${years.toFixed(1)}<small> years</small>`, true)}
      ${stat('Extra upfront for the EV', money(extraUpfront))}
      ${stat('Running-cost saving', `${money(annualSaving)}<small>/year</small>`)}
    </div>
    ${chartTitle('Purchase price + running costs, accumulating')}
    ${chart}
    <p class="result-note">${verdict}</p>
    ${compareBtn('Run the EV through the full comparison')}
    <p class="result-note">Running costs only — resale values, stamp duty differences, insurance and
      the novated-lease FBT exemption (which often dwarfs all of this) are deliberately left out here.</p>`;
  wirePrefill('be-results', () => ({
    from: 'breakeven', price: bPrice, vehicleType: 'ev', km,
  }));
}

/* ---------------------------------------------------------------- wire --- */

// [data-goto] links are handled by the delegated listener in initTabs
function wireGoto() {}

function populateStateSelect(id) {
  const sel = $(id);
  for (const [code, s] of Object.entries(AU_DATA.states)) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${code} — ${s.name}`;
    sel.appendChild(opt);
  }
  sel.value = 'NSW';
}

/* Google Analytics 4 — loads only when a measurement id is configured in
   data.js (site.gaMeasurementId), so the site ships analytics-ready but
   silent until Crown Money drops its own G-XXXX id in. */
function initAnalytics() {
  const id = AU_DATA.site.gaMeasurementId;
  if (!id) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
}

/* Lead capture → Zapier webhook, with the user's current scenario attached. */
function initLead() {
  const form = $('leadForm');
  if (!form) return;
  const status = $('leadStatus');
  const btn = $('leadSubmit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('leadCompany').value) return; // honeypot — silently drop bots
    const name = $('leadName').value.trim();
    const email = $('leadEmail').value.trim();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      status.textContent = 'Please enter your name and a valid email address.';
      status.classList.add('error');
      return;
    }
    status.classList.remove('error');
    status.textContent = 'Sending…';
    btn.disabled = true;

    const st = window.__ccState || {};
    const i = st.inputs || {};
    const typeWord = { petrol: 'petrol car', hybrid: 'hybrid', ev: 'EV' }[i.vehicleType] || 'car';
    // One email-ready block per method (pre-formatted strings, so the Zap
    // needs no Formatter steps), keyed by stable names for easy mapping.
    const methodBlock = (r) => ({
      netCostDisplay: money(r.netCost),
      perWeekDisplay: `${money(r.perWeek)}/week`,
      rateDisplay: r.fundingRate != null
        ? `${(r.fundingRate * 100).toFixed(1)}% p.a. — what your own money earns`
        : r.impliedRate != null ? `${(r.impliedRate * 100).toFixed(1)}% p.a. effective` : '—',
      isCheapest: st.cmp ? (r === st.cmp.cheapest ? 'yes' : 'no') : 'no',
    });
    let verdictLine = null;
    if (st.cmp) {
      const [best, second] = st.cmp.ranked;
      verdictLine = `${best.label} wins — ${money(best.netCost)} over ${i.termYears} year` +
        `${i.termYears > 1 ? 's' : ''}, ${money(second.netCost - best.netCost)} less than the ` +
        `next-best option (${second.label.toLowerCase()}), ` +
        (i.sellAtEnd ? 'with the car sold at the end.' : 'keeping the car at the end.');
    }
    const payload = {
      name,
      email,
      source: 'carcalculator.com.au',
      page: location.href,
      activeTab: (location.hash || '#calculator').replace('#', ''),
      submittedAt: new Date().toISOString(),
      verdictLine,
      cheapest: st.cmp ? st.cmp.cheapest.label : null,
      scenarioSummary: st.inputs
        ? `${money(i.price)} ${typeWord} in ${i.state} · ${i.termYears}-year term · ` +
          `${money(i.salary)} salary · ${i.kmPerYear.toLocaleString('en-AU')} km/yr`
        : null,
      outright: st.cmp ? methodBlock(st.cmp.results[0]) : null,
      loan: st.cmp ? methodBlock(st.cmp.results[1]) : null,
      lease: st.cmp ? methodBlock(st.cmp.results[2]) : null,
      scenario: st.inputs ? {
        vehiclePrice: i.price,
        vehicleType: i.vehicleType,
        state: i.state,
        termYears: i.termYears,
        salary: i.salary,
        kmPerYear: i.kmPerYear,
        sellAtEnd: i.sellAtEnd,
        countInvestmentReturns: i.includeOpportunityCost,
        investPreset: i.investPreset,
      } : null,
      results: st.cmp ? st.cmp.results.map((r) => ({
        method: r.label,
        netCost: Math.round(r.netCost),
        perWeek: Math.round(r.perWeek),
        effectiveRatePct: r.impliedRate != null ? +(r.impliedRate * 100).toFixed(2) : null,
      })) : null,
    };

    try {
      const res = await fetch(AU_DATA.site.leadWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      form.reset();
      status.textContent = 'Done — your results are on their way to your inbox.';
      if (window.gtag) window.gtag('event', 'generate_lead', { method: 'results_email' });
    } catch {
      // Last-resort delivery that dodges CORS issues; response is unreadable
      let delivered = false;
      try {
        delivered = navigator.sendBeacon(
          AU_DATA.site.leadWebhook,
          new Blob([JSON.stringify(payload)], { type: 'text/plain' }),
        );
      } catch { /* fall through */ }
      if (delivered) {
        form.reset();
        status.textContent = 'Done — your results are on their way to your inbox.';
        if (window.gtag) window.gtag('event', 'generate_lead', { method: 'results_email' });
      } else {
        status.textContent = 'That didn’t send — please check your connection and try again.';
        status.classList.add('error');
      }
    } finally {
      btn.disabled = false;
    }
  });
}

function initReveal() {
  const sections = document.querySelectorAll('.explainer, .faq, .ad-banner, .lead');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  sections.forEach((el) => { el.classList.add('reveal'); io.observe(el); });
  // Safety net: never leave content hidden (headless renderers, odd viewports)
  setTimeout(() => sections.forEach((el) => el.classList.add('in')), 2500);
}

const RENDERERS = [];

function init() {
  initTabs();
  initReveal();
  initAnalytics();
  initLead();
  populateStateSelect('nv-state');
  populateStateSelect('sd-state');
  const yearsSel = $('dp-years');
  for (let y = 1; y <= 10; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = `${y} year${y > 1 ? 's' : ''}`;
    if (y === 5) opt.selected = true;
    yearsSel.appendChild(opt);
  }

  const bind = (panelId, render) => {
    const panel = $(panelId);
    // 'input' fires for every control we use (number fields and selects).
    // Deliberately NOT listening to 'change': it fires on blur, which would
    // re-render the results panel mid-click when a user edits a field and
    // then clicks a button in the results — swallowing the click.
    panel.addEventListener('input', render);
    RENDERERS.push(render);
    render();
  };
  bind('tab-loan', renderLoan);
  bind('tab-novated', renderNovated);
  bind('tab-duty', renderDuty);
  $('fu-type').addEventListener('change', syncFuelLabels);
  bind('tab-fuel', renderFuel);
  bind('tab-depreciation', renderDepreciation);
  bind('tab-economy', renderEconomy);
  $('em-type').addEventListener('change', syncEmissionsLabels);
  bind('tab-emissions', renderEmissions);
  bind('tab-breakeven', renderBreakeven);

  // Charts bake theme colors in as hex — re-render when the theme flips
  const rerenderAll = () => RENDERERS.forEach((r) => r());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rerenderAll);
  new MutationObserver(rerenderAll).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });
}

init();
