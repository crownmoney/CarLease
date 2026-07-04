import test from 'node:test';
import assert from 'node:assert/strict';

import { AU_DATA } from '../js/data.js';
import {
  incomeTax, taxSaved, marginalRateAt, afterTaxReturn, stampDuty, monthlyRepayment,
  residualPct, annualRunningCosts, resaleValue, settle,
  buyOutright, carLoan, novatedLease, compareAll,
} from '../js/calculator.js';

const baseInputs = {
  price: 50000,
  vehicleType: 'petrol',
  state: 'NSW',
  termYears: 5,
  salary: 100000,
  kmPerYear: 13000,
  sellAtEnd: true,
  includeOpportunityCost: true,
  investRate: 0.033, // after-tax
  loanRate: 0.075,
  leaseRate: 0.095,
  loanDeposit: 0,
  loanBalloonPct: 0,
  insurancePerYear: 1800,
  servicePerYear: 600,
  tyresPerYear: 350,
  fuelPerLitre: 1.8,
  fuelLPer100km: 7.5,
  electricityPerKwh: 0,
  evKwhPer100km: 0,
  resaleOverride: null,
};

/* ------------------------------------------------------------------ tax --- */

test('income tax: FY2026-27 spot checks', () => {
  assert.equal(incomeTax(18000), 0);
  // $100k: 26,800×0.15 + 55,000×0.30 = 20,520 income tax + 2,000 Medicare, no LITO
  assert.ok(Math.abs(incomeTax(100000) - 22520) < 1);
  // $200k: 4,020+27,000+20,350+4,500 = 55,870 + 4,000 Medicare
  assert.ok(Math.abs(incomeTax(200000) - 59870) < 1);
});

test('income tax is monotonic and marginal rates never exceed 47%', () => {
  let prev = 0;
  for (let inc = 0; inc <= 300000; inc += 1000) {
    const t = incomeTax(inc);
    assert.ok(t >= prev - 1e-9, `tax fell at ${inc}`);
    assert.ok(t - prev <= 1000 * 0.47 + 1e-6, `marginal > 47% at ${inc}`);
    prev = t;
  }
});

test('taxSaved equals the tax difference and is positive at a normal salary', () => {
  const saved = taxSaved(100000, 10000);
  assert.ok(Math.abs(saved - (incomeTax(100000) - incomeTax(90000))) < 1e-9);
  assert.ok(Math.abs(saved - 3200) < 1); // 30% bracket + 2% Medicare
});

test('marginal rate and after-tax investment returns', () => {
  assert.ok(Math.abs(marginalRateAt(100000) - 0.32) < 0.005);
  // Offset is tax-free
  assert.ok(Math.abs(afterTaxReturn('offset', 0.067, 100000) - 0.067) < 1e-9);
  // Savings taxed at full marginal (~32%)
  assert.ok(Math.abs(afterTaxReturn('savings', 0.048, 100000) - 0.048 * 0.68) < 0.001);
  // Shares taxed at ~half marginal
  assert.ok(Math.abs(afterTaxReturn('shares', 0.075, 100000) - 0.075 * 0.84) < 0.001);
});

/* ---------------------------------------------------------------- duty --- */

test('stamp duty spot checks per published schedules', () => {
  assert.equal(stampDuty('NSW', 50000, 'petrol'), 1600); // 1350 + 250
  assert.equal(stampDuty('VIC', 50000, 'petrol'), 2100); // 4.2%
  assert.equal(stampDuty('QLD', 50000, 'ev'), 1000); // 2%
  assert.equal(stampDuty('WA', 60000, 'petrol'), 3900); // 6.5% over $50k
});

test('stamp duty is non-negative and non-decreasing in value for every state', () => {
  for (const code of Object.keys(AU_DATA.states)) {
    let prev = 0;
    for (let v = 5000; v <= 200000; v += 2500) {
      const d = stampDuty(code, v, 'petrol');
      assert.ok(d >= 0, `${code} negative at ${v}`);
      assert.ok(d >= prev - 1e-9, `${code} decreased at ${v}`);
      prev = d;
    }
  }
});

/* -------------------------------------------------------------- finance --- */

test('monthlyRepayment closed-form sanity', () => {
  assert.ok(Math.abs(monthlyRepayment(12000, 0, 12) - 1000) < 1e-9);
  assert.ok(Math.abs(monthlyRepayment(30000, 0.06, 60) - 579.98) < 0.05);
  const p = monthlyRepayment(10000, 0.12, 12, 10000); // interest-only when balloon = principal
  assert.ok(Math.abs(p - 100) < 0.01);
});

test('ATO minimum residuals', () => {
  assert.equal(residualPct(1), 0.6563);
  assert.equal(residualPct(3), 0.4688);
  assert.equal(residualPct(5), 0.2813);
});

/* --------------------------------------------------------------- settle --- */

test('settle: zero rate reduces to nominal sums', () => {
  const s = settle({ upfront: 1000, monthly: 100, terminal: 500 }, 2, 0, 300, true);
  assert.ok(Math.abs(s.totalOutgoings - (1000 + 2400 + 500)) < 1e-9);
  assert.ok(Math.abs(s.netCost - 3600) < 1e-9);
  assert.equal(s.opportunity, 0);
});

test('keeping the car: no resale credit, worth reported separately', () => {
  const sold = compareAll(baseInputs);
  const kept = compareAll({ ...baseInputs, sellAtEnd: false });
  for (let i = 0; i < 3; i++) {
    const s = sold.results[i], k = kept.results[i];
    // Difference is exactly the resale value; totals and worth unchanged
    assert.ok(Math.abs((k.netCost - s.netCost) - s.resale) < 1);
    assert.equal(k.resale, s.resale);
    assert.ok(Math.abs(k.totalOutgoings - s.totalOutgoings) < 1e-6);
    // Kept: resale appears only as an info row, so non-info rows still reconcile
    const recon = k.rows.filter((r) => !r.info).reduce((a, r) => a + r.amount, 0);
    assert.ok(Math.abs(recon - k.netCost) < 1, `${k.label}: ${recon} vs ${k.netCost}`);
    assert.ok(k.rows.some((r) => r.info && r.label.includes('Car still worth')));
    // Timeline still ends at netCost
    assert.ok(Math.abs(k.timeline[k.timeline.length - 1] - k.netCost) < 1);
  }
  // Ranking can differ but every method shifts by the same resale, so it doesn't
  assert.equal(sold.cheapest.label, kept.cheapest.label);
});

test('settle: FV compounds the upfront hardest, at the effective annual rate', () => {
  // Same nominal totals: lump sum now vs spread monthly
  const lump = settle({ upfront: 12000, monthly: 0 }, 1, 0.06, 0);
  const spread = settle({ upfront: 0, monthly: 1000 }, 1, 0.06, 0);
  assert.ok(lump.totalOutgoings > spread.totalOutgoings);
  // 6% effective annual: a lump held 12 months grows by exactly 6%
  assert.ok(Math.abs(lump.totalOutgoings - 12000 * 1.06) < 0.01);
});

test('settle: timeline ends at netCost', () => {
  const s = settle({ upfront: 5000, monthly: 200, terminal: 1000 }, 3, 0.05, 2500);
  assert.ok(Math.abs(s.timeline[2] - s.netCost) < 1e-6);
});

/* -------------------------------------------------------------- methods --- */

test('running costs: EV uses electricity, ICE uses fuel', () => {
  const ice = annualRunningCosts(baseInputs);
  assert.ok(Math.abs(ice.energy - (13000 / 100) * 7.5 * 1.8) < 1e-6);
  const ev = annualRunningCosts({
    ...baseInputs, vehicleType: 'ev', electricityPerKwh: 0.3, evKwhPer100km: 17,
  });
  assert.ok(Math.abs(ev.energy - (13000 / 100) * 17 * 0.3) < 1e-6);
  assert.ok(ev.energy < ice.energy);
});

test('each method: non-info rows sum to net cost (with and without opportunity)', () => {
  for (const oc of [true, false]) {
    const cmp = compareAll({ ...baseInputs, includeOpportunityCost: oc });
    for (const r of cmp.results) {
      const recon = r.rows.filter((row) => !row.info).reduce((a, row) => a + row.amount, 0);
      assert.ok(Math.abs(recon - r.netCost) < 1, `${r.label} oc=${oc}: rows ${recon} vs net ${r.netCost}`);
    }
  }
});

test('loan costs more than cash when opportunity cost is off', () => {
  const inputs = { ...baseInputs, includeOpportunityCost: false };
  assert.ok(carLoan(inputs).netCost > buyOutright(inputs).netCost);
});

test('opportunity cost hits the cash buyer hardest, and rises with the rate', () => {
  const cmp = compareAll(baseInputs);
  const [outright, loan, lease] = cmp.results;
  assert.ok(outright.opportunity > loan.opportunity);
  assert.ok(outright.opportunity > lease.opportunity);
  const rich = buyOutright({ ...baseInputs, investRate: 0.067 });
  assert.ok(rich.opportunity > outright.opportunity);
  assert.ok(rich.netCost > outright.netCost);
});

test('timelines end at the net cost', () => {
  for (const oc of [true, false]) {
    const cmp = compareAll({ ...baseInputs, includeOpportunityCost: oc });
    for (const r of cmp.results) {
      assert.ok(
        Math.abs(r.timeline[r.timeline.length - 1] - r.netCost) < 1,
        `${r.label} oc=${oc} timeline end ${r.timeline.at(-1)} != net ${r.netCost}`,
      );
    }
  }
});

test('eligible EV lease is FBT-exempt and fully pre-tax; expensive EV is not', () => {
  const evInputs = {
    ...baseInputs, vehicleType: 'ev',
    electricityPerKwh: 0.3, evKwhPer100km: 17, fuelPerLitre: 0, fuelLPer100km: 0,
  };
  const ev = novatedLease({ ...evInputs, price: 60000 });
  assert.equal(ev.fbtExempt, true);
  assert.equal(ev.postTaxAnnual, 0);
  const luxEv = novatedLease({ ...evInputs, price: 120000 });
  assert.equal(luxEv.fbtExempt, false);
  assert.ok(luxEv.postTaxAnnual > 0);
});

test('novated lease: higher salary saves more tax', () => {
  const low = novatedLease({ ...baseInputs, salary: 60000 });
  const high = novatedLease({ ...baseInputs, salary: 220000 });
  assert.ok(high.annualTaxSaved > low.annualTaxSaved);
  assert.ok(high.netCost < low.netCost);
});

test('ECM contribution carries GST for FBT-liable cars, not for exempt EVs', () => {
  const off = { ...baseInputs, includeOpportunityCost: false };
  const petrol = novatedLease(off);
  const row = petrol.rows.find((r) => r.label.includes('GST on employee contribution'));
  // 1/11 of the 20%-of-price annual contribution, over the term
  assert.ok(Math.abs(row.amount - (0.2 * 50000 / 11) * 5) < 1);
  assert.ok(!row.info, 'ECM GST is a real cost, not informational');
  const ev = novatedLease({
    ...off, vehicleType: 'ev', price: 60000,
    electricityPerKwh: 0.3, evKwhPer100km: 17, fuelPerLitre: 0, fuelLPer100km: 0,
  });
  assert.ok(!ev.rows.some((r) => r.label.includes('GST on employee contribution')));
});

test('GST credit on the car is capped at the car-limit credit', () => {
  assert.ok(Math.abs(novatedLease(baseInputs).gstCredit - 50000 / 11) < 1);
  assert.ok(Math.abs(novatedLease({ ...baseInputs, price: 120000 }).gstCredit - AU_DATA.gst.maxCarCredit) < 1);
});

test('user overrides for rego and fees flow through', () => {
  const off = { ...baseInputs, includeOpportunityCost: false };
  // Rego override changes running costs by exactly the delta × term
  const cheapRego = buyOutright({ ...off, regoCtpPerYear: 580 });
  const defaultRego = buyOutright(off); // falls back to NSW figure (1080)
  assert.ok(Math.abs((defaultRego.netCost - cheapRego.netCost) - 500 * 5) < 1);
  // Loan fee overrides
  const noFees = carLoan({ ...off, loanAppFee: 0, loanMonthlyFee: 0 });
  assert.ok(noFees.netCost < carLoan(off).netCost);
  assert.equal(noFees.rows.find((r) => r.label === 'Loan fees').amount, 0);
  // Lease fee overrides
  const cheapLease = novatedLease({ ...off, leaseEstFee: 0, leaseAdminMonthly: 0 });
  assert.ok(cheapLease.netCost < novatedLease(off).netCost);
  assert.equal(cheapLease.rows.find((r) => r.label === 'Admin fees').amount, 0);
});

test('resale override is respected everywhere', () => {
  const cmp = compareAll({ ...baseInputs, resaleOverride: 20000 });
  for (const r of cmp.results) assert.equal(r.resale, 20000);
});

test('depreciation curve is decreasing', () => {
  let prev = Infinity;
  for (let yTerm = 1; yTerm <= 5; yTerm++) {
    const v = resaleValue(50000, yTerm);
    assert.ok(v < prev);
    prev = v;
  }
});

test('every row carries a known group', () => {
  const groups = new Set(['Buying the car', 'Financing', 'Running costs', 'Tax & investment', 'End of term']);
  const cmp = compareAll(baseInputs);
  for (const r of cmp.results) {
    for (const row of r.rows) assert.ok(groups.has(row.group), `${r.label}: ${row.label} has group ${row.group}`);
  }
});
