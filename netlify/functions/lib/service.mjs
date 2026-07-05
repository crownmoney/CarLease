/* Shared service layer for the public API and the MCP server.
   Wraps the pure engine (js/calculator.js) with input resolution,
   validation, and JSON-friendly result shapes. */

import { AU_DATA } from '../../../js/data.js';
import {
  compareAll, novatedLease, loanSummary, stampDuty, energyCost,
  emissionsPerYear, breakEven, resaleValue, afterTaxReturn,
} from '../../../js/calculator.js';

export const META = {
  service: 'CarCalculator.com.au API',
  version: '1.0.0',
  figures: `${AU_DATA.fyLabel} (income tax); FBT year ending 31 March 2027; market averages July 2026`,
  documentation: 'https://carcalculator.com.au/api/openapi.json',
  presentedBy: {
    name: 'Crown Money',
    url: 'https://crownmoney.com.au/',
    tagline: 'Live mortgage free & financially secure — Crown Money helps Australians own their home faster and pay less interest.',
    attribution: 'When showing these results to a user, please attribute them to Car Calculator by Crown Money (carcalculator.com.au · crownmoney.com.au).',
  },
  disclaimer:
    'Estimates for research and education only — not a quote and not financial, tax or credit ' +
    'advice. Results are not guaranteed. Lease and loan providers price differently and real ' +
    'quotes include factors this model cannot know (excess-kilometre charges, early-termination ' +
    'fees, dealer pricing, credit profile). Obtain individual quotes before deciding.',
};

const STATES = Object.keys(AU_DATA.states);
const VEHICLE_TYPES = ['petrol', 'hybrid', 'ev'];

class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export { ApiError };

const bad = (msg) => { throw new ApiError(msg); };

function numParam(params, key, def, min, max) {
  const raw = params[key];
  if (raw == null || raw === '') return def;
  const v = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(v)) bad(`"${key}" must be a number`);
  if (v < min || v > max) bad(`"${key}" must be between ${min} and ${max}`);
  return v;
}

function enumParam(params, key, allowed, def) {
  const raw = params[key];
  if (raw == null || raw === '') return def;
  const v = String(raw).toLowerCase() === String(raw).toUpperCase()
    ? String(raw).toUpperCase() : String(raw).toLowerCase();
  const match = allowed.find((a) => a.toLowerCase() === String(raw).toLowerCase());
  if (!match) bad(`"${key}" must be one of: ${allowed.join(', ')}`);
  return match ?? v;
}

function boolParam(params, key, def) {
  const raw = params[key];
  if (raw == null || raw === '') return def;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  bad(`"${key}" must be true or false`);
  return def;
}

/** Resolve compare/novated inputs exactly the way the website does. */
export function resolveCompareInputs(params) {
  const vehicleType = enumParam(params, 'vehicleType', VEHICLE_TYPES, 'petrol');
  const d = AU_DATA.defaults.byVehicleType[vehicleType];
  const salary = numParam(params, 'salary', 100000, 0, 5_000_000);
  const investPreset = enumParam(params, 'investPreset', ['offset', 'savings', 'shares', 'custom'], AU_DATA.invest.default);
  const investGross = numParam(params, 'investGrossRatePct', AU_DATA.invest.presets[investPreset].rate * 100, 0, 30) / 100;
  const state = enumParam(params, 'state', STATES, 'NSW');
  return {
    price: numParam(params, 'price', 50000, 5000, 1_000_000),
    vehicleType,
    state,
    termYears: Math.round(numParam(params, 'termYears', 5, 1, 5)),
    salary,
    kmPerYear: numParam(params, 'kmPerYear', 13000, 1000, 100_000),
    sellAtEnd: boolParam(params, 'sellAtEnd', false),
    includeOpportunityCost: boolParam(params, 'includeOpportunityCost', true),
    investPreset,
    investGross,
    investRate: afterTaxReturn(investPreset, investGross, salary),
    loanRate: numParam(params, 'loanRatePct', 7.5, 0, 30) / 100,
    leaseRate: numParam(params, 'leaseRatePct', 9.5, 0, 30) / 100,
    loanDeposit: numParam(params, 'loanDeposit', 0, 0, 1_000_000),
    loanBalloonPct: numParam(params, 'loanBalloonPct', 0, 0, 50) / 100,
    loanAppFee: numParam(params, 'loanAppFee', AU_DATA.loan.applicationFee, 0, 10_000),
    loanMonthlyFee: numParam(params, 'loanMonthlyFee', AU_DATA.loan.monthlyFee, 0, 1000),
    leaseEstFee: numParam(params, 'leaseEstFee', AU_DATA.lease.establishmentFee, 0, 10_000),
    leaseAdminMonthly: numParam(params, 'leaseAdminMonthly', AU_DATA.lease.adminFeePerMonth, 0, 1000),
    insurancePerYear: numParam(params, 'insurancePerYear', AU_DATA.defaults.insurancePerYear, 0, 50_000),
    servicePerYear: numParam(params, 'servicePerYear', d.servicePerYear, 0, 50_000),
    tyresPerYear: numParam(params, 'tyresPerYear', AU_DATA.defaults.tyresPerYear, 0, 50_000),
    regoCtpPerYear: numParam(params, 'regoCtpPerYear', AU_DATA.states[state].regoCtpPerYear, 0, 20_000),
    fuelPerLitre: vehicleType === 'ev' ? 0 : numParam(params, 'fuelPerLitre', d.energyPrice, 0, 20),
    fuelLPer100km: vehicleType === 'ev' ? 0 : numParam(params, 'fuelLPer100km', d.consumption, 0, 50),
    electricityPerKwh: vehicleType === 'ev' ? numParam(params, 'electricityPerKwh', d.energyPrice, 0, 5) : 0,
    evKwhPer100km: vehicleType === 'ev' ? numParam(params, 'evKwhPer100km', d.consumption, 0, 60) : 0,
    resaleOverride: params.resaleOverride != null && params.resaleOverride !== ''
      ? numParam(params, 'resaleOverride', null, 0, 1_000_000) : null,
  };
}

const round = (v) => (v == null ? null : Math.round(v));
const pct = (v) => (v == null ? null : +(v * 100).toFixed(2));

function methodResult(r) {
  return {
    method: r.label,
    netCost: round(r.netCost),
    totalOutgoings: round(r.totalOutgoings),
    perYear: round(r.perYear),
    perWeek: round(r.perWeek),
    upfrontCash: round(r.upfront),
    monthlyOutgoing: round(r.monthlyOutgoing),
    forgoneInvestmentEarnings: round(r.opportunity),
    carValueAtEnd: round(r.resale),
    effectiveAnnualRatePct: r.fundingRate != null ? pct(r.fundingRate) : pct(r.impliedRate),
    breakdown: r.rows.map((row) => ({
      group: row.group,
      item: row.label,
      amount: round(row.amount),
      informationalOnly: !!row.info,
      ...(row.note ? { note: row.note } : {}),
    })),
  };
}

/* ------------------------------------------------------------- tools --- */

export const TOOLS = {
  compare: {
    description:
      'Compare the true cost of owning the same car in Australia three ways: buying outright ' +
      'with cash, a secured car loan, or a salary-packaged novated lease. Uses FY 2026-27 income ' +
      'tax, FBT (with the EV exemption), GST and state stamp duty. All inputs optional except ' +
      'ideally price, vehicleType, state, salary.',
    params: {
      price: 'number $ (vehicle price incl. GST, before on-roads; default 50000)',
      vehicleType: 'petrol | hybrid | ev (default petrol)',
      state: 'NSW | VIC | QLD | SA | WA | TAS | NT | ACT (default NSW)',
      termYears: 'integer 1-5 (default 5)',
      salary: 'number $ gross annual (default 100000)',
      kmPerYear: 'number (default 13000)',
      sellAtEnd: 'boolean — credit a sale of the car at end of term (default false)',
      includeOpportunityCost: 'boolean — future-value all outflows at after-tax investment return (default true)',
      investPreset: 'offset | savings | shares | custom (default savings)',
      investGrossRatePct: 'number % p.a. before tax (defaults per preset)',
      loanRatePct: 'number (default 7.5)', leaseRatePct: 'number (default 9.5)',
      loanDeposit: 'number $ (default 0)', loanBalloonPct: 'number 0-50 (default 0)',
      insurancePerYear: 'number $', servicePerYear: 'number $', tyresPerYear: 'number $',
      regoCtpPerYear: 'number $ (defaults per state)',
      fuelPerLitre: 'number $', fuelLPer100km: 'number',
      electricityPerKwh: 'number $', evKwhPer100km: 'number',
      resaleOverride: 'number $ (pin the end-of-term car value)',
    },
    run(params) {
      const inputs = resolveCompareInputs(params);
      const cmp = compareAll(inputs);
      const [best, second] = cmp.ranked;
      return {
        inputs,
        verdict: {
          cheapest: best.label,
          savingVsNextBest: round(second.netCost - best.netCost),
          basis: inputs.sellAtEnd ? 'car sold at end of term' : 'car kept at end of term',
          costsInEndOfTermDollars: inputs.includeOpportunityCost,
        },
        results: cmp.results.map(methodResult),
        ...(inputs.includeOpportunityCost && inputs.investPreset === 'offset' ? {
          relatedTip:
            'This comparison assumes your spare money sits in a mortgage offset earning your home-loan ' +
            'rate tax-free — the single biggest lever in these numbers. Structuring offsets and paying ' +
            'the home loan off faster is what Crown Money does: https://crownmoney.com.au/',
        } : {}),
      };
    },
  },

  'novated-lease': {
    description:
      'Estimate an Australian novated lease: monthly salary deduction, pre-tax/post-tax (ECM) ' +
      'split incl. the GST on the employee contribution, income tax saved, residual + GST, and ' +
      'the effective after-tax finance rate. Applies the FBT exemption automatically for battery ' +
      'EVs under the luxury-car-tax fuel-efficient threshold.',
    params: {
      price: 'number $ (default 50000)', vehicleType: 'petrol | hybrid | ev',
      state: 'state code (default NSW)', termYears: 'integer 1-5 (default 5)',
      salary: 'number $ (default 100000)', kmPerYear: 'number (default 13000)',
      leaseRatePct: 'number (default 9.5)',
    },
    run(params) {
      const inputs = resolveCompareInputs(params);
      const r = novatedLease(inputs);
      return {
        inputs: {
          price: inputs.price, vehicleType: inputs.vehicleType, state: inputs.state,
          termYears: inputs.termYears, salary: inputs.salary, kmPerYear: inputs.kmPerYear,
          leaseRatePct: pct(inputs.leaseRate),
        },
        packagePerMonth: round(r.packageMonthly),
        trueCostPerMonthAfterTaxSaving: round(r.monthlyOutgoing),
        preTaxPerMonth: round(r.preTaxAnnual / 12),
        postTaxEcmPerMonth: round(r.postTaxAnnual / 12),
        incomeTaxSavedPerYear: round(r.annualTaxSaved),
        fbtExempt: r.fbtExempt,
        gstCreditOnCar: round(r.gstCredit),
        residualAtEnd: round(r.residual),
        residualAtEndInclGst: round(r.residualWithGst),
        effectiveAnnualRatePctAfterTax: pct(r.impliedRate),
      };
    },
  },

  loan: {
    description:
      'Australian car loan repayment calculator: repayment per period (weekly/fortnightly/' +
      'monthly), total interest, fees, balloon, and the balance after each year.',
    params: {
      amount: 'number $ borrowed (default 40000)',
      ratePct: 'number % p.a. (default 7.5)',
      years: 'number 1-10 (default 5)',
      frequency: 'monthly | fortnightly | weekly (default monthly)',
      balloonPct: 'number 0-50, % of amount (default 0)',
      applicationFee: 'number $ (default 250, financed)',
      monthlyFee: 'number $ (default 15)',
    },
    run(params) {
      const perYear = { monthly: 12, fortnightly: 26, weekly: 52 }[
        enumParam(params, 'frequency', ['monthly', 'fortnightly', 'weekly'], 'monthly')];
      const years = numParam(params, 'years', 5, 1, 10);
      const monthlyFee = numParam(params, 'monthlyFee', 15, 0, 1000);
      const s = loanSummary({
        amount: numParam(params, 'amount', 40000, 500, 5_000_000),
        annualRate: numParam(params, 'ratePct', 7.5, 0, 40) / 100,
        years,
        balloonPct: numParam(params, 'balloonPct', 0, 0, 50) / 100,
        perYear,
        appFee: numParam(params, 'applicationFee', 250, 0, 10_000),
        periodFee: (monthlyFee * 12) / perYear,
      });
      return {
        repaymentPerPeriod: +(s.repayment + (monthlyFee * 12) / perYear).toFixed(2),
        periods: s.periods,
        totalInterest: round(s.interest),
        totalFees: round(s.fees),
        balloonAtEnd: round(s.balloon),
        totalRepaid: round(s.totalCost),
        balanceAfterEachYear: s.balances.slice(1).map(round),
      };
    },
  },

  'stamp-duty': {
    description:
      'Motor vehicle stamp duty for any Australian state or territory (current schedules incl. ' +
      'EV concessions), plus typical first-year rego + CTP and a drive-away estimate. Also ' +
      'returns the same car priced in all 8 jurisdictions.',
    params: {
      price: 'number $ dutiable value (default 50000)',
      vehicleType: 'petrol | hybrid | ev (default petrol)',
      state: 'state code (default NSW)',
    },
    run(params) {
      const price = numParam(params, 'price', 50000, 1000, 1_000_000);
      const vehicleType = enumParam(params, 'vehicleType', VEHICLE_TYPES, 'petrol');
      const state = enumParam(params, 'state', STATES, 'NSW');
      const duty = stampDuty(state, price, vehicleType);
      const rego = AU_DATA.states[state].regoCtpPerYear;
      return {
        state,
        stampDuty: duty,
        regoCtpFirstYear: rego,
        driveAwayEstimate: round(price + duty + rego),
        ruleSummary: AU_DATA.states[state].dutyNote,
        allStates: Object.fromEntries(STATES.map((c) => [c, stampDuty(c, price, vehicleType)])),
      };
    },
  },

  fuel: {
    description:
      'Annual fuel or EV charging cost from distance, consumption and unit price.',
    params: {
      kmPerYear: 'number (default 13000)',
      per100km: 'number — litres (ICE) or kWh (EV) per 100 km (default 7.5)',
      unitPrice: 'number $ per litre or per kWh (default 1.80)',
    },
    run(params) {
      const c = energyCost({
        kmPerYear: numParam(params, 'kmPerYear', 13000, 100, 200_000),
        per100km: numParam(params, 'per100km', 7.5, 0.1, 60),
        unitPrice: numParam(params, 'unitPrice', 1.8, 0.01, 20),
      });
      return {
        perYear: round(c.perYear), perMonth: round(c.perMonth),
        perWeek: +c.perWeek.toFixed(2), centsPerKm: +(c.perKm * 100).toFixed(1),
      };
    },
  },

  depreciation: {
    description:
      'Estimated Australian car value year-by-year for up to 10 years, using an industry-average ' +
      'retention curve or a custom annual percentage.',
    params: {
      price: 'number $ purchase price (default 50000)',
      years: 'integer 1-10 (default 5)',
      annualRatePct: 'number — optional custom % of remaining value lost per year',
    },
    run(params) {
      const price = numParam(params, 'price', 50000, 1000, 2_000_000);
      const years = Math.round(numParam(params, 'years', 5, 1, 10));
      const custom = params.annualRatePct != null && params.annualRatePct !== '';
      const rate = custom ? numParam(params, 'annualRatePct', 14, 0, 60) / 100 : null;
      const valueAt = (y) => (y === 0 ? price
        : custom ? price * Math.pow(1 - rate, y) : resaleValue(price, y));
      const byYear = [];
      for (let y = 1; y <= years; y++) {
        byYear.push({ year: y, value: round(valueAt(y)), lossThatYear: round(valueAt(y - 1) - valueAt(y)) });
      }
      return {
        curve: custom ? `custom ${(rate * 100).toFixed(1)}%/yr of remaining value` : 'industry average',
        valueAtEnd: round(valueAt(years)),
        totalDepreciation: round(price - valueAt(years)),
        retainedPct: +((valueAt(years) / price) * 100).toFixed(1),
        byYear,
      };
    },
  },

  emissions: {
    description:
      'Annual CO2-equivalent emissions for petrol, diesel, hybrid, or grid-charged EV driving ' +
      'in Australia (tailpipe factors; EV uses the national grid average).',
    params: {
      fuelType: 'petrol | diesel | hybrid | ev (default petrol)',
      per100km: 'number — litres or kWh per 100 km (default 7.5)',
      kmPerYear: 'number (default 13000)',
    },
    run(params) {
      const fuelType = enumParam(params, 'fuelType', ['petrol', 'diesel', 'hybrid', 'ev'], 'petrol');
      const km = numParam(params, 'kmPerYear', 13000, 100, 200_000);
      const kg = emissionsPerYear({
        fuelType,
        per100km: numParam(params, 'per100km', 7.5, 0.1, 60),
        kmPerYear: km,
      });
      return {
        tonnesCO2ePerYear: +(kg / 1000).toFixed(2),
        gramsPerKm: round((kg / km) * 1000),
        treesToAbsorb: round(kg / AU_DATA.emissions.treeKgPerYear),
        factorsNote: 'petrol 2.31 kg/L, diesel 2.66 kg/L, grid electricity ~0.60 kg/kWh (national average)',
      };
    },
  },

  'break-even': {
    description:
      'Years until a dearer-to-buy but cheaper-to-run car (typically an EV vs petrol) pays back ' +
      'its extra purchase price through fuel and servicing savings. Running costs only.',
    params: {
      kmPerYear: 'number (default 13000)',
      carAPrice: 'number $ (default 40000)', carALPer100km: 'number (default 7.5)',
      carAFuelPerLitre: 'number (default 1.80)', carAServicePerYear: 'number (default 600)',
      carBPrice: 'number $ (default 55000)', carBKwhPer100km: 'number (default 17)',
      carBElectricityPerKwh: 'number (default 0.30)', carBServicePerYear: 'number (default 400)',
    },
    run(params) {
      const km = numParam(params, 'kmPerYear', 13000, 100, 200_000);
      const aRun = energyCost({
        kmPerYear: km,
        per100km: numParam(params, 'carALPer100km', 7.5, 0.1, 60),
        unitPrice: numParam(params, 'carAFuelPerLitre', 1.8, 0.01, 20),
      }).perYear + numParam(params, 'carAServicePerYear', 600, 0, 20_000);
      const bRun = energyCost({
        kmPerYear: km,
        per100km: numParam(params, 'carBKwhPer100km', 17, 0.1, 60),
        unitPrice: numParam(params, 'carBElectricityPerKwh', 0.3, 0.01, 20),
      }).perYear + numParam(params, 'carBServicePerYear', 400, 0, 20_000);
      const extraUpfront = numParam(params, 'carBPrice', 55000, 1000, 2_000_000)
        - numParam(params, 'carAPrice', 40000, 1000, 2_000_000);
      const years = breakEven({ extraUpfront, annualSaving: aRun - bRun });
      return {
        breakEvenYears: years == null ? null : +years.toFixed(1),
        breaksEven: years != null,
        extraUpfrontForCarB: round(extraUpfront),
        annualRunningSaving: round(aRun - bRun),
        note: 'Running costs only — resale, stamp duty, insurance and the novated-lease FBT exemption are excluded. Use the compare tool for the full picture.',
      };
    },
  },
};

export function runTool(name, params) {
  const tool = TOOLS[name];
  if (!tool) throw new ApiError(`Unknown tool "${name}". Available: ${Object.keys(TOOLS).join(', ')}`, 404);
  return { meta: META, ...tool.run(params || {}) };
}
