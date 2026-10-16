/** Run: npx tsx lib/transactions/__tests__/recurring.ts (offline, pure date helpers) */
import assert from "node:assert/strict";
import { advanceDue, applyPayment, daysUntil, monthlyShare, remaining } from "../recurring-dates";

// Monthly keeps the anchor day and clamps short months
assert.equal(advanceDue("2026-01-31", "monthly", 31), "2026-02-28");
assert.equal(advanceDue("2026-02-28", "monthly", 31), "2026-03-31"); // back to 31, no drift
assert.equal(advanceDue("2026-04-30", "monthly", 31), "2026-05-31");
assert.equal(advanceDue("2026-12-05", "monthly", 5), "2027-01-05"); // year rollover
assert.equal(advanceDue("2027-01-31", "monthly", 30), "2027-02-28");
assert.equal(advanceDue("2028-01-30", "monthly", 30), "2028-02-29"); // leap year
// Yearly
assert.equal(advanceDue("2026-04-01", "yearly", 1), "2027-04-01");
assert.equal(advanceDue("2028-02-29", "yearly", 29), "2029-02-28");

assert.equal(daysUntil("2026-10-20", "2026-10-16"), 4);
assert.equal(daysUntil("2026-10-14", "2026-10-16"), -2);
assert.equal(daysUntil("2026-10-16", "2026-10-16"), 0);

assert.equal(monthlyShare({ amount: 1200, frequency: "yearly" }), 100);
assert.equal(monthlyShare({ amount: 500, frequency: "monthly" }), 500);
// Part payments
const rent = { amount: 70000, paid: 0, currency: "INR" };
assert.deepEqual(applyPayment(rent, { amount: 12000, currency: "INR" }, "partial"), { settled: false, paid: 12000 });
assert.deepEqual(applyPayment({ ...rent, paid: 12000 }, { amount: 58000, currency: "INR" }, "partial"), { settled: true, paid: 0 });
assert.deepEqual(applyPayment({ ...rent, paid: 12000 }, { amount: 60000, currency: "INR" }, "partial"), { settled: true, paid: 0 }); // overpay settles
assert.deepEqual(applyPayment(rent, { amount: 12000, currency: "INR" }, "full"), { settled: true, paid: 0 }); // lower bill this month
assert.deepEqual(applyPayment(rent, { amount: 150, currency: "USD" }, "partial"), { settled: true, paid: 0 }); // other currency can't be compared
assert.deepEqual(applyPayment({ amount: 0.3, paid: 0.1, currency: "USD" }, { amount: 0.2, currency: "USD" }, "partial"), { settled: true, paid: 0 }); // no float drift
assert.equal(remaining({ amount: 70000, paid: 12000 }), 58000);
assert.equal(remaining({ amount: 0.3, paid: 0.1 }), 0.2);
console.log("recurring ok");
