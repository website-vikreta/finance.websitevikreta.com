/** Run: npx tsx lib/chatbot/__tests__/ask.ts (offline: formatAnswer + looksLikeQuestion only) */
import assert from "node:assert/strict";
import { formatAnswer, looksLikeQuestion, readableLabel } from "../ask";

for (const m of ["how much did we spend this month?", "October ka kitna kharcha hua", "total income this FY", "who paid us in September"]) assert.ok(looksLikeQuestion(m), m);
for (const m of ["Paid ₹500 for rent today", "Acme paid $500 for design work", "500"]) assert.ok(!looksLikeQuestion(m), m);

const q = { metric: "expense" as const, from: "2026-10-01", to: "2026-10-16", label: "this month", search: null };
const s = { income: 581900, expense: 117099, incomeCount: 4, expenseCount: 5, top: [
  { type: "expense" as const, name: "Office rent", amount: 70000 },
  { type: "expense" as const, name: "Cloud servers", amount: 44000 },
  { type: "income" as const, name: "Acme", amount: 500000 },
  { type: "expense" as const, name: "Tea", amount: 3099 },
  { type: "expense" as const, name: "Pens", amount: 0 },
] };
assert.equal(formatAnswer(q, s), "You spent ₹1,17,099 this month, across 5 transactions. Biggest: Office rent ₹70,000, Cloud servers ₹44,000, Tea ₹3,099.");
assert.equal(formatAnswer({ ...q, metric: "net" }, s), "This month: money in ₹5,81,900, money out ₹1,17,099, net ₹4,64,801.");
assert.equal(formatAnswer({ ...q, metric: "income", search: "Tata" }, { ...s, income: 0, incomeCount: 0 }), "No income recorded for “Tata” this month.");
assert.equal(formatAnswer({ ...q, metric: "net" }, { ...s, income: 100, expense: 300 }), "This month: money in ₹100, money out ₹300, net -₹200.");
assert.equal(readableLabel("October 2026"), "in October 2026");
assert.equal(readableLabel("this month"), "this month");
assert.equal(readableLabel("last 7 days"), "last 7 days");
assert.equal(readableLabel(""), "in that period");
console.log("ask ok");
