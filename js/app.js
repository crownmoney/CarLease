/* UI layer: reads inputs, runs the engine, renders verdict, cards, charts,
   breakdown table and methodology notes. No calculation logic lives here. */

import { AU_DATA } from './data.js';
import { compareAll, incomeTax, stampDuty } from './calculator.js';

const $ = (id) => document.getElementById(id);

const fmt$ = new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
});
const money = (v) => fmt$.format(Math.round(v));

const METHOD_META = [
  { key: 'outright', cssVar: '--series-outright' },
  { key: 'loan', cssVar: '--series-loan' },
  { key: 'lease', cssVar: '--series-lease' },
];

const seriesColor = (i) =>
  getComputedStyle(document.documentElement).getPropertyValue(METHOD_META[i].cssVar).trim();

/* -------------------------------------------------------------- inputs --- */

let vehicleType = 'petrol';
// Track whether the user has hand-edited energy fields so type switches
// only overwrite untouched defaults.
const touched = new Set();

function populateStates() {
  const sel = $('state');
  for (const [code, s] of Object.entries(AU_DATA.states)) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${code} — ${s.name}`;
    sel.appendChild(opt);
  }
  sel.value = 'NSW';
}

function applyVehicleTypeDefaults() {
  const d = AU_DATA.defaults.byVehicleType[vehicleType];
  $('energyPriceLabel').innerHTML =
    vehicleType === 'ev'
      ? 'Electricity price <span class="hint">$/kWh</span>'
      : 'Fuel price <span class="hint">$/L</span>';
  $('consumptionLabel').innerHTML =
    vehicleType === 'ev'
      ? 'Energy use <span class="hint">kWh/100 km</span>'
      : 'Fuel consumption <span class="hint">L/100 km</span>';
  if (!touched.has('fuelPrice')) $('fuelPrice').value = d.energyPrice;
  if (!touched.has('consumption')) $('consumption').value = d.consumption;
  if (!touched.has('service')) $('service').value = d.servicePerYear;
}

function readInputs() {
  const num = (id, fallback = 0) => {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : fallback;
  };
  const resaleRaw = $('resale').value.trim();
  return {
    price: num('price', 50000),
    vehicleType,
    state: $('state').value,
    termYears: parseInt($('term').value, 10),
    salary: num('salary', 100000),
    kmPerYear: num('km', 13000),
    includeOpportunityCost: $('oppCost').checked,
    savingsRate: num('savingsRate', 4.5) / 100,
    loanRate: num('loanRate', 7.5) / 100,
    leaseRate: num('leaseRate', 9.5) / 100,
    loanDeposit: num('loanDeposit', 0),
    loanBalloonPct: num('loanBalloon', 0) / 100,
    insurancePerYear: num('insurance', 1800),
    servicePerYear: num('service', 600),
    tyresPerYear: num('tyres', 350),
    fuelPerLitre: vehicleType === 'ev' ? 0 : num('fuelPrice', 1.8),
    fuelLPer100km: vehicleType === 'ev' ? 0 : num('consumption', 7.5),
    electricityPerKwh: vehicleType === 'ev' ? num('fuelPrice', 0.3) : 0,
    evKwhPer100km: vehicleType === 'ev' ? num('consumption', 17) : 0,
    resaleOverride: resaleRaw === '' ? null : Math.max(0, parseFloat(resaleRaw) || 0),
  };
}

/* ------------------------------------------------------------- verdict --- */

function renderVerdict(cmp, inputs) {
  const [best, second] = cmp.ranked;
  const diff = second.netCost - best.netCost;
  const t = inputs.termYears;
  $('verdict').innerHTML = `
    <p class="lead-in">Cheapest way to own this car</p>
    <p class="headline">${best.label} — <span class="amount">${money(best.netCost)}</span>
      over ${t} year${t > 1 ? 's' : ''}</p>
    <p class="sub">That's ${money(diff)} less than the next-best option (${second.label.toLowerCase()}),
      or about ${money(best.netCost / (t * 12))}/month once the car is sold at the end.</p>`;
}

/* --------------------------------------------------------------- cards --- */

function renderCards(cmp, inputs) {
  const wrap = $('cards');
  wrap.innerHTML = '';
  cmp.results.forEach((r, i) => {
    const isBest = r === cmp.cheapest;
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.method = METHOD_META[i].key;
    const facts = [];
    facts.push(['Upfront cash', money(r.upfront)]);
    if (r.monthlyRepayment != null) facts.push(['Loan repayment', `${money(r.monthlyRepayment)}/mo`]);
    if (r.packageMonthly != null) {
      facts.push(['Salary deduction', `${money(r.packageMonthly)}/mo`]);
      facts.push(['…after tax saving', `${money(r.monthlyOutgoing)}/mo`]);
    } else {
      facts.push(['Ongoing outgoings', `${money(r.monthlyOutgoing)}/mo`]);
    }
    if (r.balloon > 0) facts.push(['Balloon at end', money(r.balloon)]);
    if (r.residualWithGst != null) facts.push(['Residual at end (incl. GST)', money(r.residualWithGst)]);
    facts.push(['Cost per week', money(r.perWeek)]);

    card.innerHTML = `
      <h3 class="name">${r.label}
        ${isBest ? '<span class="cheapest-chip">✓ Cheapest</span>' : ''}</h3>
      <p class="net">${money(r.netCost)}</p>
      <p class="net-label">net cost over ${inputs.termYears} yrs (after resale)</p>
      <dl>${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    wrap.appendChild(card);
  });
}

/* ----------------------------------------------------------- bar chart --- */

function renderBarChart(cmp, inputs) {
  $('barChartSub').textContent =
    `Total cost over ${inputs.termYears} years after selling the car — lower is better.`;
  const W = 720, ROW = 44, PADL = 118, PADR = 96;
  const H = ROW * 3 + 8;
  const max = Math.max(...cmp.results.map((r) => r.netCost), 1);
  const x = (v) => PADL + (Math.max(0, v) / max) * (W - PADL - PADR);

  let bars = '';
  cmp.results.forEach((r, i) => {
    const y = 8 + i * ROW;
    const bh = 22;
    const w = Math.max(2, x(r.netCost) - PADL);
    const c = seriesColor(i);
    // 4px rounded data-end, square at the baseline
    bars += `
      <g class="bar-g" data-i="${i}" tabindex="0" role="img"
         aria-label="${r.label}: ${money(r.netCost)} net cost">
        <rect x="${PADL}" y="${y}" width="${w}" height="${bh}" fill="${c}"
              rx="4" ry="4" />
        <rect x="${PADL}" y="${y}" width="${Math.min(6, w / 2)}" height="${bh}" fill="${c}" />
        <text x="${PADL - 10}" y="${y + bh / 2 + 4}" text-anchor="end"
              font-size="13" font-weight="600" fill="var(--text-secondary)">${r.label}</text>
        <text x="${PADL + w + 8}" y="${y + bh / 2 + 4}" font-size="13" font-weight="700"
              fill="var(--text-primary)" font-variant="tabular-nums">${money(r.netCost)}</text>
        <rect x="0" y="${y - 4}" width="${W}" height="${bh + 8}" fill="transparent" class="bar-hit" />
      </g>`;
  });

  $('barChart').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Net cost comparison bar chart">
      <line x1="${PADL}" y1="4" x2="${PADL}" y2="${H - 4}" stroke="var(--baseline)" stroke-width="1" />
      ${bars}
    </svg>`;

  // Per-mark hover tooltip
  $('barChart').querySelectorAll('.bar-g').forEach((g) => {
    const r = cmp.results[+g.dataset.i];
    const c = seriesColor(+g.dataset.i);
    bindTooltip(g, () => `
      <div class="tt-title">${r.label}</div>
      <div class="tt-row"><span class="k"><span class="swatch" style="background:${c}"></span>Net cost</span>
        <span class="v">${money(r.netCost)}</span></div>
      <div class="tt-row"><span class="k">Total outgoings</span><span class="v">${money(r.totalOutgoings)}</span></div>
      <div class="tt-row"><span class="k">Resale recovered</span><span class="v">−${money(r.resale)}</span></div>
      <div class="tt-row"><span class="k">Per week</span><span class="v">${money(r.perWeek)}</span></div>`);
  });
}

/* ---------------------------------------------------------- line chart --- */

function renderLineChart(cmp, inputs) {
  const t = inputs.termYears;
  // Series: year 0 (drive-away outlay) through year t (residual paid, car sold)
  const shortNames = ['Outright', 'Loan', 'Lease'];
  const series = cmp.results.map((r, i) => ({
    label: r.label,
    short: shortNames[i],
    color: seriesColor(i),
    points: [i === 2 ? 0 : r.upfront, ...r.timeline],
  }));

  const W = 720, H = 300, PADL = 64, PADR = 148, PADT = 14, PADB = 32;
  const allVals = series.flatMap((s) => s.points);
  const maxV = Math.max(...allVals, 1);
  const minV = Math.min(...allVals, 0);
  const niceStep = niceTick((maxV - minV) / 4);
  const yMax = Math.ceil(maxV / niceStep) * niceStep;
  const yMin = Math.min(0, Math.floor(minV / niceStep) * niceStep);

  const x = (yr) => PADL + (yr / t) * (W - PADL - PADR);
  const y = (v) => PADT + (1 - (v - yMin) / (yMax - yMin)) * (H - PADT - PADB);

  let grid = '';
  for (let v = yMin; v <= yMax + 1; v += niceStep) {
    grid += `<line x1="${PADL}" y1="${y(v)}" x2="${W - PADR}" y2="${y(v)}"
               stroke="var(--grid)" stroke-width="1" />
             <text x="${PADL - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11"
               fill="var(--text-muted)" font-variant="tabular-nums">${compact(v)}</text>`;
  }
  let xticks = '';
  for (let yr = 0; yr <= t; yr++) {
    xticks += `<text x="${x(yr)}" y="${H - 10}" text-anchor="middle" font-size="11"
                fill="var(--text-muted)">${yr === 0 ? 'Start' : `Yr ${yr}`}</text>`;
  }

  let paths = '';
  series.forEach((s) => {
    const d = s.points.map((v, yr) => `${yr ? 'L' : 'M'}${x(yr)},${y(v)}`).join(' ');
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round" />`;
  });

  // End dots (surface ring) + collision-resolved direct end labels
  const ends = series
    .map((s, i) => ({ i, s, yPos: y(s.points[t]) }))
    .sort((a, b) => a.yPos - b.yPos);
  for (let k = 1; k < ends.length; k++) {
    if (ends[k].yPos - ends[k - 1].yPos < 15) ends[k].yPos = ends[k - 1].yPos + 15;
  }
  let endMarks = '';
  ends.forEach(({ s, yPos }) => {
    const cy = y(s.points[t]);
    endMarks += `
      <circle cx="${x(t)}" cy="${cy}" r="4" fill="${s.color}"
              stroke="var(--surface-1)" stroke-width="2" />
      ${Math.abs(yPos - cy) > 7
        ? `<line x1="${x(t) + 6}" y1="${cy}" x2="${x(t) + 16}" y2="${yPos}"
             stroke="var(--baseline)" stroke-width="1" />` : ''}
      <text x="${x(t) + 19}" y="${yPos + 4}" font-size="12" fill="var(--text-primary)">
        <tspan font-weight="700" font-variant="tabular-nums">${money(s.points[t])}</tspan>
        <tspan fill="var(--text-secondary)" font-size="11"> ${s.short}</tspan>
      </text>`;
  });

  $('lineLegend').innerHTML = series
    .map((s) => `<span class="key"><span class="swatch" style="background:${s.color}"></span>${s.label}</span>`)
    .join('');

  $('lineChart').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="group"
         aria-label="Cumulative cost over the term, all three methods">
      ${grid}
      <line x1="${PADL}" y1="${y(Math.max(0, yMin))}" x2="${W - PADR}" y2="${y(Math.max(0, yMin))}"
            stroke="var(--baseline)" stroke-width="1" />
      ${xticks}
      ${paths}
      ${endMarks}
      <line id="crosshair" y1="${PADT}" y2="${H - PADB}" stroke="var(--baseline)"
            stroke-width="1" style="display:none" />
      <rect id="lineHit" x="${PADL}" y="${PADT}" width="${W - PADL - PADR}"
            height="${H - PADT - PADB}" fill="transparent" />
    </svg>`;

  // Crosshair + shared tooltip, snapped to nearest year
  const svg = $('lineChart').querySelector('svg');
  const hit = svg.querySelector('#lineHit');
  const cross = svg.querySelector('#crosshair');
  const onMove = (ev) => {
    const pt = svgPoint(svg, ev);
    const yr = Math.max(0, Math.min(t, Math.round(((pt.x - PADL) / (W - PADL - PADR)) * t)));
    cross.setAttribute('x1', x(yr));
    cross.setAttribute('x2', x(yr));
    cross.style.display = '';
    showTooltip(ev, `
      <div class="tt-title">${yr === 0 ? 'At purchase' : `End of year ${yr}`}</div>
      ${series.map((s) => `
        <div class="tt-row"><span class="k"><span class="swatch" style="background:${s.color}"></span>${s.label}</span>
          <span class="v">${money(s.points[yr])}</span></div>`).join('')}`);
  };
  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerleave', () => { cross.style.display = 'none'; hideTooltip(); });
}

function niceTick(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}
function compact(v) {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}
function svgPoint(svg, ev) {
  const p = svg.createSVGPoint();
  p.x = ev.clientX; p.y = ev.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}

/* -------------------------------------------------------------- tooltip --- */

const tooltipEl = () => $('tooltip');
function showTooltip(ev, html) {
  const tt = tooltipEl();
  tt.innerHTML = html;
  tt.style.display = 'block';
  const pad = 14;
  const r = tt.getBoundingClientRect();
  let left = ev.clientX + pad;
  let top = ev.clientY + pad;
  if (left + r.width > window.innerWidth - 8) left = ev.clientX - r.width - pad;
  if (top + r.height > window.innerHeight - 8) top = ev.clientY - r.height - pad;
  tt.style.left = `${left}px`;
  tt.style.top = `${top}px`;
}
function hideTooltip() { tooltipEl().style.display = 'none'; }
function bindTooltip(el, htmlFn) {
  el.addEventListener('pointermove', (ev) => showTooltip(ev, htmlFn()));
  el.addEventListener('pointerleave', hideTooltip);
}

/* ------------------------------------------------------ breakdown table --- */

function renderBreakdown(cmp) {
  // Union of row labels across methods, preserving first-seen order
  const order = [];
  const infoLabels = new Set();
  const byMethod = cmp.results.map((r) => {
    const map = new Map();
    for (const row of r.rows) {
      map.set(row.label, row);
      if (!order.includes(row.label)) order.push(row.label);
      if (row.info) infoLabels.add(row.label);
    }
    return map;
  });

  const head = `<thead><tr><th>Item</th>${cmp.results
    .map((r, i) => `<th><span class="dot" style="background:${seriesColor(i)}"></span>${r.label}</th>`)
    .join('')}</tr></thead>`;

  const body = order.map((label) => {
    const cells = byMethod.map((m) => {
      const row = m.get(label);
      if (!row) return '<td class="na">—</td>';
      const cls = row.amount < 0 ? ' class="credit"' : '';
      const note = row.note ? ` title="${row.note}"` : '';
      return `<td${cls}${note}>${row.amount < 0 ? '−' + money(-row.amount) : money(row.amount)}</td>`;
    });
    return `<tr><td>${label}${infoLabels.has(label) ? ' †' : ''}</td>${cells.join('')}</tr>`;
  }).join('');

  const footnote = infoLabels.size
    ? `<tr><td colspan="4" style="font-size:12px;color:var(--text-muted);border:none">
         † shown for information — this saving is already built into the rows above, so it isn't added again.</td></tr>`
    : '';
  const foot = `<tfoot><tr><td>Net cost of ownership</td>${cmp.results
    .map((r) => `<td>${money(r.netCost)}</td>`).join('')}</tr>${footnote}</tfoot>`;

  $('breakdown').innerHTML = head + `<tbody>${body}</tbody>` + foot;
}

/* ---------------------------------------------------------------- notes --- */

function renderNotes(cmp, inputs) {
  const d = AU_DATA;
  const lease = cmp.results[2];
  const marginal = marginalRate(inputs.salary);
  const s = d.states[inputs.state];
  const duty = stampDuty(inputs.state, inputs.price, inputs.vehicleType);

  const evNote = inputs.vehicleType === 'ev'
    ? (lease.fbtExempt
      ? `<div class="callout"><strong>EV FBT exemption applies.</strong> This car is under the
         ${money(d.fbt.evExemptionPriceCap)} luxury car tax fuel-efficient threshold, so the novated lease
         is fully FBT-exempt — the whole package comes out of pre-tax salary, which is why leasing looks so
         strong here. The benefit is still “reportable” (RFBA), which can affect Medicare levy surcharge,
         HELP repayments and family assistance, but not your income tax.</div>`
      : `<div class="callout"><strong>No EV FBT exemption:</strong> this EV is over the
         ${money(d.fbt.evExemptionPriceCap)} threshold (LCT fuel-efficient limit at first sale), so normal
         FBT rules apply and part of the package must be paid post-tax.</div>`)
    : `<div class="callout"><strong>FBT on this lease</strong> is offset using the Employee Contribution
       Method: ${money(lease.postTaxAnnual)}/yr (20% of the car's base value) is deducted post-tax, which
       reduces the FBT taxable value to nil; the rest of the package is pre-tax. Battery EVs under
       ${money(d.fbt.evExemptionPriceCap)} skip this entirely — try the EV option to see the difference.</div>`;

  $('notes').innerHTML = `
    ${evNote}
    <h3>The three methods, like for like</h3>
    <ul>
      <li><strong>Buy outright</strong> — pay ${money(inputs.price + duty)} up front (price + ${money(duty)}
        ${inputs.state} stamp duty)${inputs.includeOpportunityCost
          ? `, plus the interest that cash stops earning (${(inputs.savingsRate * 100).toFixed(1)}% p.a.)`
          : ''}. You own the car from day one.</li>
      <li><strong>Car loan</strong> — secured new-car loan at ${(inputs.loanRate * 100).toFixed(2)}% p.a.
        (comparison-rate territory for a good-credit borrower in mid-2026), on-road costs financed,
        ${money(d.loan.applicationFee)} application fee and ${money(d.loan.monthlyFee)}/month account fee.</li>
      <li><strong>Novated lease</strong> — fully-maintained lease salary-packaged through your employer at an
        effective ${(inputs.leaseRate * 100).toFixed(2)}% p.a. The financier claims the GST on the car
        (capped at ${money(d.gst.maxCarCredit)}), running costs are packaged ex-GST, and pre-tax deductions
        save tax at your marginal rate (${(marginal * 100).toFixed(0)}% + 2% Medicare at a
        ${money(inputs.salary)} salary). At the end you pay the ATO-minimum residual
        (${(d.lease.residuals[inputs.termYears] * 100).toFixed(2)}% of the financed amount) <em>plus 10% GST</em>
        to own the car.</li>
    </ul>
    <p>All three end the same way — you own the car and we credit the same estimated resale value
      (${money(cmp.results[0].resale)}) — so the difference is purely what each path costs you.</p>

    <h3>Key assumptions</h3>
    <ul>
      <li>FY 2026-27 resident tax rates (0% · 15% · 30% · 37% · 45%) + 2% Medicare levy and the low-income
        tax offset. HELP debts, the Medicare levy surcharge and super are not modelled.</li>
      <li>FBT year ending 31 March 2027: 47% FBT rate, 20% statutory formula, base value = GST-inclusive
        price excluding stamp duty and rego.</li>
      <li>${inputs.state} stamp duty: ${s.dutyNote}. Registration + CTP ≈ ${money(s.regoCtpPerYear)}/yr.</li>
      <li>Depreciation: the car retains about
        ${(d.depreciation.retainedByYear[inputs.termYears] * 100).toFixed(0)}% of its price after
        ${inputs.termYears} year${inputs.termYears > 1 ? 's' : ''} (industry average — set your own resale
        value under Advanced if you know your model holds value differently).</li>
      <li>Novated admin fee ${money(d.lease.adminFeePerMonth)}/month and ${money(d.lease.establishmentFee)}
        establishment (typical of major providers; quotes vary widely — always compare a real quote).</li>
      <li>Interest paid, fees, and FBT are personal costs — none of the three methods is tax-deductible for
        a purely private-use car outside salary packaging.</li>
      ${inputs.includeOpportunityCost ? `<li>Forgone interest is counted on the upfront lump sum only —
        monthly repayments and salary deductions aren't separately discounted. Untick the option to compare
        pure cash totals.</li>` : ''}
    </ul>

    <h3>Sources</h3>
    <ul class="sources">
      ${d.sources.map((src) => `<li><a href="${src.url}" target="_blank" rel="noopener">${src.label}</a></li>`).join('')}
    </ul>`;
}

function marginalRate(salary) {
  const b = [...AU_DATA.tax.brackets].reverse().find((br) => salary > br.min);
  return b ? b.rate : 0;
}

/* ---------------------------------------------------------------- wire --- */

function update() {
  const inputs = readInputs();
  const cmp = compareAll(inputs);
  renderVerdict(cmp, inputs);
  renderCards(cmp, inputs);
  renderBarChart(cmp, inputs);
  renderLineChart(cmp, inputs);
  renderBreakdown(cmp);
  renderNotes(cmp, inputs);
}

function init() {
  populateStates();
  applyVehicleTypeDefaults();

  $('vehicleType').querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('vehicleType').querySelectorAll('button')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      vehicleType = btn.dataset.value;
      applyVehicleTypeDefaults();
      update();
    });
  });

  ['fuelPrice', 'consumption', 'service'].forEach((id) =>
    $(id).addEventListener('input', () => touched.add(id)));

  $('inputs').addEventListener('input', update);
  $('inputs').addEventListener('change', update);
  // Re-render on theme change — the SVG charts bake series colors in as hex
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', update);
  new MutationObserver(update).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });

  update();
}

init();
