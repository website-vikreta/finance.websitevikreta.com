/** Offline checks for the Indian financial year (1 April – 31 March) helpers that
 *  drive the dashboard "Income vs expenses" and reports "Monthly summary" dropdowns. */
import assert from "node:assert/strict";
import { financialYearLabel, financialYearStart } from "../period";
import { financialYear } from "../../invoices/math";

let passed = 0;
function ok(message: string): void {
  console.log(`  ✓ ${message}`);
  passed += 1;
}

function run(): void {
  // Label: FY beginning April 2026 prints "2026-27".
  assert.equal(financialYearLabel(2026), "2026-27");
  assert.equal(financialYearLabel(2024), "2024-25");
  assert.equal(financialYearLabel(2025), "2025-26");
  assert.equal(financialYearLabel(2030), "2030-31");
  ok("label: FY start years print as 2026-27 style short ranges");

  // Start: April–December dates stay in that calendar year's FY.
  assert.equal(financialYearStart("2026-12-10"), 2026);
  assert.equal(financialYearStart("2026-04-01"), 2026);
  assert.equal(financialYearStart("2026-10-29"), 2026);
  ok("start: Apr–Dec dates belong to the FY starting that year (12-Dec-2024 → 2024-25)");

  // January–March fall back to the previous FY start.
  assert.equal(financialYearStart("2024-12-10"), 2024);
  assert.equal(financialYearStart("2025-04-12"), 2025);
  assert.equal(financialYearStart("2027-01-15"), 2026);
  ok("start: Jan–Mar dates roll back one year (12-Apr-2025 → 2025-26, 15-Jan-2027 → 2026-27)");

  // Hard boundaries: the last day of March vs the first day of April.
  assert.equal(financialYearStart("2026-03-31"), 2025);
  assert.equal(financialYearStart("2026-04-01"), 2026);
  ok("boundary: 31-Mar closes the old FY, 1-Apr opens the new one");

  // The derived label always agrees with the invoice numbering helper.
  for (const date of ["2024-12-10", "2025-04-12", "2026-01-01", "2026-06-30", "2026-12-31", "2027-03-31"]) {
    assert.equal(financialYearLabel(financialYearStart(date)), financialYear(date), date);
  }
  ok("parity: labels match the invoice financialYear() for every sample date");

  // Dynamic dropdown behaviour: distinct FYs from mixed dates, newest (start year) first.
  const dates = ["2023-02-10", "2023-07-04", "2024-01-20", "2026-11-01"];
  const years = [...new Set(dates.map(financialYearStart))].sort((a, b) => b - a);
  assert.deepEqual(years, [2026, 2023, 2022]);
  assert.deepEqual(years.map(financialYearLabel), ["2026-27", "2023-24", "2022-23"]);
  assert.ok(years.includes(financialYearStart("2024-12-10")) === false, "label list keys on FY start, not the terminal year");
  ok("dynamic: one entry per touched FY, newest first — 2023-02 and 2023-07 both fold into 2022-23");

  console.log(`\nfiscal-year: ${passed} checks passed`);
}

run();
