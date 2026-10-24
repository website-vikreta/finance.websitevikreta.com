/**
 * Offline regression for Business Description (staging + persistence mapping).
 *
 * Synthetic narrations only — no real statement text, names, or references.
 * Run: tsx lib/bank-import/__tests__/business-description.ts
 *
 * Covers the defect where parsed descriptions were dropped by the upload
 * insert mapping, so every newly uploaded statement stored NULL.
 */
import assert from "node:assert/strict";
import { parseStatementText } from "../parse";
import { statementLineValues } from "../persistence";
import { generateBusinessDescription } from "../business-description";
import { parseReviewLinePatch } from "../review";
import { classifyLine } from "../classify";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── Deterministic rules on synthetic narrations ──────────────────────────────
{
  const rule = (narration: string, direction: "deposit" | "withdrawal") => {
    const classification = classifyLine(direction, narration);
    return generateBusinessDescription({
      narration,
      reference: "SYNTH-REF",
      withdrawalAmount: direction === "withdrawal" ? "1000.00" : null,
      depositAmount: direction === "deposit" ? "1000.00" : null,
      direction,
      classification: classification.classification,
      flags: classification.flags,
    });
  };

  const merchant = rule("GITHUB 0123 CARD hold", "withdrawal");
  assert.equal(merchant.description, "Payment to GitHub by card");
  assert.ok(merchant.confident && !merchant.requiresReview);
  ok("recognized software merchant gains a confident description");

  const charge = rule("DEBIT CARD PRORATA FEE 01APR26", "withdrawal");
  assert.equal(charge.description, "Debit card fee");
  assert.equal(charge.suggestedCategory, "Other");
  ok("bank service charge maps to a neutral charge description");

  const incoming = rule("NEFT CR PAYMENT ESCROW WEBSITE VIKRETA", "deposit");
  assert.ok(incoming.description.startsWith("Money received via NEFT through Payment Escrow"));
  assert.ok(incoming.requiresReview, "incoming transfer must stay review-required");
  ok("incoming transfer is described neutrally and stays review-required");

  const unknown = rule("NAUSLAJUKF HOLD 991022", "withdrawal");
  assert.ok(unknown.requiresReview);
  assert.equal(unknown.description, "Card payment — merchant and purpose require review");
  ok("unknown merchant never gets an invented purpose");
}

// ── Parse flow: rule output lands on parsed rows ─────────────────────────────
{
  const header =
    "Date\tValue Date\tNarration\tChq./Ref.No.\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance";
  const parsed = parseStatementText(
    [
      "PAGES 1",
      header,
      "01/04/26\t01/04/26\tGITHUB 0123 CARD hold\t\t500.00\t\t9500.00",
      "02/04/26\t02/04/26\tDEBIT CARD PRORATA FEE 01APR26\t\t35.00\t\t9465.00",
      "03/04/26\t03/04/26\tNEFT CR PAYMENT ESCROW WEBSITE VIKRETA\t\t\t9000.00\t18465.00",
      "04/04/26\t04/04/26\tNAUSLAJUKF HOLD 991022\t\t25.00\t\t18440.00",
    ].join("\n"),
  );
  const lines = parsed.lines.filter((line) => line.status === "ready" || line.narration);
  assert.equal(lines.length, 4);
  for (const line of lines) {
    assert.ok(line.businessDescription, "every parsed row must carry a description");
    assert.equal(line.reference, null, "source fields stay untouched");
  }
  assert.equal(lines[0].businessDescription, "Payment to GitHub by card");
  assert.equal(lines[1].businessDescription, "Debit card fee");
  assert.ok(lines[2].businessDescription?.startsWith("Money received via NEFT through Payment Escrow"));
  assert.equal(lines[3].businessDescription, "Card payment — merchant and purpose require review");
  ok("parser generated descriptions for all four synthetic rows");
}

// ── Persistence insert mapping ───────────────────────────────────────────────
{
  const header =
    "Date\tValue Date\tNarration\tChq./Ref.No.\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance";
  const parsed = parseStatementText(
    ["PAGES 1", header, "01/04/26\t01/04/26\tGITHUB 0123 CARD hold\t\t500.00\t\t9500.00"].join("\n"),
  );
  const [line] = parsed.lines.filter((l) => l.narration);
  const values = statementLineValues("00000000-0000-4000-8000-000000000000", line);
  assert.ok(values.businessDescription === line.businessDescription, "insert mapping must carry the description");
  assert.equal(values.narration, line.narration, "narration is preserved unchanged");
  assert.equal(values.reference, line.reference);
  assert.equal(values.withdrawalAmount, line.withdrawalAmount);
  assert.equal(values.depositAmount, line.depositAmount);
  assert.equal(values.fingerprint, line.fingerprint);
  assert.equal(values.flags, line.flags);
  assert.equal(values.status, line.status);
  ok("upload insert mapping persists businessDescription with source fields untouched");

  const empty = statementLineValues("00000000-0000-4000-8000-000000000000", {
    ...line,
    businessDescription: undefined,
  });
  assert.equal(empty.businessDescription, null, "a missing description inserts as NULL, never a guess");
  ok("missing description maps to a safe NULL instead of invented text");
}

// ── Reviewer edits: patch shape, length, clear, and separate from narration ──
{
  const edited = parseReviewLinePatch({
    businessDescription: "  Cap protection payment for our own domain  ",
  });
  assert.ok(edited.ok);
  assert.equal(edited.value.businessDescription, "Cap protection payment for our own domain");
  ok("a reviewer edit parses and is trimmed, kept separate from narration");

  const tooLong = parseReviewLinePatch({ businessDescription: "x".repeat(501) });
  assert.ok(!tooLong.ok);
  ok("an overlong reviewer edit is rejected");

  const cleared = parseReviewLinePatch({ businessDescription: null });
  assert.ok(cleared.ok && cleared.value.businessDescription === null);
  ok("a reviewer can clear the description explicitly");
}

console.log(`business-description: ${passed} checks passed`);
if (passed < 9) {
  console.error("unexpected check count; investigate");
  process.exit(1);
}
