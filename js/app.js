/* UI layer: reads inputs, runs the engine, renders verdict, cards, charts,
   breakdown table and methodology notes. No calculation logic lives here. */

import { AU_DATA } from './data.js';
import { compareAll, stampDuty, afterTaxReturn, marginalRateAt } from './calculator.js';

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
  // Rego & CTP is state-specific: seed it now and re-seed whenever the state
  // changes (registered before the form-level listener, so the recalculation
  // that follows sees the fresh value). Users can still edit it afterwards.
  const seedRego = () => { $('rego').value = AU_DATA.states[sel.value].regoCtpPerYear; };
  seedRego();
  sel.addEventListener('change', seedRego);
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
  const salary = num('salary', 100000);
  const investPreset = $('investPreset').value;
  const investGross = num('investRate', 4.8) / 100;
  return {
    price: num('price', 50000),
    vehicleType,
    state: $('state').value,
    termYears: parseInt($('term').value, 10),
    salary,
    kmPerYear: num('km', 13000),
    sellAtEnd: $('sellAtEnd').checked,
    includeOpportunityCost: $('oppCost').checked,
    investPreset,
    investGross,
    investRate: afterTaxReturn(investPreset, investGross, salary),
    loanRate: num('loanRate', 7.5) / 100,
    leaseRate: num('leaseRate', 9.5) / 100,
    loanDeposit: num('loanDeposit', 0),
    loanBalloonPct: num('loanBalloon', 0) / 100,
    insurancePerYear: num('insurance', 1400),
    servicePerYear: num('service', 600),
    tyresPerYear: num('tyres', 350),
    regoCtpPerYear: num('rego', 1080),
    loanAppFee: num('loanAppFee', 250),
    loanMonthlyFee: num('loanMonthlyFee', 15),
    leaseEstFee: num('leaseEstFee', 475),
    leaseAdminMonthly: num('leaseAdminFee', 30),
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
  const keepNote = inputs.sellAtEnd
    ? 'after selling the car at the end'
    : `and you still own the car, worth about ${money(best.resale)}`;
  $('verdict').innerHTML = `
    <p class="lead-in">Cheapest way to own this car</p>
    <p class="headline">${best.label} — <span class="amount">${money(best.netCost)}</span>
      over ${t} year${t > 1 ? 's' : ''}</p>
    <p class="sub">That's ${money(diff)} less than the next-best option (${second.label.toLowerCase()}),
      about ${money(best.netCost / (t * 12))}/month — ${keepNote}.
      ${inputs.includeOpportunityCost
        ? `Costs are in end-of-term dollars — money not yet spent keeps earning
           ${(inputs.investRate * 100).toFixed(1)}% p.a. after tax for every method.`
        : 'Costs are plain cash totals — investment returns on unspent money are not counted.'}</p>`;
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
    if (inputs.includeOpportunityCost) facts.push(['Forgone earnings', money(r.opportunity)]);
    if (!inputs.sellAtEnd) facts.push(['Car still worth', money(r.resale)]);
    facts.push(['Cost per week', money(r.perWeek)]);

    card.innerHTML = `
      <h3 class="name">${r.label}
        ${isBest ? '<span class="cheapest-chip">✓ Cheapest</span>' : ''}</h3>
      <p class="net">${money(r.netCost)}</p>
      <p class="net-label">${inputs.sellAtEnd
        ? `net cost over ${inputs.termYears} yrs (after selling the car)`
        : `cost over ${inputs.termYears} yrs (you keep the car)`}</p>
      <dl>${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    wrap.appendChild(card);
  });
}

/* ----------------------------------------------------------- bar chart --- */

function renderBarChart(cmp, inputs) {
  $('barChartSub').textContent = inputs.sellAtEnd
    ? `Total cost over ${inputs.termYears} years after selling the car — lower is better.`
    : `Total cost over ${inputs.termYears} years, keeping the car (worth about ` +
      `${money(cmp.results[0].resale)} at the end) — lower is better.`;
  // Compact layout on narrow screens: labels above the bars so text stays legible
  const cw = $('barChart').clientWidth || 720;
  const narrow = cw < 520;
  const W = narrow ? 400 : 720;
  const ROW = narrow ? 58 : 44;
  const PADL = narrow ? 0 : 118;
  const PADR = narrow ? 86 : 96;
  const H = ROW * 3 + 8;
  const max = Math.max(...cmp.results.map((r) => r.netCost), 1);
  const x = (v) => PADL + (Math.max(0, v) / max) * (W - PADL - PADR);

  let bars = '';
  cmp.results.forEach((r, i) => {
    const y = narrow ? 24 + i * ROW : 8 + i * ROW;
    const bh = 22;
    const w = Math.max(2, x(r.netCost) - PADL);
    const c = seriesColor(i);
    const nameLabel = narrow
      ? `<text x="0" y="${y - 7}" font-size="13" font-weight="600"
           fill="var(--text-secondary)">${r.label}</text>`
      : `<text x="${PADL - 10}" y="${y + bh / 2 + 4}" text-anchor="end"
           font-size="13" font-weight="600" fill="var(--text-secondary)">${r.label}</text>`;
    // 4px rounded data-end, square at the baseline
    bars += `
      <g class="bar-g" data-i="${i}" tabindex="0" role="img"
         aria-label="${r.label}: ${money(r.netCost)} net cost">
        <rect x="${PADL}" y="${y}" width="${w}" height="${bh}" fill="${c}"
              rx="4" ry="4" />
        <rect x="${PADL}" y="${y}" width="${Math.min(6, w / 2)}" height="${bh}" fill="${c}" />
        ${nameLabel}
        <text x="${PADL + w + 8}" y="${y + bh / 2 + 4}" font-size="13" font-weight="700"
              fill="var(--text-primary)" font-variant="tabular-nums">${money(r.netCost)}</text>
        <rect x="0" y="${y - (narrow ? 20 : 4)}" width="${W}" height="${bh + (narrow ? 24 : 8)}"
              fill="transparent" class="bar-hit" />
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
      <div class="tt-row"><span class="k">${inputs.sellAtEnd ? 'Sale recovered' : 'Car still worth'}</span>
        <span class="v">${inputs.sellAtEnd ? '−' : ''}${money(r.resale)}</span></div>
      <div class="tt-row"><span class="k">Per week</span><span class="v">${money(r.perWeek)}</span></div>`);
  });
}

/* ---------------------------------------------------------- line chart --- */

function renderLineChart(cmp, inputs) {
  const t = inputs.termYears;
  const endPhrase = inputs.sellAtEnd
    ? 'the residual/balloon paid and the car sold at the end of the final year'
    : 'the residual/balloon paid at the end of the final year (car kept)';
  $('lineChartSub').textContent = inputs.includeOpportunityCost
    ? `Money out the door plus forgone investment earnings to date, with ${endPhrase}.`
    : `Money out the door each year, with ${endPhrase}.`;
  // Series: year 0 (drive-away outlay) through year t (residual paid, car sold)
  const shortNames = ['Outright', 'Loan', 'Lease'];
  const series = cmp.results.map((r, i) => ({
    label: r.label,
    short: shortNames[i],
    color: seriesColor(i),
    points: [i === 2 ? 0 : r.upfront, ...r.timeline],
  }));

  // Compact layout on narrow screens: no end labels (legend + tooltip carry
  // identity) so the plot area stays big enough to read
  const cw = $('lineChart').clientWidth || 720;
  const narrow = cw < 520;
  const W = narrow ? 420 : 720;
  const H = narrow ? 260 : 300;
  const PADL = narrow ? 52 : 64;
  const PADR = narrow ? 14 : 148;
  const PADT = 14, PADB = 32;
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
  // (labels only in wide layout — compact relies on the legend + tooltip)
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
              stroke="var(--surface-1)" stroke-width="2" />`;
    if (!narrow) {
      endMarks += `
      ${Math.abs(yPos - cy) > 7
        ? `<line x1="${x(t) + 6}" y1="${cy}" x2="${x(t) + 16}" y2="${yPos}"
             stroke="var(--baseline)" stroke-width="1" />` : ''}
      <text x="${x(t) + 19}" y="${yPos + 4}" font-size="12" fill="var(--text-primary)">
        <tspan font-weight="700" font-variant="tabular-nums">${money(s.points[t])}</tspan>
        <tspan fill="var(--text-secondary)" font-size="11"> ${s.short}</tspan>
      </text>`;
    }
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

const GROUP_ORDER = ['Buying the car', 'Financing', 'Running costs', 'Tax & investment', 'End of term'];

function renderBreakdown(cmp, inputs) {
  // Per group, union of row labels across methods in first-seen order
  const infoLabels = new Set();
  const byMethod = cmp.results.map((r) => {
    const map = new Map();
    for (const row of r.rows) {
      map.set(row.label, row);
      if (row.info) infoLabels.add(row.label);
    }
    return map;
  });
  const labelsByGroup = new Map(GROUP_ORDER.map((g) => [g, []]));
  cmp.results.forEach((r) => r.rows.forEach((row) => {
    const arr = labelsByGroup.get(row.group);
    if (arr && !arr.includes(row.label)) arr.push(row.label);
  }));
  // Resale credit reads best as the final line before the total
  const endLabels = labelsByGroup.get('End of term');
  if (endLabels.includes('Less: resale value')) {
    endLabels.splice(endLabels.indexOf('Less: resale value'), 1);
    endLabels.push('Less: resale value');
  }

  const head = `<thead><tr><th>Item</th>${cmp.results
    .map((r, i) => `<th><span class="dot" style="background:${seriesColor(i)}"></span>${r.label}</th>`)
    .join('')}</tr></thead>`;

  const rowHtml = (label) => {
    const cells = byMethod.map((m) => {
      const row = m.get(label);
      if (!row) return '<td class="na">—</td>';
      const cls = row.amount < 0 ? ' class="credit"' : '';
      const note = row.note ? ` title="${row.note.replace(/"/g, '&quot;')}"` : '';
      return `<td${cls}${note}>${row.amount < 0 ? '−' + money(-row.amount) : money(row.amount)}</td>`;
    });
    return `<tr><td>${label}${infoLabels.has(label) ? ' †' : ''}</td>${cells.join('')}</tr>`;
  };

  const body = GROUP_ORDER.map((g) => {
    const labels = labelsByGroup.get(g);
    if (!labels.length) return '';
    return `<tr class="group-row"><td colspan="4">${g}</td></tr>` + labels.map(rowHtml).join('');
  }).join('');

  const footnote = infoLabels.size
    ? `<tr><td colspan="4" style="font-size:12px;color:var(--text-muted);border:none">
         † shown for information — this saving is already built into the rows above, so it isn't added again.
         Lease running costs are the ex-GST amounts you actually pay through the package.</td></tr>`
    : '';
  const totalLabel = inputs.sellAtEnd ? 'Net cost of ownership' : 'Total cost of ownership (car kept)';
  const foot = `<tfoot><tr><td>${totalLabel}</td>${cmp.results
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
        ${inputs.state} stamp duty). You own the car from day one.</li>
      <li><strong>Car loan</strong> — secured new-car loan at ${(inputs.loanRate * 100).toFixed(2)}% p.a.
        (comparison-rate territory for a good-credit borrower in mid-2026), on-road costs financed,
        ${money(inputs.loanAppFee)} application fee and ${money(inputs.loanMonthlyFee)}/month account fee.</li>
      <li><strong>Novated lease</strong> — fully-maintained lease salary-packaged through your employer at an
        effective ${(inputs.leaseRate * 100).toFixed(2)}% p.a. The financier claims the GST on the car
        (capped at ${money(d.gst.maxCarCredit)}), running costs are packaged ex-GST, and pre-tax deductions
        save tax at your effective marginal rate (≈${(marginal * 100).toFixed(0)}% incl. Medicare at a
        ${money(inputs.salary)} salary). At the end you pay the ATO-minimum residual
        (${(d.lease.residuals[inputs.termYears] * 100).toFixed(2)}% of the financed amount) <em>plus 10% GST</em>
        to own the car.</li>
    </ul>
    <p>All three end the same way — you own the car, worth about ${money(cmp.results[0].resale)}.
      ${inputs.sellAtEnd
        ? 'You’ve chosen to credit a sale at the end, so that value is subtracted from every method equally.'
        : 'Because you’re keeping it, that value isn’t subtracted from the cost — but it’s the same asset whichever way you paid, so the comparison stays fair.'}
      The difference between the columns is purely what each path costs you.</p>

    <h3>Key assumptions</h3>
    <ul>
      <li>FY 2026-27 resident tax rates (0% · 15% · 30% · 37% · 45%) + 2% Medicare levy and the low-income
        tax offset. HELP debts, the Medicare levy surcharge and super are not modelled.</li>
      <li>FBT year ending 31 March 2027: 47% FBT rate, 20% statutory formula, base value = GST-inclusive
        price excluding stamp duty and rego.</li>
      <li>${inputs.state} stamp duty: ${s.dutyNote}. Registration + CTP ${money(inputs.regoCtpPerYear)}/yr
        (typical for ${inputs.state} — editable under Advanced, like every other cost here).</li>
      <li>Depreciation: the car retains about
        ${(d.depreciation.retainedByYear[inputs.termYears] * 100).toFixed(0)}% of its price after
        ${inputs.termYears} year${inputs.termYears > 1 ? 's' : ''} (industry average — set your own resale
        value under Advanced if you know your model holds value differently).</li>
      <li>Novated admin fee ${money(inputs.leaseAdminMonthly)}/month and ${money(inputs.leaseEstFee)}
        establishment (typical of major providers; quotes vary widely — always compare a real quote).</li>
      <li>Interest paid, fees, and FBT are personal costs — none of the three methods is tax-deductible for
        a purely private-use car outside salary packaging.</li>
      ${inputs.includeOpportunityCost ? `<li>Investment returns: every dollar is assumed to sit in
        <em>${AU_DATA.invest.presets[inputs.investPreset].label.toLowerCase()}</em> earning
        ${(inputs.investGross * 100).toFixed(1)}% p.a. (${(inputs.investRate * 100).toFixed(1)}% after tax
        at your marginal rate) until the moment it's spent, then each outflow is valued at the end of the
        term. This treats all three methods identically — the cash buyer forfeits returns on the lump sum,
        the borrower and lessee on each payment as it leaves. Untick the option for plain cash totals.</li>` : ''}
    </ul>

    <h3>Sources</h3>
    <ul class="sources">
      ${d.sources.map((src) => `<li><a href="${src.url}" target="_blank" rel="noopener">${src.label}</a></li>`).join('')}
    </ul>`;
}

const marginalRate = (salary) => marginalRateAt(salary);

/* ---------------------------------------------------------------- wire --- */

function syncInvestUI(inputs) {
  $('investFields').style.display = $('oppCost').checked ? '' : 'none';
  const m = marginalRate(inputs.salary);
  const taxWord = { offset: 'tax-free', savings: 'interest taxed', shares: 'concessionally taxed' }[
    inputs.investPreset] ?? 'interest taxed';
  $('afterTaxNote').textContent =
    `≈ ${(inputs.investRate * 100).toFixed(1)}% after tax (${taxWord}; your marginal rate ≈ ${(m * 100).toFixed(0)}%)`;
}

function update() {
  const inputs = readInputs();
  syncInvestUI(inputs);
  const cmp = compareAll(inputs);
  renderVerdict(cmp, inputs);
  renderCards(cmp, inputs);
  renderBarChart(cmp, inputs);
  renderLineChart(cmp, inputs);
  renderBreakdown(cmp, inputs);
  renderNotes(cmp, inputs);
}

function populateInvestPresets() {
  const sel = $('investPreset');
  for (const [key, p] of Object.entries(AU_DATA.invest.presets)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
  sel.value = AU_DATA.invest.default;
  $('investRate').value = (AU_DATA.invest.presets[sel.value].rate * 100).toFixed(1);
  sel.addEventListener('change', () => {
    $('investRate').value = (AU_DATA.invest.presets[sel.value].rate * 100).toFixed(1);
  });
}

function init() {
  populateStates();
  populateInvestPresets();
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
  // Re-render on resize so the charts switch between wide/compact layouts
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(update, 150);
  });

  update();
}

init();
