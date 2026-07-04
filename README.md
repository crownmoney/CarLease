# Car Cost Compare — Australia 🇦🇺

A single-page tool that compares the **true cost of owning the same car** three ways:

1. **Buy outright** — cash, including what that cash stops earning,
2. **Car loan** — secured new-car finance with on-roads financed,
3. **Novated lease** — fully-maintained, salary-packaged through your employer.

All three paths end with you owning the car, and the same estimated resale value is
credited back — so the difference between the columns is purely what each path costs.

**No build step, no dependencies.** Open `index.html` in a browser, or serve the folder
with any static file server:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Run the unit tests with Node 18+:

```sh
node --test test/
```

## What's modelled

Figures are current for **FY 2026-27** (income tax) and the **FBT year ending
31 March 2027**, researched July 2026. Everything year-dependent lives in
[`js/data.js`](js/data.js) with source links, so an annual refresh is a one-file change.

| Area | Treatment |
|---|---|
| Income tax | FY 2026-27 resident brackets (0 / **15** / 30 / 37 / 45%), 2% Medicare levy with low-income phase-in, low income tax offset. Tax savings are computed as the *actual difference* in tax at your salary, so bracket boundaries are handled exactly. |
| FBT | 47% rate, statutory formula 20% of base value (GST-inclusive price excl. stamp duty & rego). The tool assumes FBT is neutralised with the **Employee Contribution Method** — 20% of base value paid from post-tax salary — which is how providers structure virtually all leases. |
| EV exemption | Battery EVs at or under the LCT fuel-efficient threshold ($91,661 for 2026-27, measured at first retail sale) are FBT-exempt → the whole package is pre-tax. PHEVs lost the exemption on 1 April 2025 and are treated as ordinary cars. RFBA reporting still applies (noted in the UI). |
| GST | The financier claims GST on the purchase, so the lease finances the GST-exclusive price (credit capped at **$6,353** = 1/11 of the $69,883 car limit). Employer input-tax credits make packaged running costs effectively GST-free (rego/CTP treated as GST-free). The end-of-lease **residual attracts 10% GST**. |
| Residuals | ATO minimum residual values (ID 2002/1004): 65.63% / 56.25% / 46.88% / 37.50% / 28.13% for 1–5 year terms, applied to the amount financed. |
| Stamp duty | Per-state schedules for all 8 states/territories, including QLD's hybrid/EV rates and the ACT's emissions-based system, with EV concessions current at July 2026. |
| Loan | Amortised monthly, on-roads + application fee financed, optional deposit and balloon, monthly account fee. Default 7.50% p.a. (representative secured new-car comparison rate, good credit, July 2026 — RBA cash rate 4.35%). |
| Lease finance | Default 9.50% p.a. effective (novated rates are quoted opaquely; typical effective range 8–12%), $475 establishment, $30/month management fee — typical of major providers. |
| Opportunity cost | Optional (on by default): buying outright forfeits interest on the cash, compounded at an editable savings/offset rate (default 4.5%). |
| Depreciation | Industry-average retention curve (editable — you can pin the resale value directly). |

### Deliberately out of scope

Forgone interest is applied to the upfront lump sum only (monthly repayment and
package streams are not separately discounted — turn the toggle off to compare pure
cash totals). Also out of scope: HELP/HECS repayment effects, Medicare levy surcharge, super interactions,
the one-third FBT base-value reduction after 4 FBT years (only relevant to leases
longer than ~5 years), business-use deductions (this is a **private-use** comparison),
insurance stamp duties, and luxury car tax on the purchase itself (enter the
drive-away price of the car you were actually quoted).

## Accuracy notes

- Every constant in `js/data.js` carries a comment with its source and effective date;
  the `sources` array at the bottom feeds the "Sources" list rendered in the UI.
- The engine (`js/calculator.js`) is pure and fully unit-tested (`test/calculator.test.js`),
  including spot checks against hand-computed tax and stamp-duty values.
- This is general information, not financial, tax or credit advice. Novated lease
  quotes vary widely between providers — always compare a real quote.

## Project layout

```
index.html            page shell & inputs
css/styles.css        design tokens (light/dark), layout, chart chrome
js/data.js            ★ all Australian figures, with sources — update yearly
js/calculator.js      pure calculation engine (importable in Node)
js/app.js             UI wiring, SVG charts, methodology notes
test/calculator.test.js
```
