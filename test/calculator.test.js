import test from 'node:test';
import assert from 'node:assert/strict';

import { AU_DATA } from '../js/data.js';
import {
  incomeTax, taxSaved, stampDuty, monthlyRepayment, residualPct,
  annualRunningCosts, resaleValue, buyOutright, carLoan, novatedLease, compareAll,
} from '../js/calculator.js';

const baseInputs = {
  price: 50000,
  vehicleType: 'petrol',
  state: 'NSW',
  termYears: 5,
  salary: 100000,
  kmPerYear: 13000,
  includeOpportunityCost: true,
  savingsRate: 0.045,
  loanRate: 0.075,
  leaseRate: 0.095,
  loanDeposit: 0,
  loanBalloonPct: 0,
  insurancePerYear: 1800,
  servicePerYear: 600,
  tyresPerYear: 350,
  fuelPerLitre: 1.95,
  fuelLPer100km: 7.5,
  electricityPerKwh: 0,
  evKwhPer100km: 0,
  resaleOverride: null,
};

/* ------------------------------------------------------------------ tax --- */

test('income tax: FY2026-27 spot checks', () => {
  // Below tax-free threshold (and below Medicare threshold)
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
  // $90k-100k sits in the 30% bracket + 2% Medicare
  assert.ok(Math.abs(saved - 3200) < 1);
});

/* ---------------------------------------------------------------- duty --- */

test('stamp duty spot checks per published schedules', () => {
  // NSW: 3% to $45k, then 5% — $50k → 1350 + 250 = 1600
  assert.equal(stampDuty('NSW', 50000, 'petrol'), 1600);
  // VIC passenger car under the ~$80,567 threshold: 4.2%
  assert.equal(stampDuty('VIC', 50000, 'petrol'), 2100);
  // QLD hybrids/EVs: 2% up to $100k
  assert.equal(stampDuty('QLD', 50000, 'ev'), 1000);
  // WA: $50k falls in the sliding band between $25k and $50k (6.5% at $50k+)
  assert.equal(stampDuty('WA', 60000, 'petrol'), 3900);
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
  // Zero interest: straight-line
  assert.ok(Math.abs(monthlyRepayment(12000, 0, 12) - 1000) < 1e-9);
  // Known amortisation: $30k @ 6% over 60 months ≈ $579.98
  assert.ok(Math.abs(monthlyRepayment(30000, 0.06, 60) - 579.98) < 0.05);
  // With a balloon equal to the principal, payments cover interest only
  const p = monthlyRepayment(10000, 0.12, 12, 10000);
  assert.ok(Math.abs(p - 100) < 0.01);
});

test('ATO minimum residuals', () => {
  assert.equal(residualPct(1), 0.6563);
  assert.equal(residualPct(3), 0.4688);
  assert.equal(residualPct(5), 0.2813);
});

/* -------------------------------------------------------------- methods --- */

test('running costs: EV uses electricity, ICE uses fuel', () => {
  const ice = annualRunningCosts(baseInputs);
  assert.ok(Math.abs(ice.energy - (13000 / 100) * 7.5 * 1.95) < 1e-6);
  const ev = annualRunningCosts({
    ...baseInputs, vehicleType: 'ev', electricityPerKwh: 0.32, evKwhPer100km: 16,
  });
  assert.ok(Math.abs(ev.energy - (13000 / 100) * 16 * 0.32) < 1e-6);
  assert.ok(ev.energy < ice.energy);
});

test('each method: rows sum to net cost', () => {
  const cmp = compareAll(baseInputs);
  for (const r of cmp.results) {
    const sum = r.rows.reduce((a, row) => a + row.amount, 0);
    // Lease rows include informational GST-on-running savings already inside
    // the ex-GST running row — exclude info rows from the reconciliation.
    const recon = r.rows.filter((row) => !row.info).reduce((a, row) => a + row.amount, 0);
    assert.ok(Math.abs(recon - r.netCost) < 1, `${r.label}: rows ${recon} vs net ${r.netCost}`);
    assert.ok(sum <= recon + 1e-9);
  }
});

test('loan costs more than cash when opportunity cost is off', () => {
  const inputs = { ...baseInputs, includeOpportunityCost: false };
  const cash = buyOutright(inputs);
  const loan = carLoan(inputs);
  assert.ok(loan.netCost > cash.netCost, 'borrowing at 7.5% should cost more than cash');
});

test('timelines end at the net cost', () => {
  const cmp = compareAll(baseInputs);
  for (const r of cmp.results) {
    assert.ok(
      Math.abs(r.timeline[r.timeline.length - 1] - r.netCost) < 1,
      `${r.label} timeline end ${r.timeline.at(-1)} != net ${r.netCost}`,
    );
  }
});

test('eligible EV lease is FBT-exempt and fully pre-tax; expensive EV is not', () => {
  const ev = novatedLease({
    ...baseInputs, vehicleType: 'ev', price: 60000,
    electricityPerKwh: 0.32, evKwhPer100km: 16, fuelPerLitre: 0, fuelLPer100km: 0,
  });
  assert.equal(ev.fbtExempt, true);
  assert.equal(ev.postTaxAnnual, 0);

  const luxEv = novatedLease({
    ...baseInputs, vehicleType: 'ev', price: 120000,
    electricityPerKwh: 0.32, evKwhPer100km: 16, fuelPerLitre: 0, fuelLPer100km: 0,
  });
  assert.equal(luxEv.fbtExempt, false);
  assert.ok(luxEv.postTaxAnnual > 0);
});

test('novated lease: higher salary saves more tax', () => {
  const low = novatedLease({ ...baseInputs, salary: 60000 });
  const high = novatedLease({ ...baseInputs, salary: 220000 });
  assert.ok(high.annualTaxSaved > low.annualTaxSaved);
  assert.ok(high.netCost < low.netCost);
});

test('GST credit on the car is capped at the car-limit credit', () => {
  const cheap = novatedLease(baseInputs); // 50k → full 1/11
  assert.ok(Math.abs(cheap.rows.find((r) => r.label === 'GST saved on car').amount + 50000 / 11) < 1);
  const dear = novatedLease({ ...baseInputs, price: 120000 });
  assert.ok(
    Math.abs(dear.rows.find((r) => r.label === 'GST saved on car').amount + AU_DATA.gst.maxCarCredit) < 1,
  );
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
