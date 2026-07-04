/* Mini-calculator tabs: tab switching + the eight standalone tools.
   The flagship comparison tab is wired by app.js; this module only touches
   its own panels. All maths comes from calculator.js / data.js. */

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

const stat = (label, value, hero = false) =>
  `<div class="stat${hero ? ' hero-stat' : ''}"><p class="stat-label">${label}</p>
     <p class="stat-value">${value}</p></div>`;

/* ------------------------------------------------------------- tabs --- */

const TAB_IDS = ['compare', 'loan', 'novated', 'duty', 'fuel', 'depreciation', 'economy', 'emissions', 'breakeven'];

function activateTab(name, updateHash = true) {
  if (!TAB_IDS.includes(name)) return;
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  });
  TAB_IDS.forEach((t) => { $(`tab-${t}`).hidden = t !== name; });
  if (updateHash) history.replaceState(null, '', name === 'compare' ? '#calculator' : `#${name}`);
}

function initTabs() {
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => {
    b.addEventListener('click', () => activateTab(b.dataset.tab));
  });
  document.querySelectorAll('[data-goto]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); activateTab(a.dataset.goto); });
  });
  const h = location.hash.replace('#', '');
  if (TAB_IDS.includes(h)) activateTab(h, false);
  window.addEventListener('hashchange', () => {
    const t = location.hash.replace('#', '');
    if (TAB_IDS.includes(t)) activateTab(t, false);
  });
}

/* --------------------------------------------------------------- loan --- */

function renderLoan() {
  const perYear = parseInt($('ln-freq').value, 10);
  const s = loanSummary({
    amount: num('ln-amount', 40000),
    annualRate: num('ln-rate', 7.5) / 100,
    years: num('ln-years', 5),
    balloonPct: num('ln-balloon', 0) / 100,
    perYear,
    appFee: num('ln-appfee', 0),
    periodFee: (num('ln-monthfee', 0) * 12) / perYear,
  });
  const freqWord = { 12: 'month', 26: 'fortnight', 52: 'week' }[perYear];
  const years = num('ln-years', 5);
  const periodFee = (num('ln-monthfee', 0) * 12) / perYear;
  const rows = s.balances.map((b, y) =>
    y === 0 ? '' : `<tr><td>After year ${y}</td><td>${money(b)}</td></tr>`).join('');
  $('ln-results').innerHTML = `
    <div class="stat-grid">
      ${stat(`Repayment per ${freqWord}`, money2(s.repayment + periodFee), true)}
      ${stat('Total interest', money(s.interest))}
      ${stat('Total fees', money(s.fees))}
      ${stat(`Total repaid over ${years} yrs`, money(s.totalCost))}
      ${s.balloon > 0 ? stat('Balloon due at end', money(s.balloon)) : ''}
    </div>
    <table class="mini"><thead><tr><th>Balance</th><th>Owing</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <p class="result-note">Assumes the application fee is financed and repayments stay fixed.
      Deciding between loan, lease and cash? The
      <a href="#" data-goto="compare">full comparison</a> weighs all three with tax included.</p>`;
  wireGoto('ln-results');
}

/* ------------------------------------------------------------ novated --- */

function renderNovated() {
  const type = $('nv-type').value;
  const d = AU_DATA.defaults.byVehicleType[type];
  const inputs = {
    price: num('nv-price', 50000),
    vehicleType: type,
    state: $('nv-state').value,
    termYears: parseInt($('nv-term').value, 10),
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
  $('nv-results').innerHTML = `
    <div class="stat-grid">
      ${stat('Salary deduction', `${money(r.packageMonthly)}<small>/month</small>`, true)}
      ${stat('True cost after tax saving', `${money(r.monthlyOutgoing)}<small>/month</small>`)}
      ${stat('Income tax saved', `${money(r.annualTaxSaved)}<small>/year</small>`)}
      ${stat('Pre-tax portion', `${money(r.preTaxAnnual / 12)}<small>/month</small>`)}
      ${stat('Post-tax (ECM)', `${money(r.postTaxAnnual / 12)}<small>/month</small>`)}
      ${stat(`Residual after ${inputs.termYears} yrs (incl. GST)`, money(r.residualWithGst))}
      ${r.impliedRate != null ? stat('Effective rate after tax', `${(r.impliedRate * 100).toFixed(1)}%<small> p.a.</small>`) : ''}
    </div>
    ${r.fbtExempt
      ? '<p class="result-note"><strong>FBT-exempt EV:</strong> the whole package is pre-tax — no post-tax contribution required.</p>'
      : ''}
    <p class="result-note">Fully-maintained lease: finance, fuel/charging, rego, insurance, servicing
      and tyres packaged, GST credited where the rules allow. Compare it against a loan or cash on the
      <a href="#" data-goto="compare">comparison tab</a>.</p>`;
  wireGoto('nv-results');
}

/* --------------------------------------------------------------- duty --- */

function renderDuty() {
  const price = num('sd-price', 50000);
  const type = $('sd-type').value;
  const home = $('sd-state').value;
  const duty = stampDuty(home, price, type);
  const rego = AU_DATA.states[home].regoCtpPerYear;
  const rows = Object.keys(AU_DATA.states).map((code) => {
    const d = stampDuty(code, price, type);
    return `<tr${code === home ? ' class="hl"' : ''}><td>${code}</td><td>${money(d)}</td>
      <td>${money(AU_DATA.states[code].regoCtpPerYear)}</td></tr>`;
  }).join('');
  $('sd-results').innerHTML = `
    <div class="stat-grid">
      ${stat(`Stamp duty in ${home}`, money(duty), true)}
      ${stat('Rego + CTP (first year)', money(rego))}
      ${stat('Drive-away estimate', money(price + duty + rego))}
    </div>
    <table class="mini">
      <thead><tr><th>Same car, every state</th><th>Stamp duty</th><th>Rego + CTP/yr</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <p class="result-note">${AU_DATA.states[home].dutyNote}. Duty is charged on the dutiable value
      (price including GST and accessories); dealer delivery may add to it. Rego + CTP figures are
      typical for a standard passenger car, metro rates.</p>`;
}

/* --------------------------------------------------------------- fuel --- */

function renderFuel() {
  const type = $('fu-type').value;
  const km = num('fu-km', 13000);
  const cost = energyCost({ kmPerYear: km, per100km: num('fu-cons', 7.5), unitPrice: num('fu-price', 1.8) });
  let evLine = '';
  if (type !== 'ev') {
    const ev = energyCost({ kmPerYear: km, per100km: 17, unitPrice: 0.30 });
    evLine = `<p class="result-note">Same distance in a typical EV (17 kWh/100 km at 30c home charging):
      <strong>${money(ev.perYear)}/yr</strong> — a saving of <strong>${money(cost.perYear - ev.perYear)}/yr</strong>.
      Curious when an EV pays for itself? Try the <a href="#" data-goto="breakeven">break-even tab</a>.</p>`;
  }
  $('fu-results').innerHTML = `
    <div class="stat-grid">
      ${stat('Per year', money(cost.perYear), true)}
      ${stat('Per month', money(cost.perMonth))}
      ${stat('Per week', money2(cost.perWeek))}
      ${stat('Per km', `${(cost.perKm * 100).toFixed(1)}<small>c</small>`)}
    </div>
    ${evLine}`;
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
  const rows = [];
  for (let y = 1; y <= years; y++) {
    const v = valueAt(y);
    rows.push(`<tr${y === years ? ' class="hl"' : ''}><td>Year ${y}</td><td>${money(v)}</td>
      <td>−${money(valueAt(y - 1) - v)}</td></tr>`);
  }
  const end = valueAt(years);
  $('dp-results').innerHTML = `
    <div class="stat-grid">
      ${stat(`Value after ${years} year${years > 1 ? 's' : ''}`, money(end), true)}
      ${stat('Total depreciation', money(price - end))}
      ${stat('Average per year', money((price - end) / years))}
    </div>
    <table class="mini">
      <thead><tr><th>Year</th><th>Estimated value</th><th>Loss that year</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table>
    <p class="result-note">Depreciation is usually a car's single biggest cost — bigger than fuel or
      insurance. It's counted automatically in the <a href="#" data-goto="compare">full comparison</a>.</p>`;
  wireGoto('dp-results');
}

/* ------------------------------------------------------------ economy --- */

function renderEconomy() {
  const r = fuelEconomy({ km: num('fe-km', 0), litres: num('fe-litres', 0) });
  if (!r) { $('fe-results').innerHTML = '<p class="result-note">Enter a distance and litres used.</p>'; return; }
  const price = num('fe-price', 0);
  $('fe-results').innerHTML = `
    <div class="stat-grid">
      ${stat('Consumption', `${r.lPer100km.toFixed(1)}<small> L/100 km</small>`, true)}
      ${stat('Distance per litre', `${r.kmPerL.toFixed(1)}<small> km/L</small>`)}
      ${stat('MPG (US)', r.mpgUS.toFixed(1))}
      ${stat('MPG (imperial)', r.mpgImp.toFixed(1))}
      ${price > 0 ? stat('Fuel cost', `${money2(r.lPer100km * price)}<small> /100 km</small>`) : ''}
    </div>
    <p class="result-note">Under ~7 L/100 km is thrifty for a petrol car; a full-size 4WD often runs
      10-12. Hybrids typically land between 4 and 5.</p>`;
}

/* ---------------------------------------------------------- emissions --- */

function renderEmissions() {
  const type = $('em-type').value;
  const km = num('em-km', 13000);
  const kg = emissionsPerYear({ fuelType: type, per100km: num('em-cons', 7.5), kmPerYear: km });
  const petrolBaseline = emissionsPerYear({ fuelType: 'petrol', per100km: 7.5, kmPerYear: km });
  const trees = Math.round(kg / AU_DATA.emissions.treeKgPerYear);
  $('em-results').innerHTML = `
    <div class="stat-grid">
      ${stat('CO₂-e per year', `${(kg / 1000).toFixed(2)}<small> tonnes</small>`, true)}
      ${stat('Per km', `${(kg / km * 1000).toFixed(0)}<small> g</small>`)}
      ${stat('Trees to absorb it', `≈ ${trees}`)}
    </div>
    <p class="result-note">${type === 'ev'
      ? 'Grid-average charging. On GreenPower or home solar an EV\'s charging emissions approach zero.'
      : `A typical petrol car doing the same distance emits ${(petrolBaseline / 1000).toFixed(2)} t/yr — ` +
        (kg < petrolBaseline ? `you're ${Math.round((1 - kg / petrolBaseline) * 100)}% below that.`
          : kg > petrolBaseline ? `you're ${Math.round((kg / petrolBaseline - 1) * 100)}% above that.` : 'right on it.')}
      Factors: petrol 2.31 kg/L, diesel 2.66 kg/L, grid electricity ~0.60 kg/kWh (national average,
      falling each year).</p>`;
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
  const a = energyCost({ kmPerYear: km, per100km: num('be-a-cons', 7.5), unitPrice: num('be-a-fuel', 1.8) });
  const b = energyCost({ kmPerYear: km, per100km: num('be-b-cons', 17), unitPrice: num('be-b-power', 0.3) });
  const annualSaving = (a.perYear + num('be-a-service', 600)) - (b.perYear + num('be-b-service', 400));
  const extraUpfront = num('be-b-price', 55000) - num('be-a-price', 40000);
  const years = breakEven({ extraUpfront, annualSaving });
  const verdict = years == null
    ? 'The EV never breaks even on running costs alone at these numbers.'
    : years === 0
      ? 'The EV is cheaper from day one.'
      : `The EV pays back its extra purchase price in <strong>${years.toFixed(1)} years</strong>.`;
  $('be-results').innerHTML = `
    <div class="stat-grid">
      ${stat('Break-even', years == null ? 'Never' : years === 0 ? 'Day one' : `${years.toFixed(1)}<small> years</small>`, true)}
      ${stat('Extra upfront for the EV', money(extraUpfront))}
      ${stat('Running-cost saving', `${money(annualSaving)}<small>/year</small>`)}
    </div>
    <p class="result-note">${verdict}</p>
    <p class="result-note">Running costs only — resale values, stamp duty differences, insurance and
      the novated-lease FBT exemption (which often dwarfs all of this) are deliberately left out here.
      For the full picture use the <a href="#" data-goto="compare">comparison tab</a> with the EV option.</p>`;
  wireGoto('be-results');
}

/* ---------------------------------------------------------------- wire --- */

function wireGoto(containerId) {
  $(containerId).querySelectorAll('[data-goto]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); activateTab(a.dataset.goto); });
  });
}

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

function initReveal() {
  const sections = document.querySelectorAll('.explainer, .faq, .ad-banner');
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

function init() {
  initTabs();
  initReveal();
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
    panel.addEventListener('input', render);
    panel.addEventListener('change', render);
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
}

init();
