/*
 * Car ownership cost engine — Australia.
 *
 * Pure functions only: no DOM access, importable from both the browser
 * (type="module") and Node tests. All monetary values are AUD.
 *
 * The AU_DATA constants (tax brackets, FBT settings, stamp duty schedules,
 * state charges, market defaults) live in data.js so figures can be updated
 * each financial year without touching the maths.
 */

import { AU_DATA } from './data.js';

/* ---------------------------------------------------------------- tax --- */

/**
 * Income tax + Medicare levy − LITO for a resident individual.
 * Ignores HELP repayments, MLS and other offsets — documented in README.
 */
export function incomeTax(taxable, data = AU_DATA) {
  if (taxable <= 0) return 0;
  let tax = 0;
  for (const b of data.tax.brackets) {
    if (taxable > b.min) {
      tax += (Math.min(taxable, b.max ?? Infinity) - b.min) * b.rate;
    }
  }
  // Low income tax offset (non-refundable)
  let lito = 0;
  const l = data.tax.lito;
  if (l) {
    lito = l.amount;
    for (const t of l.tapers) {
      if (taxable > t.from) lito -= (Math.min(taxable, t.to) - t.from) * t.rate;
    }
    lito = Math.max(0, lito);
  }
  tax = Math.max(0, tax - lito);
  // Medicare levy (full rate above the phase-in ceiling; linear phase-in above threshold)
  const m = data.tax.medicare;
  let medicare = 0;
  if (taxable > m.threshold) {
    medicare = Math.min(taxable * m.rate, (taxable - m.threshold) * m.phaseInRate);
  }
  return tax + medicare;
}

/** Tax saved by reducing taxable income from `salary` by `deduction`. */
export function taxSaved(salary, deduction, data = AU_DATA) {
  if (deduction <= 0) return 0;
  return incomeTax(salary, data) - incomeTax(Math.max(0, salary - deduction), data);
}

/* --------------------------------------------------------- stamp duty --- */

/**
 * Motor vehicle stamp duty on a private passenger-car purchase.
 * `vehicleType`: 'ev' | 'phev' | 'hybrid' | 'petrol' | 'diesel'
 * Schedules per state live in data.js as piecewise rules.
 */
export function stampDuty(state, dutiableValue, vehicleType, data = AU_DATA) {
  const s = data.states[state];
  if (!s) throw new Error(`Unknown state: ${state}`);
  return Math.round(s.stampDuty(dutiableValue, vehicleType));
}

/* ------------------------------------------------------------ finance --- */

/**
 * Monthly repayment amortising `principal` down to `balloon` over
 * `months` at annual nominal rate `annualRate` (monthly compounding).
 */
export function monthlyRepayment(principal, annualRate, months, balloon = 0) {
  const i = annualRate / 12;
  if (i === 0) return (principal - balloon) / months;
  const f = Math.pow(1 + i, -months);
  return ((principal - balloon * f) * i) / (1 - f);
}

/** ATO minimum residual value percentage for a lease term in whole years. */
export function residualPct(termYears, data = AU_DATA) {
  const r = data.lease.residuals[termYears];
  if (r == null) throw new Error(`No residual for term ${termYears}`);
  return r;
}

/* ------------------------------------------------------ running costs --- */

/**
 * Annual running costs, GST-inclusive, split by whether GST applies
 * (novated packaging saves GST on the GST-able portion only).
 */
export function annualRunningCosts(inputs, data = AU_DATA) {
  const s = data.states[inputs.state];
  const kmYear = inputs.kmPerYear;
  let energy;
  if (inputs.vehicleType === 'ev') {
    energy = (kmYear / 100) * inputs.evKwhPer100km * inputs.electricityPerKwh;
  } else {
    energy = (kmYear / 100) * inputs.fuelLPer100km * inputs.fuelPerLitre;
  }
  const gstable = energy + inputs.insurancePerYear + inputs.servicePerYear + inputs.tyresPerYear;
  const gstFree = s.regoCtpPerYear; // rego + CTP treated as GST-free (see README)
  return { gstable, gstFree, total: gstable + gstFree, energy };
}

/* ------------------------------------------------------- depreciation --- */

/** Estimated resale value after `termYears`, from data-driven retention curve. */
export function resaleValue(price, termYears, data = AU_DATA) {
  const retained = data.depreciation.retainedByYear[termYears];
  if (retained == null) throw new Error(`No retention factor for ${termYears}y`);
  return price * retained;
}

/* ============================================================ methods === */

/**
 * Shared shape of a result:
 * { label, upfront, totalOutgoings, resale, netCost, perYear, perWeek,
 *   rows: [{label, amount, note?}], timeline: [cumulative cost at end of each year] }
 */

/** Method 1 — buy outright with cash. */
export function buyOutright(inputs, data = AU_DATA) {
  const duty = stampDuty(inputs.state, inputs.price, inputs.vehicleType, data);
  const run = annualRunningCosts(inputs, data);
  const t = inputs.termYears;
  const resale = inputs.resaleOverride ?? resaleValue(inputs.price, t, data);

  const upfront = inputs.price + duty;
  const runningTotal = run.total * t;

  // Opportunity cost: interest the purchase cash could have earned (optional)
  let opportunity = 0;
  if (inputs.includeOpportunityCost) {
    opportunity = upfront * (Math.pow(1 + inputs.savingsRate, t) - 1);
  }

  const totalOutgoings = upfront + runningTotal + opportunity;
  const netCost = totalOutgoings - resale;

  const rows = [
    { label: 'Vehicle price (incl. GST)', amount: inputs.price },
    { label: 'Stamp duty', amount: duty },
    { label: `Running costs (${t} yrs)`, amount: runningTotal },
  ];
  if (inputs.includeOpportunityCost) {
    rows.push({
      label: 'Forgone interest on cash',
      amount: opportunity,
      note: `${(inputs.savingsRate * 100).toFixed(1)}% p.a. on the upfront amount`,
    });
  }
  rows.push({ label: 'Less: resale value', amount: -resale });

  const timeline = [];
  for (let y = 1; y <= t; y++) {
    let c = upfront + run.total * y;
    if (inputs.includeOpportunityCost) c += upfront * (Math.pow(1 + inputs.savingsRate, y) - 1);
    if (y === t) c -= resale;
    timeline.push(c);
  }

  return finishResult('Buy outright', upfront, totalOutgoings, resale, netCost, rows, timeline, t, {
    monthlyOutgoing: run.total / 12,
  });
}

/** Method 2 — car loan (secured, on-roads financed, optional deposit/balloon). */
export function carLoan(inputs, data = AU_DATA) {
  const duty = stampDuty(inputs.state, inputs.price, inputs.vehicleType, data);
  const run = annualRunningCosts(inputs, data);
  const t = inputs.termYears;
  const months = t * 12;
  const resale = inputs.resaleOverride ?? resaleValue(inputs.price, t, data);

  const deposit = inputs.loanDeposit || 0;
  const balloonPct = inputs.loanBalloonPct || 0;
  const financed = inputs.price + duty - deposit + data.loan.applicationFee;
  const balloon = inputs.price * balloonPct;
  const payment = monthlyRepayment(financed, inputs.loanRate, months, balloon);

  const repaymentsTotal = payment * months;
  const monthlyFees = data.loan.monthlyFee * months;
  const interest = repaymentsTotal + balloon - financed;
  const runningTotal = run.total * t;

  const totalOutgoings = deposit + repaymentsTotal + balloon + monthlyFees + runningTotal;
  const netCost = totalOutgoings - resale;

  const rows = [
    { label: 'Vehicle price (incl. GST)', amount: inputs.price },
    { label: 'Stamp duty', amount: duty },
    {
      label: 'Loan interest',
      amount: interest,
      note: `${(inputs.loanRate * 100).toFixed(2)}% p.a. over ${t} yrs`,
    },
    { label: 'Loan fees', amount: data.loan.applicationFee + monthlyFees },
    { label: `Running costs (${t} yrs)`, amount: runningTotal },
    { label: 'Less: resale value', amount: -resale },
  ];

  const timeline = [];
  for (let y = 1; y <= t; y++) {
    let c = deposit + (payment + data.loan.monthlyFee) * 12 * y + run.total * y;
    if (y === t) c += balloon - resale;
    timeline.push(c);
  }

  return finishResult('Car loan', deposit, totalOutgoings, resale, netCost, rows, timeline, t, {
    monthlyOutgoing: payment + data.loan.monthlyFee + run.total / 12,
    monthlyRepayment: payment,
    interest,
    balloon,
  });
}

/** Method 3 — fully-maintained novated lease with salary packaging. */
export function novatedLease(inputs, data = AU_DATA) {
  const duty = stampDuty(inputs.state, inputs.price, inputs.vehicleType, data);
  const run = annualRunningCosts(inputs, data);
  const t = inputs.termYears;
  const months = t * 12;
  const resale = inputs.resaleOverride ?? resaleValue(inputs.price, t, data);

  // GST on the car is claimed by the financier (capped at 1/11 of the car limit),
  // so the amount financed is the GST-exclusive price (up to the cap) + on-roads.
  const gstOnCar = inputs.price / 11;
  const gstCredit = Math.min(gstOnCar, data.gst.maxCarCredit);
  const financed = inputs.price - gstCredit + duty + data.lease.establishmentFee;

  const residual = financed * residualPct(t, data);
  const financePayment = monthlyRepayment(financed, inputs.leaseRate, months, residual);

  // Packaged running costs are effectively GST-exclusive to the employee
  // (employer claims input tax credits on the GST-able portion).
  const runMonthlyExGst = (run.gstable / 1.1 + run.gstFree) / 12;
  const adminMonthly = data.lease.adminFeePerMonth;
  const packageMonthly = financePayment + runMonthlyExGst + adminMonthly;
  const packageAnnual = packageMonthly * 12;

  // FBT: statutory formula 20% of the base value (GST-inclusive price, excluding
  // stamp duty & rego). Eligible EVs are FBT-exempt → fully pre-tax.
  const fbtExempt =
    inputs.vehicleType === 'ev' && inputs.price <= data.fbt.evExemptionPriceCap;
  const fbtBaseValue = inputs.price;
  const requiredPostTax = fbtExempt ? 0 : data.fbt.statutoryRate * fbtBaseValue;

  const postTaxAnnual = Math.min(packageAnnual, requiredPostTax);
  const preTaxAnnual = packageAnnual - postTaxAnnual;

  const annualTaxSaved = taxSaved(inputs.salary, preTaxAnnual, data);
  const gstSavedRunning = (run.gstable - run.gstable / 1.1) * t;

  const residualWithGst = residual * 1.1; // residual payment attracts GST
  const totalOutgoings = packageAnnual * t - annualTaxSaved * t + residualWithGst;
  const netCost = totalOutgoings - resale;

  const leaseInterest = financePayment * months + residual - financed;

  const rows = [
    {
      label: 'Lease finance payments',
      amount: financePayment * months,
      note: `${Math.round(financed)} financed (price − GST credit + stamp duty + establishment fee) ` +
        `at ${(inputs.leaseRate * 100).toFixed(2)}% p.a.; includes ${Math.round(leaseInterest)} interest`,
    },
    { label: 'Admin fees', amount: adminMonthly * months },
    { label: `Running costs (${t} yrs, ex-GST)`, amount: (run.gstable / 1.1 + run.gstFree) * t },
    { label: 'Income tax saved', amount: -annualTaxSaved * t },
    { label: 'Residual payment (incl. GST)', amount: residualWithGst },
    // Informational — already reflected in the financed amount / ex-GST running row
    { label: 'GST saved on car', amount: -gstCredit, info: true },
    { label: 'GST saved on running costs', amount: -gstSavedRunning, info: true },
    { label: 'Less: resale value', amount: -resale },
  ];

  const timeline = [];
  for (let y = 1; y <= t; y++) {
    let c = (packageAnnual - annualTaxSaved) * y;
    if (y === t) c += residualWithGst - resale;
    timeline.push(c);
  }

  const netMonthly = (packageAnnual - annualTaxSaved) / 12;

  return finishResult('Novated lease', 0, totalOutgoings, resale, netCost, rows, timeline, t, {
    monthlyOutgoing: netMonthly,
    packageMonthly,
    financePayment,
    residual,
    residualWithGst,
    fbtExempt,
    preTaxAnnual,
    postTaxAnnual,
    annualTaxSaved,
  });
}

function finishResult(label, upfront, totalOutgoings, resale, netCost, rows, timeline, termYears, extra) {
  return {
    label,
    upfront,
    totalOutgoings,
    resale,
    netCost,
    perYear: netCost / termYears,
    perWeek: netCost / (termYears * 52),
    rows,
    timeline,
    ...extra,
  };
}

/** Run all three methods and rank them. */
export function compareAll(inputs, data = AU_DATA) {
  const results = [buyOutright(inputs, data), carLoan(inputs, data), novatedLease(inputs, data)];
  const ranked = [...results].sort((a, b) => a.netCost - b.netCost);
  return { results, cheapest: ranked[0], ranked };
}
