/**
 * Offline checks for lib/chatbot/clarify.ts.
 * Run: npx tsx lib/chatbot/__tests__/clarify.ts
 */

import assert from "node:assert/strict";
import { detectContradiction, extractExplicitExchangeRate, normalizeClientName } from "../clarify";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// ── extractExplicitExchangeRate ──────────────────────────────────────────────
const rates: [string, number | null][] = [
  ["the exchange rate is 85 per dollar", 85],
  ["rate 88.50", 88.5],
  ["Received $100 from Acme today at a rate of 84.2", 84.2],
  ["85 per dollar", 85],
  ["85 rupees per usd", 85],
  ["86 INR/USD", 86],
  ["1 USD = 87 INR", 87],
  ["Received $500 from Acme today", null],
  ["500", null],
  ["paid 12,000 rupees for rent", null],
];
for (const [msg, want] of rates) check(`rate: ${msg}`, () => assert.equal(extractExplicitExchangeRate(msg), want));

// ── detectContradiction ──────────────────────────────────────────────────────
const contradictions: [string, string | null][] = [
  ["Received $50 or $60 from Acme", "original_amount"],
  ["got 500 or maybe 600 rupees", "original_amount"],
  ["it was today or yesterday", "txn_date"],
  ["not sure if income or expense", "type"],
  ["was it inr or usd", "original_currency"],
  ["not 50, 60", null],
  ["change 50 to 60", null],
  ["paid on 15/10 rs 500 for rent", null],
  ["Received $50 from Acme today", null],
  ["50 or 50", null],
];
for (const [msg, want] of contradictions) {
  check(`contradiction: ${msg}`, () => assert.equal(detectContradiction(msg)?.field ?? null, want));
}

// ── normalizeClientName ──────────────────────────────────────────────────────
const names: [string | null, string | null][] = [
  ["from the Reliance", "Reliance"],
  ["payment received from Tata Consultancy Services", "Tata Consultancy Services"],
  ["paid to Acme Technologies", "Acme Technologies"],
  ["the client is Zenith Inc.", "Zenith Inc."],
  ["it was from Boat", "Boat"],
  ['"Stripe"', "Stripe"],
  ["From Software", "From Software"],
  ["Acme.", "Acme"],
  ["from the", null],
  ["unknown", null],
  [null, null],
];
for (const [raw, want] of names) check(`name: ${raw}`, () => assert.equal(normalizeClientName(raw), want));

console.log(`Results: ${passed} passed, 0 failed`);
