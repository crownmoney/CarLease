/*
 * Car ownership cost engine — Australia.
 *
 * Pure functions only: no DOM access, importable from both the browser
 * (type="module") and Node tests. All monetary values are AUD.
 *
 * Cost model: every method is a stream of outflows — an upfront amount, a
 * constant monthly amount, and a terminal amount (balloon / residual). When
 * `includeOpportunityCost` is on, each outflow is future-valued to the end of
 * the term at the buyer's after-tax investment return (`investRate`), so money
 * not yet spent keeps earning regardless of which method you choose. That
 * makes the comparison symmetric: the cash buyer forfeits returns on the lump
 * sum, the borrower forfeits returns on each repayment as it leaves. With the
 * toggle off the model reduces to plain nominal totals.
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

/** Effective marginal rate (incl. Medicare & offset tapers) around `salary`. */
export function marginalRateAt(salary, data = AU_DATA) {
  const d = 500;
  return (incomeTax(salary + d, data) - incomeTax(Math.max(0, salary - d), data)) / (2 * d);
}

/**
 * After-tax annual return for money that would otherwise sit in `preset`:
 *  - offset: reduces mortgage interest → equivalent return is tax-free
 *  - savings: interest fully taxed at the marginal rate
 *  - shares: long-run return taxed concessionally (≈ half the marginal rate,
 *    approximating the CGT discount and franking credits)
 */
export function afterTaxReturn(preset, grossRate, salary, data = AU_DATA) {
  const m = marginalRateAt(salary, data);
  const taxFactor = { offset: 0, savings: 1, shares: 0.5 }[preset] ?? 1;
  return grossRate * (1 - m * taxFactor);
}

/* --------------------------------------------------------- stamp duty --- */

/**
 * Motor vehicle stamp duty on a private passenger-car purchase.
 * `vehicleType`: 'ev' | 'hybrid' | 'petrol' | 'diesel'
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
 * Annual running costs, GST-inclusive, itemised. `gstable` is the portion the
 * novated packaging saves GST on (rego + CTP treated as GST-free).
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
  const serviceTyres = inputs.servicePerYear + inputs.tyresPerYear;
  const gstable = energy + inputs.insurancePerYear + serviceTyres;
  const gstFree = inputs.regoCtpPerYear ?? s.regoCtpPerYear;
  return {
    energy,
    insurance: inputs.insurancePerYear,
    serviceTyres,
    rego: gstFree,
    gstable,
    gstFree,
    total: gstable + gstFree,
  };
}

/* ------------------------------------------------------- depreciation --- */

/** Estimated resale value after `termYears`, from data-driven retention curve. */
export function resaleValue(price, termYears, data = AU_DATA) {
  const retained = data.depreciation.retainedByYear[termYears];
  if (retained == null) throw new Error(`No retention factor for ${termYears}y`);
  return price * retained;
}

/* ---------------------------------------------------- cost settlement --- */

/**
 * Settle an outflow stream {upfront, monthly, terminal} over `termYears`,
 * future-valuing at annual `rate` (0 = nominal). When `sell` is true the
 * end-of-term car value is credited back (you sell); otherwise you keep the
 * car and netCost is simply what ownership cost — the car's remaining worth
 * is reported separately. Returns totals, the opportunity cost
 * (FV − nominal), and a cumulative per-year timeline.
 */
export function settle({ upfront, monthly, terminal = 0 }, termYears, rate, resale, sell) {
  const N = termYears * 12;
  // Savings/offset rates are effective annual — convert to the equivalent
  // monthly rate rather than dividing by 12 (which would overstate growth)
  const i = rate === 0 ? 0 : Math.pow(1 + rate, 1 / 12) - 1;
  const grow = (months) => Math.pow(1 + i, months);
  // FV of $1/month over `months` (payments at month-ends)
  const annuity = (months) => (i === 0 ? months : (grow(months) - 1) / i);

  const nominal = upfront + monthly * N + terminal;
  const fv = upfront * grow(N) + monthly * annuity(N) + terminal;
  const opportunity = fv - nominal;
  const credit = sell ? resale : 0;

  const timeline = [];
  for (let y = 1; y <= termYears; y++) {
    let c = upfront * grow(12 * y) + monthly * annuity(12 * y);
    if (y === termYears) c += terminal - credit;
    timeline.push(c);
  }

  return {
    totalOutgoings: fv,
    netCost: fv - credit,
    opportunity,
    timeline,
  };
}

/* ============================================================ methods === */

/**
 * Shared result shape:
 * { label, upfront, totalOutgoings, resale, netCost, opportunity, perYear,
 *   perWeek, monthlyOutgoing, rows: [{group, label, amount, note?, info?}],
 *   timeline, ...method extras }
 * Rows with `info: true` are informational (already embedded in other rows).
 */

const G = {
  buy: 'Buying the car',
  fin: 'Financing',
  run: 'Running costs',
  tax: 'Tax & investment',
  end: 'End of term',
};

function runningRows(run, t, exGst) {
  const f = (v) => (exGst ? v / 1.1 : v);
  const note = exGst ? 'Packaged through the lease, so paid ex-GST' : undefined;
  return [
    { group: G.run, label: 'Fuel / electricity', amount: f(run.energy) * t, note },
    { group: G.run, label: 'Insurance', amount: f(run.insurance) * t, note },
    { group: G.run, label: 'Servicing & tyres', amount: f(run.serviceTyres) * t, note },
    { group: G.run, label: 'Rego & CTP', amount: run.rego * t },
  ];
}

function resaleRow(resale, inputs) {
  return inputs.sellAtEnd
    ? { group: G.end, label: 'Less: sale of car', amount: -resale }
    : {
      group: G.end, label: 'Car still worth (kept, not sold)', amount: -resale, info: true,
      note: 'You keep the car, so this isn’t subtracted from the cost — it’s the asset you own at the end',
    };
}

function opportunityRow(opportunity, inputs) {
  if (!inputs.includeOpportunityCost) return [];
  return [{
    group: G.tax,
    label: 'Forgone investment earnings',
    amount: opportunity,
    note: `What each dollar would have earned at ${(inputs.investRate * 100).toFixed(1)}% p.a. ` +
      'after tax between leaving your pocket and the end of the term',
  }];
}

/** Method 1 — buy outright with cash. */
export function buyOutright(inputs, data = AU_DATA) {
  const duty = stampDuty(inputs.state, inputs.price, inputs.vehicleType, data);
  const run = annualRunningCosts(inputs, data);
  const t = inputs.termYears;
  const resale = inputs.resaleOverride ?? resaleValue(inputs.price, t, data);
  const rate = inputs.includeOpportunityCost ? inputs.investRate : 0;

  const upfront = inputs.price + duty;
  const s = settle({ upfront, monthly: run.total / 12 }, t, rate, resale, inputs.sellAtEnd);

  const rows = [
    { group: G.buy, label: 'Vehicle price (incl. GST)', amount: inputs.price },
    { group: G.buy, label: 'Stamp duty', amount: duty },
    ...runningRows(run, t, false),
    ...opportunityRow(s.opportunity, inputs),
    resaleRow(resale, inputs),
  ];

  return finishResult('Buy outright', upfront, s, resale, rows, t, {
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
  const rate = inputs.includeOpportunityCost ? inputs.investRate : 0;

  const deposit = inputs.loanDeposit || 0;
  const appFee = inputs.loanAppFee ?? data.loan.applicationFee;
  const monthlyFee = inputs.loanMonthlyFee ?? data.loan.monthlyFee;
  const financed = inputs.price + duty - deposit + appFee;
  const balloon = inputs.price * (inputs.loanBalloonPct || 0);
  const payment = monthlyRepayment(financed, inputs.loanRate, months, balloon);
  const interest = payment * months + balloon - financed;
  const monthlyFees = monthlyFee * months;

  const s = settle(
    { upfront: deposit, monthly: payment + monthlyFee + run.total / 12, terminal: balloon },
    t, rate, resale, inputs.sellAtEnd,
  );

  const rows = [
    { group: G.buy, label: 'Vehicle price (incl. GST)', amount: inputs.price },
    { group: G.buy, label: 'Stamp duty', amount: duty },
    {
      group: G.fin, label: 'Loan interest', amount: interest,
      note: `${(inputs.loanRate * 100).toFixed(2)}% p.a. over ${t} yrs` +
        (balloon ? `, ${Math.round(balloon)} balloon` : ''),
    },
    { group: G.fin, label: 'Loan fees', amount: appFee + monthlyFees },
    ...runningRows(run, t, false),
    ...opportunityRow(s.opportunity, inputs),
    resaleRow(resale, inputs),
  ];

  return finishResult('Car loan', deposit, s, resale, rows, t, {
    monthlyOutgoing: payment + monthlyFee + run.total / 12,
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
  const rate = inputs.includeOpportunityCost ? inputs.investRate : 0;

  // GST on the car is claimed by the financier (capped at 1/11 of the car limit),
  // so the amount financed is the GST-exclusive price (up to the cap) + on-roads.
  const gstCredit = Math.min(inputs.price / 11, data.gst.maxCarCredit);
  const financed = inputs.price - gstCredit + duty + (inputs.leaseEstFee ?? data.lease.establishmentFee);

  const residual = financed * residualPct(t, data);
  const financePayment = monthlyRepayment(financed, inputs.leaseRate, months, residual);
  const leaseInterest = financePayment * months + residual - financed;

  // FBT: statutory formula 20% of the base value (GST-inclusive price, excluding
  // stamp duty & rego). Eligible EVs are FBT-exempt → fully pre-tax.
  const fbtExempt =
    inputs.vehicleType === 'ev' && inputs.price <= data.fbt.evExemptionPriceCap;
  const requiredPostTax = fbtExempt ? 0 : data.fbt.statutoryRate * inputs.price;

  // The ECM contribution is consideration for a taxable supply: the employer
  // remits 1/11 of it as GST, and providers recover that cost through the package.
  const ecmGstAnnual = requiredPostTax / 11;

  // Packaged running costs are effectively GST-exclusive to the employee
  // (employer claims input tax credits on the GST-able portion).
  const runMonthlyExGst = (run.gstable / 1.1 + run.gstFree) / 12;
  const adminMonthly = inputs.leaseAdminMonthly ?? data.lease.adminFeePerMonth;
  const packageMonthly = financePayment + runMonthlyExGst + adminMonthly + ecmGstAnnual / 12;
  const packageAnnual = packageMonthly * 12;

  const postTaxAnnual = Math.min(packageAnnual, requiredPostTax);
  const preTaxAnnual = packageAnnual - postTaxAnnual;
  const annualTaxSaved = taxSaved(inputs.salary, preTaxAnnual, data);
  const gstSavedRunning = (run.gstable - run.gstable / 1.1) * t;

  const residualWithGst = residual * 1.1; // residual payout attracts GST
  const netMonthly = packageMonthly - annualTaxSaved / 12;

  const s = settle(
    { upfront: 0, monthly: netMonthly, terminal: residualWithGst },
    t, rate, resale, inputs.sellAtEnd,
  );

  const rows = [
    {
      group: G.fin,
      label: 'Lease finance payments',
      amount: financePayment * months,
      note: `${Math.round(financed)} financed (price − GST credit + stamp duty + establishment fee) ` +
        `at ${(inputs.leaseRate * 100).toFixed(2)}% p.a.; includes ${Math.round(leaseInterest)} interest`,
    },
    { group: G.fin, label: 'Admin fees', amount: adminMonthly * months },
    ...runningRows(run, t, true),
    ...(ecmGstAnnual > 0 ? [{
      group: G.tax,
      label: 'GST on employee contribution (ECM)',
      amount: ecmGstAnnual * t,
      note: 'The employer remits 1/11 of your post-tax FBT contribution as GST; providers recover it through the package',
    }] : []),
    { group: G.tax, label: 'Income tax saved', amount: -annualTaxSaved * t },
    ...opportunityRow(s.opportunity, inputs),
    // Informational — already reflected in the financed amount / ex-GST running rows
    {
      group: G.tax, label: 'GST saved on car', amount: -gstCredit, info: true,
      note: 'Claimed by the financier at purchase; note ~10% of the residual is paid back as GST at the end',
    },
    { group: G.tax, label: 'GST saved on running costs', amount: -gstSavedRunning, info: true },
    { group: G.end, label: 'Residual payment (incl. GST)', amount: residualWithGst },
    resaleRow(resale, inputs),
  ];

  return finishResult('Novated lease', 0, s, resale, rows, t, {
    monthlyOutgoing: netMonthly,
    packageMonthly,
    financePayment,
    residual,
    residualWithGst,
    fbtExempt,
    preTaxAnnual,
    postTaxAnnual,
    annualTaxSaved,
    gstCredit,
  });
}

function finishResult(label, upfront, settled, resale, rows, termYears, extra) {
  return {
    label,
    upfront,
    totalOutgoings: settled.totalOutgoings,
    resale,
    netCost: settled.netCost,
    opportunity: settled.opportunity,
    perYear: settled.netCost / termYears,
    perWeek: settled.netCost / (termYears * 52),
    rows,
    timeline: settled.timeline,
    ...extra,
  };
}

/** Run all three methods and rank them. */
export function compareAll(inputs, data = AU_DATA) {
  const results = [buyOutright(inputs, data), carLoan(inputs, data), novatedLease(inputs, data)];
  const ranked = [...results].sort((a, b) => a.netCost - b.netCost);
  return { results, cheapest: ranked[0], ranked };
}
