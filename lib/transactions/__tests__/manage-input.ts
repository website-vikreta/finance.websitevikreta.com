/**
 * Offline checks for toDraft (lib/transactions/manage.ts): the server-side validation of
 * manual-entry form input, which arrives untrusted from the browser. No DB queries.
 * Run: npx tsx lib/transactions/__tests__/manage-input.ts
 */

import assert from "node:assert/strict";
import { toDraft } from "../manage";
import { pool } from "@/lib/db";

const base = { type: "expense", amount: 500, currency: "INR", rate: null, client: null, description: "Office rent", date: "2026-10-12" };
let passed = 0;
const ok = (input: unknown, check: (d: Extract<ReturnType<typeof toDraft>, { ok: true }>) => void) => {
  const r = toDraft(input);
  assert.ok(r.ok, `expected ok for ${JSON.stringify(input)}: ${!r.ok && r.error}`);
  check(r);
  passed++;
};
const bad = (input: unknown, contains: string) => {
  const r = toDraft(input);
  assert.ok(!r.ok && r.error.includes(contains), `expected "${contains}" for ${JSON.stringify(input)}, got ${JSON.stringify(r)}`);
  passed++;
};

ok(base, (r) => {
  assert.equal(r.draft.expense_description, "Office rent");
  assert.equal(r.draft.client_name, null);
  assert.equal(r.rate, null);
});
ok({ ...base, type: "income", client: "  Boat  ", description: "ignored" }, (r) => {
  assert.equal(r.draft.client_name, "Boat");
  assert.equal(r.draft.expense_description, null);
});
ok({ ...base, currency: "USD", rate: 88.5 }, (r) => assert.equal(r.rate, 88.5));
ok({ ...base, currency: "INR", rate: 88.5 }, (r) => assert.equal(r.rate, null)); // rate ignored for INR
ok({ ...base, description: "x".repeat(500) }, (r) => assert.equal(r.draft.expense_description?.length, 200));

bad({ ...base, type: "transfer" }, "money in or money out");
bad({ ...base, amount: 0 }, "greater than zero");
bad({ ...base, amount: -5 }, "greater than zero");
bad({ ...base, amount: "500" }, "greater than zero"); // strings are not numbers
bad({ ...base, amount: Number.NaN }, "greater than zero");
bad({ ...base, currency: "EUR" }, "INR or USD");
bad({ ...base, currency: "USD", rate: null }, "rate");
bad({ ...base, currency: "USD", rate: -1 }, "rate");
bad({ ...base, date: "12/10/2026" }, "date");
bad({ ...base, date: "2026-13-45" }, "date");
bad({ ...base, description: "   " }, "expense for");
bad({ ...base, type: "income", client: "" }, "client");
bad(null, "money in or money out");

console.log(`Results: ${passed} passed, 0 failed`);
void pool.end();
