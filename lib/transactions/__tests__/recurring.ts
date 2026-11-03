/** Run: npx tsx lib/transactions/__tests__/recurring.ts (offline, pure date helpers) */
import assert from "node:assert/strict";
import { advanceDue, applyPayment, billSchedule, calculateEndDate, daysUntil, parseMonths, remaining } from "../recurring-dates";

// Monthly keeps the anchor day and clamps short months
assert.equal(advanceDue("2026-01-31", 31), "2026-02-28");
assert.equal(advanceDue("2026-02-28", 31), "2026-03-31"); // back to 31, no drift
assert.equal(advanceDue("2026-04-30", 31), "2026-05-31");
assert.equal(advanceDue("2026-12-05", 5), "2027-01-05"); // year rollover
assert.equal(advanceDue("2027-01-31", 30), "2027-02-28");
assert.equal(advanceDue("2028-01-30", 30), "2028-02-29"); // leap year

// calculateEndDate
assert.equal(calculateEndDate("2026-10-16", 1, 16), "2026-10-16");
assert.equal(calculateEndDate("2026-10-16", 3, 16), "2026-12-16");
assert.equal(calculateEndDate("2026-10-16", 6, 16), "2027-03-16");
assert.equal(calculateEndDate("2026-01-31", 3, 31), "2026-03-31");

// Custom duration must be a whole number of months, 1–60
assert.equal(parseMonths("12"), 12);
assert.equal(parseMonths(" 3 "), 3);
for (const bad of ["", "0", "61", "2.5", "-1", "abc"]) assert.equal(parseMonths(bad), null, bad);

assert.equal(daysUntil("2026-10-20", "2026-10-16"), 4);
assert.equal(daysUntil("2026-10-14", "2026-10-16"), -2);
assert.equal(daysUntil("2026-10-16", "2026-10-16"), 0);

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
// Schedule: 3-month bill on the 31st, first month paid, second part-paid
const s3 = billSchedule({ firstDue: "2026-01-31", anchorDay: 31, nextDue: "2026-02-28", endDate: "2026-03-31", paid: 100 }, "2026-03-05");
assert.deepEqual(s3, [
  { due: "2026-01-31", status: "paid" },
  { due: "2026-02-28", status: "part_paid" },
  { due: "2026-03-31", status: "upcoming" },
]);
// Ongoing, overdue: stops at the open month
assert.deepEqual(
  billSchedule({ firstDue: "2026-09-10", anchorDay: 10, nextDue: "2026-10-10", endDate: null, paid: 0 }, "2026-10-16").map((m) => m.status),
  ["paid", "overdue"],
);
// Completed bill: next_due is past the end, every month paid
assert.deepEqual(
  billSchedule({ firstDue: "2026-01-15", anchorDay: 15, nextDue: "2026-03-15", endDate: "2026-02-15", paid: 0 }, "2026-10-16").map((m) => m.status),
  ["paid", "paid"],
);
console.log("recurring ok");
