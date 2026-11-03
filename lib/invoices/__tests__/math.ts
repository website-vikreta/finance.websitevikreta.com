/** Run: npx tsx lib/invoices/__tests__/math.ts (offline) */
import assert from "node:assert/strict";
import { amountInWords, balanceOf, computeTotals, displayStatus, financialYear, invoiceNumber, taxTypeFor } from "../math";

// Tax type
assert.equal(taxTypeFor("27", { country: "India", state: "27" }), "cgst_sgst");
assert.equal(taxTypeFor("27", { country: "India", state: "29" }), "igst");
assert.equal(taxTypeFor("27", { country: "USA", state: null }), "none");
assert.equal(taxTypeFor("27", { country: " india ", state: null }), "igst"); // unknown state → IGST, never silently none

// Totals: 2 × 25,000 + 1 × 899.50 = 50,899.50; 18% = 9,161.91 (9161.91 exact: 50899.50 × 0.18 = 9161.91)
let t = computeTotals([{ quantity: "2", rate: "25000" }, { quantity: "1", rate: "899.50" }], "18", "cgst_sgst");
assert.deepEqual(t.lines, ["50000.00", "899.50"]);
assert.equal(t.subtotal, "50899.50");
assert.equal(t.tax, "9161.91");
assert.equal(Number(t.cgst) + Number(t.sgst), 9161.91);
assert.equal(t.cgst, "4580.96"); // odd paisa goes to CGST
assert.equal(t.sgst, "4580.95");
assert.equal(t.igst, "0.00");
assert.equal(t.total, "60061.41");

// IGST and no-GST
t = computeTotals([{ quantity: "1", rate: "1000" }], "18", "igst");
assert.equal(t.igst, "180.00");
assert.equal(t.total, "1180.00");
t = computeTotals([{ quantity: "3", rate: "500" }], "18", "none");
assert.equal(t.tax, "0.00");
assert.equal(t.total, "1500.00");

// Fractional quantity rounds half-even to the paisa: 1.5 × 33.33 = 49.995 → 50.00 (half-even on 4999.5 → 5000)
t = computeTotals([{ quantity: "1.5", rate: "33.33" }], "0", "none");
assert.equal(t.lines[0], "50.00");
assert.throws(() => computeTotals([{ quantity: "1", rate: "10.555" }], "18", "igst")); // >2 decimals rejected

// Financial year + numbering
assert.equal(financialYear("2026-10-16"), "2026-27");
assert.equal(financialYear("2027-03-31"), "2026-27");
assert.equal(financialYear("2027-04-01"), "2027-28");
assert.equal(financialYear("2099-06-01"), "2099-00");
assert.equal(invoiceNumber("WV", "2026-27", 7), "WV/2026-27/007");
assert.equal(invoiceNumber("WV", "2026-27", 1234), "WV/2026-27/1234");

// Amount in words
assert.equal(amountInWords("60061.41", "INR"), "Rupees Sixty Thousand Sixty One and Forty One Paise Only");
assert.equal(amountInWords("1250000.00", "INR"), "Rupees Twelve Lakh Fifty Thousand Only");
assert.equal(amountInWords("23456789.00", "INR"), "Rupees Two Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only");
assert.equal(amountInWords("1180.00", "INR"), "Rupees One Thousand One Hundred Eighty Only");
assert.equal(amountInWords("2500.50", "USD"), "US Dollars Two Thousand Five Hundred and Fifty Cents Only");
assert.equal(amountInWords("1250000.00", "USD"), "US Dollars One Million Two Hundred Fifty Thousand Only");
// Status + balance
const base = { status: "sent", total: "1180.00", paid: "0.00", dueDate: "2026-10-20" };
assert.equal(displayStatus({ ...base, status: "draft" }, "2026-10-16"), "draft");
assert.equal(displayStatus({ ...base, status: "void" }, "2026-10-16"), "void");
assert.equal(displayStatus(base, "2026-10-16"), "sent");
assert.equal(displayStatus({ ...base, paid: "500.00" }, "2026-10-16"), "partial");
assert.equal(displayStatus({ ...base, paid: "500.00" }, "2026-10-21"), "overdue");
assert.equal(displayStatus({ ...base, paid: "1180.00" }, "2026-10-30"), "paid");
assert.equal(displayStatus(base, "2026-10-20"), "sent"); // due today is not overdue
assert.equal(balanceOf("1180.00", "500.00"), "680.00");
assert.equal(balanceOf("1180.00", "1200.00"), "0.00");
console.log("invoice math ok");
