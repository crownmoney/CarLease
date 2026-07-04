/*
 * All Australia-specific figures, in one place, with sources.
 * Current for FY 2026-27 (income tax) and the FBT year ending 31 March 2027.
 * Researched July 2026 — update this file annually.
 */

/** Whole units of $`size` (or part thereof) in `v` — duty schedules round up. */
const per = (v, size) => Math.ceil(Math.max(0, v) / size);

export const AU_DATA = {
  fyLabel: 'FY 2026–27',

  /* Resident individual income tax, FY 2026-27.
     Rates legislated by the Treasury Laws Amendment (More Cost of Living
     Relief) Act 2025 — second bracket cut 16% → 15% from 1 July 2026.
     https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents */
  tax: {
    brackets: [
      { min: 0, max: 18200, rate: 0 },
      { min: 18200, max: 45000, rate: 0.15 },
      { min: 45000, max: 135000, rate: 0.30 },
      { min: 135000, max: 190000, rate: 0.37 },
      { min: 190000, max: null, rate: 0.45 },
    ],
    // Low income tax offset (unchanged): $700, −5c/$ over $37,500, −1.5c/$ over $45,000
    lito: {
      amount: 700,
      tapers: [
        { from: 37500, to: 45000, rate: 0.05 },
        { from: 45000, to: 66667, rate: 0.015 },
      ],
    },
    // Medicare levy 2%, phased in at 10c/$ above the single low-income threshold
    // (2025-26 threshold; indexed figure for 2026-27 not yet published)
    medicare: { rate: 0.02, threshold: 27222, phaseInRate: 0.10 },
  },

  /* FBT year ending 31 March 2027.
     https://www.ato.gov.au/tax-rates-and-codes/fringe-benefits-tax-rates-and-thresholds */
  fbt: {
    rate: 0.47,
    statutoryRate: 0.20, // statutory formula, all cars since 1 April 2014
    // Battery EVs are FBT-exempt if no LCT was payable at first retail sale —
    // i.e. price below the LCT fuel-efficient threshold ($91,661 for 2026-27).
    // PHEVs lost the exemption 1 April 2025 (except grandfathered arrangements).
    // https://www.ato.gov.au/.../electric-cars-exemption
    evExemptionPriceCap: 91661,
  },

  /* LCT thresholds 2026-27 (for reference/notes).
     https://www.ato.gov.au/tax-rates-and-codes/luxury-car-tax-rate-and-thresholds */
  lct: { fuelEfficient: 91661, other: 80809, rate: 0.33 },

  /* Car limit $69,883 for 2026-27 → max GST credit 1/11.
     https://www.ato.gov.au/businesses-and-organisations/small-business-newsroom/car-thresholds-from-1-july */
  gst: { rate: 0.10, carLimit: 69883, maxCarCredit: Math.round(69883 / 11) },

  /* Novated lease parameters.
     Residuals: ATO ID 2002/1004 minimum residual values (% of amount financed).
     Fees: typical of major providers (Maxxia/SG Fleet/Smartleasing), July 2026. */
  lease: {
    residuals: { 1: 0.6563, 2: 0.5625, 3: 0.4688, 4: 0.3750, 5: 0.2813 },
    establishmentFee: 475,
    adminFeePerMonth: 30,
    defaultRate: 0.095, // effective; typical quoted-repayment-implied range 8-12%
  },

  /* Secured new-car loan, representative major-bank terms July 2026
     (RBA cash rate 4.35%; comparison rates cluster ~7.0-8.0%). */
  loan: {
    defaultRate: 0.075,
    applicationFee: 250,
    monthlyFee: 15,
  },

  /* Average new-car value retention: ~20-25% lost in year 1, ~55-60% retained
     at 3 years, ~40-45% at 5 (Canstar / savings.com.au industry averages).
     Editable in the UI — strong-resale models (RAV4, Jimny) hold far more. */
  depreciation: {
    retainedByYear: { 1: 0.78, 2: 0.67, 3: 0.58, 4: 0.50, 5: 0.43 },
  },

  /* Editable running-cost defaults. energyPrice is $/L (ICE) or $/kWh (EV);
     consumption is L/100km (ICE) or kWh/100km (EV).
     Fuel ~$1.75-1.80/L mid-2026 (national avg $1.64 + excise discount unwinding);
     home EV charging ~$0.30/kWh, ~17 kWh/100km; ABS avg ~12-13.8k km/yr;
     comprehensive insurance ~$1,800/yr; capped-price servicing ~$600/yr. */
  /* Where the money would otherwise sit — gross annual returns, July 2026.
     Offset ≈ avg owner-occupier variable mortgage rate (~6.7-6.9%, Finder/
     Canstar) and is effectively tax-free; high-interest savings ~4.8% fully
     taxed; diversified shares ~7.5% long-run, taxed concessionally. */
  invest: {
    presets: {
      offset: { label: 'Mortgage offset (tax-free)', rate: 0.067 },
      savings: { label: 'High-interest savings (taxed)', rate: 0.048 },
      shares: { label: 'Share portfolio (concessionally taxed)', rate: 0.075 },
      custom: { label: 'Custom', rate: 0.05 },
    },
    default: 'savings',
  },

  defaults: {
    savingsRate: 0.045,
    byVehicleType: {
      petrol: { energyPrice: 1.80, consumption: 7.5, servicePerYear: 600 },
      hybrid: { energyPrice: 1.80, consumption: 4.5, servicePerYear: 600 },
      ev: { energyPrice: 0.30, consumption: 17, servicePerYear: 400 },
    },
    insurancePerYear: 1800,
    tyresPerYear: 350,
    kmPerYear: 13000,
  },

  /* State/territory schedules, from state revenue office rates July 2026.
     stampDuty(v, t): v = dutiable value (price incl. GST), t = vehicle type
     ('petrol' | 'hybrid' | 'ev'). Passenger vehicles, new, private buyer.
     regoCtpPerYear = representative annual registration + CTP for a standard
     passenger car (metro). dutyNote feeds the on-page assumptions list. */
  states: {
    NSW: {
      name: 'New South Wales',
      regoCtpPerYear: 1080,
      dutyNote: '3% up to $45,000, then 5% on the excess (no EV concession since Jan 2024)',
      stampDuty(v) {
        if (v <= 45000) return per(v, 100) * 3;
        return 1350 + per(v - 45000, 100) * 5;
      },
    },
    VIC: {
      name: 'Victoria',
      regoCtpPerYear: 975,
      dutyNote: 'low-emission cars (≤120 g CO₂/km, incl. EVs & most hybrids) $8.40 per $200 at any value; ' +
        'other passenger cars $8.40/$200 to $80,809, then 5.2% / 7% / 9% bands on the whole value',
      stampDuty(v, t) {
        const units = per(v, 200);
        if (t === 'ev' || t === 'hybrid') return units * 8.4;
        if (v <= 80809) return units * 8.4;
        if (v <= 100000) return units * 10.4;
        if (v <= 150000) return units * 14.0;
        return units * 18.0;
      },
    },
    QLD: {
      name: 'Queensland',
      regoCtpPerYear: 840,
      dutyNote: 'by propulsion — hybrid/EV $2, 4-cyl $3 per $100 up to $100,000 (higher rates on the whole value above)',
      stampDuty(v, t) {
        const green = t === 'ev' || t === 'hybrid';
        const rate = v <= 100000 ? (green ? 2 : 3) : (green ? 4 : 5);
        return per(v, 100) * rate;
      },
    },
    SA: {
      name: 'South Australia',
      regoCtpPerYear: 930,
      dutyNote: '$60 + $4 per $100 over $3,000 for passenger vehicles (≈4%, no EV concession)',
      stampDuty(v) {
        if (v <= 1000) return Math.max(5, per(v, 100) * 1);
        if (v <= 2000) return 10 + per(v - 1000, 100) * 2;
        if (v <= 3000) return 30 + per(v - 2000, 100) * 3;
        return 60 + per(v - 3000, 100) * 4;
      },
    },
    WA: {
      name: 'Western Australia',
      regoCtpPerYear: 945,
      dutyNote: '2.75% up to $25,000, sliding to 6.5% of the whole value by $50,000 (no EV concession)',
      stampDuty(v) {
        if (v <= 25000) return v * 0.0275;
        if (v <= 50000) {
          const r = Math.round((2.75 + (v - 25000) / 6666.66) * 100) / 100;
          return v * (r / 100);
        }
        return v * 0.065;
      },
    },
    TAS: {
      name: 'Tasmania',
      regoCtpPerYear: 650,
      dutyNote: '3% to $35,000, $11 per $100 between $35,000–$40,000, then 4% of the whole value',
      stampDuty(v) {
        if (v <= 600) return 20;
        if (v <= 35000) return per(v, 100) * 3;
        if (v <= 40000) return 1050 + per(v - 35000, 100) * 11;
        return per(v, 100) * 4;
      },
    },
    NT: {
      name: 'Northern Territory',
      regoCtpPerYear: 762,
      dutyNote: 'flat 3%; EVs pay no duty on the first $50,000 until 30 June 2027',
      stampDuty(v, t) {
        if (t === 'ev') return per(Math.max(0, v - 50000), 100) * 3;
        return per(v, 100) * 3;
      },
    },
    ACT: {
      name: 'Australian Capital Territory',
      regoCtpPerYear: 1150,
      dutyNote: 'emissions-based (DI2025-152): EVs 2.5%, new hybrids ~2.84%, typical new petrol ~3% below ' +
        '$45,000, with higher marginal rates above $45,000 and $80,000',
      stampDuty(v, t) {
        // Category by emissions: AAA (0 g/km) = EV, A ≈ new hybrid, B ≈ typical new petrol
        const cat = t === 'ev'
          ? { low: 2.50, base45: 1125, mid: 4.00, base80: 2525 }
          : t === 'hybrid'
            ? { low: 2.84, base45: 1278, mid: 4.81, base80: 2961.5 }
            : { low: 3.00, base45: 1350, mid: 5.22, base80: 3177 };
        if (v < 45000) return v * (cat.low / 100);
        if (v < 80000) return cat.base45 + per(v - 45000, 100) * cat.mid;
        return cat.base80 + per(v - 80000, 100) * 8.0;
      },
    },
  },

  sources: [
    { label: 'ATO — Individual income tax rates', url: 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents' },
    { label: 'ATO — Personal income tax cuts from 1 July 2026', url: 'https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-australian-taxpayer' },
    { label: 'ATO — FBT rates and thresholds', url: 'https://www.ato.gov.au/tax-rates-and-codes/fringe-benefits-tax-rates-and-thresholds' },
    { label: 'ATO — Electric cars FBT exemption', url: 'https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/fringe-benefits-tax/types-of-fringe-benefits/fbt-on-cars-other-vehicles-parking-and-tolls/electric-cars-exemption' },
    { label: 'ATO — Taxable value of a car fringe benefit (statutory formula)', url: 'https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/fringe-benefits-tax/types-of-fringe-benefits/fbt-on-cars-other-vehicles-parking-and-tolls/cars-and-fbt/taxable-value-of-a-car-fringe-benefit' },
    { label: 'ATO — Luxury car tax rate and thresholds', url: 'https://www.ato.gov.au/tax-rates-and-codes/luxury-car-tax-rate-and-thresholds' },
    { label: 'ATO — Car thresholds from 1 July (car limit & GST credit)', url: 'https://www.ato.gov.au/businesses-and-organisations/small-business-newsroom/car-thresholds-from-1-july' },
    { label: 'ATO — GST and vehicles purchased under novated leases', url: 'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/in-detail/your-industry/motor-vehicle-and-transport/gst-and-vehicles-purchased-under-novated-leases' },
    { label: 'ATO ID 2002/1004 — minimum lease residual values', url: 'https://www.ato.gov.au/law/view/document?docid=aid/aid20021004/00001' },
    { label: 'RBA — cash rate target (4.35%, June 2026)', url: 'https://www.rba.gov.au/statistics/cash-rate/' },
    { label: 'Revenue NSW — motor vehicle duty', url: 'https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/motor-vehicle-duty' },
    { label: 'SRO Victoria — motor vehicle duty rates', url: 'https://www.sro.vic.gov.au/about-us/rates-and-statistics/current-rates/motor-vehicle-duty-current-rates' },
    { label: 'QLD — vehicle registration duty rates', url: 'https://www.qld.gov.au/transport/registration/fees/duty/rates' },
    { label: 'RevenueSA — stamp duty on vehicles', url: 'https://revenuesa.sa.gov.au/stamp-duty-vehicles/rates' },
    { label: 'WA — vehicle licence duty', url: 'https://www.wa.gov.au/organisation/department-of-treasury-and-finance/vehicle-licence-duty' },
    { label: 'SRO Tasmania — rates of duty', url: 'https://www.sro.tas.gov.au/motor-vehicle-duty/rates-of-duty' },
    { label: 'NT — stamp duty on motor vehicles (EV concession to 30 Jun 2027)', url: 'https://treasury.nt.gov.au/dtf/territory-revenue-office/stamp-duty-on-motor-vehicles' },
    { label: 'ACT — motor vehicle duty (emissions-based)', url: 'https://www.revenue.act.gov.au/motor-vehicle-duty' },
    { label: 'Canstar — car depreciation rates', url: 'https://www.canstar.com.au/car-insurance/car-depreciation-rates/' },
    { label: 'Canstar — average car insurance cost', url: 'https://www.canstar.com.au/car-insurance/what-does-car-insurance-cost/' },
    { label: 'Money.com.au — car loan rates (July 2026)', url: 'https://www.money.com.au/car-loans' },
    { label: 'NovatedLeaseAustralia — novated lease interest rates', url: 'https://www.novatedleaseaustralia.com.au/interest-rates' },
    { label: 'Finder — average home loan interest rate (July 2026)', url: 'https://www.finder.com.au/home-loans/the-average-home-loan-interest-rate' },
  ],
};
