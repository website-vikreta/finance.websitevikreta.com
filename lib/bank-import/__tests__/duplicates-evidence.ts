/**
 * Offline regression tests for the source-aware duplicate evidence rules and
 * the completed-statement Business Description display.
 *
 * Everything here is pure — no database. The strict transaction identity
 * (exact date, exact direction, exact minor-unit amount, INR) is enforced by
 * SQL in `duplicates.ts`/`import.ts` and stays DB-verified; these tests pin
 * the deterministic evidence decisions ON TOP of agreed identity, the badge
 * vocabulary, the ambiguity fold, the import gate and the review decisions.
 *
 * Run: tsx lib/bank-import/__tests__/duplicates-evidence.ts
 */
import assert from "node:assert/strict";
import {
  ALREADY_IMPORTED_LABEL,
  compareBusinessTexts,
  evaluateTransactionCandidate,
  importDuplicateBlockError,
  meaningfulTokens,
  normalizeBusinessText,
  resolveAmbiguousCandidates,
  sourceBadgeLabel,
  stagingBadgeLabel,
  transactionBadgeLabel,
  type TransactionCandidateEvidence,
} from "../duplicate-evidence";
import { stagingCanonicalMatchKey } from "../duplicates";
import { businessDescriptionText } from "../../../components/bank-import/statement-detail";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const LONG_NARRATION =
  "Money received from INDB0000006 PAYMENT ESCROW INC W WEBSITE VIKRETA INDBH29043154405 — payment purpose to confirm";
const SHORT_LEDGER_DESCRIPTION = "Money received from Payment Escrow";

interface CandidateOverrides {
  lineBusinessDescription?: string | null;
  lineNarration?: string | null;
  lineClientId?: string | null;
  lineCategoryId?: number | null;
  lineDirection?: "deposit" | "withdrawal";
  transaction?: Partial<{
    source: string | null;
    description: string | null;
    clientNameSnapshot: string | null;
    clientName: string | null;
    clientId: string | null;
    categoryId: number | null;
    txnDate: string | null;
    originFileName: string | null;
    originStatementFrom: string | null;
    originStatementTo: string | null;
  }>;
}

function candidate(overrides: CandidateOverrides = {}): TransactionCandidateEvidence {
  return evaluateTransactionCandidate({
    lineBusinessDescription: overrides.lineBusinessDescription ?? SHORT_LEDGER_DESCRIPTION,
    lineNarration: overrides.lineNarration ?? null,
    lineClientId: overrides.lineClientId ?? null,
    lineCategoryId: overrides.lineCategoryId ?? null,
    lineDirection: overrides.lineDirection ?? "deposit",
    transaction: {
      source: "manual",
      description: SHORT_LEDGER_DESCRIPTION,
      clientNameSnapshot: null,
      clientName: null,
      clientId: null,
      categoryId: null,
      txnDate: "2026-04-11",
      originFileName: null,
      originStatementFrom: null,
      originStatementTo: null,
      ...overrides.transaction,
    },
  });
}

// ── §2/§10.1–10.3 Source labels ──────────────────────────────────────────────
{
  assert.equal(sourceBadgeLabel("manual"), "Manual Entry");
  assert.equal(sourceBadgeLabel("chatbot"), "Finance AI");
  assert.equal(sourceBadgeLabel("bank_import"), "Bank Statement Import");
  assert.equal(sourceBadgeLabel("mystery_source"), "Other Source");
  assert.equal(sourceBadgeLabel(null), "Other Source");
  ok("stored source values map to friendly labels; unknown values fall back safely");
}

{
  const manual = candidate();
  assert.equal(manual.label, "Duplicate · Manual Entry · 2026-04-11");
  assert.equal(manual.severity, "strong");
  assert.equal(manual.when, "2026-04-11");
  ok("a matching manual ledger entry flags 'Duplicate · Manual Entry · date'");
}

{
  const chatbot = candidate({ transaction: { source: "chatbot" } });
  assert.equal(chatbot.label, "Duplicate · Finance AI · 2026-04-11");
  assert.equal(chatbot.severity, "strong");
  ok("a matching Finance AI entry flags 'Duplicate · Finance AI · date'");
}

{
  const previous = candidate({
    transaction: {
      source: "bank_import",
      originFileName: "april-statement.pdf",
      originStatementFrom: "2026-04-01",
      originStatementTo: "2026-04-30",
    },
  });
  assert.equal(previous.label, "Duplicate · Previous Statement · 2026-04-11");
  assert.equal(previous.severity, "strong");
  assert.ok(previous.detail.includes("april-statement.pdf"));
  assert.ok(previous.detail.includes("1 Apr 2026 → 30 Apr 2026"));
  // Safe-detail guarantee: narration/reference text never leaks into labels or details.
  assert.ok(!previous.detail.includes("INDBH29043154405"));
  assert.ok(!previous.label.includes("ESCROW"));
  ok("a bank-import duplicate shows the earlier statement identity, never narration");
}

// ── §5/§10.4 Staging situations ──────────────────────────────────────────────
{
  assert.equal(
    stagingBadgeLabel("same_statement_row", "2026-04-11"),
    "Duplicate Candidate · Same Statement · 2026-04-11",
  );
  assert.equal(
    stagingBadgeLabel("other_statement_row", "2026-04-10"),
    "Duplicate Candidate · Earlier Statement · 2026-04-10",
  );
  assert.equal(
    stagingBadgeLabel("imported_before", "2026-04-10"),
    "Duplicate · Previous Statement · 2026-04-10",
  );
  ok("staging candidates distinguish same-statement vs earlier statements vs imported rows");
}

{
  assert.equal(ALREADY_IMPORTED_LABEL, "Already Imported · This Statement");
  ok("the line's own live import renders 'Already Imported · This Statement'");
}

// ── §4 Business-text normalization and matching ─────────────────────────────
{
  assert.deepEqual(meaningfulTokens({ value: LONG_NARRATION }), [
    "money",
    "received",
    "payment",
    "escrow",
  ]);
  ok(
    "normalization strips IFSC/UTR fragments, rails, legal suffixes, self-name and boilerplate tails",
  );

  assert.equal(compareBusinessTexts(LONG_NARRATION, SHORT_LEDGER_DESCRIPTION), "strong");
  assert.equal(compareBusinessTexts("Payment Escrow received.", SHORT_LEDGER_DESCRIPTION), "strong");
  ok("the long generated description matches the shorter approved one (containment)");
}

{
  assert.equal(
    normalizeBusinessText({
      value: "Money received from Payment Escrow — payment purpose to confirm",
    }),
    "money received from payment escrow",
  );
  assert.equal(normalizeBusinessText({ value: null }), "");
  assert.equal(transactionBadgeLabel({ source: null, when: null, severity: "possible" }), "Possible dup · Other Source");
  ok("normalization and label builders behave deterministically on edge inputs");
}

{
  assert.equal(
    compareBusinessTexts("  PAYMENT    escrow   received!!", "payment escrow received"),
    "strong",
  );
  assert.equal(
    compareBusinessTexts("Money — received… from Payment Escrow.", SHORT_LEDGER_DESCRIPTION),
    "strong",
  );
  ok("casing, punctuation and whitespace differences never break a valid match");
}

// ── §4/§10.9 Different merchants with the same amount and date ──────────────
{
  assert.equal(
    compareBusinessTexts("Money received from Client Alpha", "Money received from Client Beta"),
    "none",
  );
  const advisory = candidate({
    lineBusinessDescription: "Money received from Client Alpha",
    transaction: { description: "Money received from Client Beta" },
  });
  assert.equal(advisory.severity, "possible");
  assert.match(advisory.label, /^Possible dup · /);
  assert.equal(importDuplicateBlockError([advisory], []), null);
  ok("same amount, date and direction but different wording stays an advisory, not a duplicate");
}

// ── Strict identity is a precondition (§10.10–10.12) ────────────────────────
{
  // Different dates: the canonical staging key never merges them, and SQL
  // ledger candidates match only on t.txn_date = l.txn_date.
  const base = {
    reference: "REF-1",
    withdrawalAmount: null,
    depositAmount: "500.00",
  };
  const dayA = stagingCanonicalMatchKey({ ...base, txnDate: "2026-04-10" });
  const dayB = stagingCanonicalMatchKey({ ...base, txnDate: "2026-04-11" });
  assert.ok(dayA && dayB && dayA !== dayB);
  ok("similar descriptions on different days are different transactions (exact-date rule)");

  const amountA = stagingCanonicalMatchKey({
    txnDate: "2026-04-11",
    reference: "REF-1",
    withdrawalAmount: null,
    depositAmount: "500.00",
  });
  const amountB = stagingCanonicalMatchKey({
    txnDate: "2026-04-11",
    reference: "REF-1",
    withdrawalAmount: null,
    depositAmount: "500.01",
  });
  assert.ok(amountA && amountB && amountA !== amountB);
  ok("similar amounts but different exact values are different transactions");

  const out = stagingCanonicalMatchKey({
    txnDate: "2026-04-11",
    reference: "REF-1",
    withdrawalAmount: "500.00",
    depositAmount: null,
  });
  assert.ok(out && out !== amountA);
  ok("an opposite direction for the same magnitude is a different transaction");
}

// ── §4/§10.13 Conflicting client mapping → review ───────────────────────────
{
  const conflicted = candidate({
    lineClientId: "11111111-1111-1111-1111-111111111111",
    transaction: { clientId: "22222222-2222-2222-2222-222222222222" },
  });
  assert.equal(conflicted.severity, "review");
  assert.equal(conflicted.label, "Duplicate? · Needs review · Manual Entry · 2026-04-11");
  const blocked = importDuplicateBlockError([conflicted], []);
  assert.ok(blocked);
  assert.ok(blocked.includes("Needs review"));
  ok("a conflicting client mapping surfaces a review decision instead of confirming");
}

// ── §4/§10.14 Category evidence corroborates but never decides alone ────────
{
  // Category alone with no wording agreement (different merchants):
  const categoryOnly = candidate({
    lineBusinessDescription: "Office rent to Landmark Estates",
    lineCategoryId: 7,
    lineDirection: "withdrawal",
    transaction: { description: "Courier charges to Speedex", categoryId: 7 },
  });
  assert.equal(categoryOnly.severity, "possible");
  assert.equal(importDuplicateBlockError([categoryOnly], []), null);

  // Moderate wording (overlapping generic tokens) + agreeing category → confirmed:
  const moderatePair = (categoryId: number | null) =>
    candidate({
      lineBusinessDescription: "Tax bill fee service june",
      lineCategoryId: categoryId,
      lineDirection: "withdrawal",
      transaction: { description: "Tax bill fee", categoryId },
    });
  assert.equal(compareBusinessTexts("Tax bill fee service june", "Tax bill fee"), "moderate");
  assert.equal(moderatePair(7).severity, "strong");
  assert.notEqual(importDuplicateBlockError([moderatePair(7)], []), null);
  ok("expense category corroborates a wording match but cannot establish one alone");

  // Moderate wording WITHOUT any mapping → advisory, revisit after mapping:
  const unmapped = moderatePair(null);
  assert.equal(unmapped.severity, "possible");
  ok("moderate wording without client/category corroboration stays an advisory");
}

// ── §6/§10.15–10.17 Reviewer edits recalculate the evidence ─────────────────
{
  // Before the edit: only the raw narration exists, whose meaningful tokens
  // (money received payment escrow) and the ledger entry's wording differ on
  // both sides — an advisory at best.
  const before = candidate({
    lineBusinessDescription: null,
    lineNarration: LONG_NARRATION,
    transaction: { description: "Client Alpha receipt escrow" },
  });
  assert.equal(before.severity, "possible");

  // After the edit: the approved description's tokens are contained in the
  // ledger entry's wording → confirmed duplicate.
  const after = candidate({
    lineBusinessDescription: "Money received from Client Alpha",
    lineNarration: LONG_NARRATION,
    transaction: { description: "Money received from Client Alpha receipt" },
  });
  assert.equal(after.severity, "strong");
  assert.notEqual(importDuplicateBlockError([after], []), null);
  ok("saving a reviewer-approved description upgrades the recalculated match");
}

{
  // Client selection recalculates: unmapped → advisory, same client → confirmed.
  const unmapped = candidate({
    lineBusinessDescription: "Tax bill fee service june",
    lineClientId: null,
    transaction: { description: "Tax bill fee", clientId: "33333333-3333-3333-3333-333333333333" },
  });
  assert.equal(unmapped.severity, "possible");
  const mapped = candidate({
    lineBusinessDescription: "Tax bill fee service june",
    lineClientId: "33333333-3333-3333-3333-333333333333",
    transaction: { description: "Tax bill fee", clientId: "33333333-3333-3333-3333-333333333333" },
  });
  assert.equal(mapped.severity, "strong");
  ok("choosing the client the ledger entry belongs to strengthens an overlapping match");
}

// ── §6/§10.18 Approved descriptions never change through matching ───────────
{
  const reviewed = "Money received from Payment Escrow";
  const first = candidate({ lineBusinessDescription: reviewed });
  const second = candidate({ lineBusinessDescription: reviewed });
  assert.deepEqual(first, second);
  // The evidence text describes the match; it never quotes the description.
  assert.equal(first.detail.includes(reviewed), false);
  ok("an acknowledged row imports while the approved description text stays untouched");
}

// ── §10.19 Missing descriptions are handled safely ──────────────────────────
{
  const noText = candidate({
    lineBusinessDescription: null,
    lineNarration: null,
    transaction: { description: null },
  });
  assert.equal(noText.severity, "possible");
  assert.equal(importDuplicateBlockError([noText], []), null);

  // Income fallback: the ledger entry may only carry a client-name snapshot.
  const snapshot = candidate({
    lineBusinessDescription: null,
    lineNarration: LONG_NARRATION,
    transaction: { description: null, clientNameSnapshot: "Payment Escrow Inc" },
  });
  assert.equal(snapshot.severity, "strong");
  ok("missing descriptions degrade to advisories; client-name fallback still weighs income");
}

// ── §7/§10.20–10.22 Import gates, per-row reasons, bulk independence ────────
{
  const strong = candidate();
  const error = importDuplicateBlockError([strong], []);
  assert.ok(error);
  assert.ok(error.includes("Duplicate · Manual Entry · 2026-04-11"));
  assert.ok(error.includes("Not a duplicate"));

  const reviewBlocked = importDuplicateBlockError(
    [
      candidate({
        lineBusinessDescription: "Rent to Landmark Estates monthly",
        transaction: { description: "Rent to Landmark Estates monthly" },
        lineCategoryId: 7,
        lineDirection: "withdrawal",
      }),
      candidate({
        lineBusinessDescription: SHORT_LEDGER_DESCRIPTION,
        lineClientId: "11111111-1111-1111-1111-111111111111",
        transaction: { clientId: "22222222-2222-2222-2222-222222222222" },
      }),
    ],
    [],
  );
  assert.ok(reviewBlocked);
  ok("strong and needs-review evidence both block the row and name the recorded source");

  const independent = [
    candidate(), // line 1: strong duplicate → blocked
    candidate({
      lineBusinessDescription: "Money received from Client Alpha different deal",
      transaction: { description: "Money received from Client Beta" },
    }), // line 2: advisory → allowed
  ];
  assert.notEqual(importDuplicateBlockError([independent[0]], []), null);
  assert.equal(importDuplicateBlockError([independent[1]], []), null);
  ok("one duplicate row never blocks independent valid rows (per-row decision)");
}

// ── §4/§10 Ambiguity fold and the override decision ─────────────────────────
{
  const a = candidate({
    transaction: { txnDate: "2026-04-11", description: SHORT_LEDGER_DESCRIPTION },
  });
  const b = candidate({
    transaction: { txnDate: "2026-04-11", description: SHORT_LEDGER_DESCRIPTION },
  });
  const folded = resolveAmbiguousCandidates([a, b]);
  assert.equal(folded.length, 2);
  for (const entry of folded) {
    assert.equal(entry.severity, "review");
    assert.match(entry.label, /^Duplicate\? · Needs review · Manual Entry · 2026-04-11/);
    assert.ok(entry.detail.includes("More than one recorded transaction"));
  }
  assert.notEqual(importDuplicateBlockError(folded, []), null);
  ok("equally strong matches all become needs-review and block until the reviewer decides");

  const single = resolveAmbiguousCandidates([candidate()]);
  assert.equal(single[0].severity, "strong");
  ok("a single strong candidate is never downgraded by the ambiguity fold");

  // The acknowledged line lifts the block even with (folded) strong evidence.
  const ambiguous = resolveAmbiguousCandidates([a, b]);
  assert.equal(
    importDuplicateBlockError(ambiguous, ["NOT_A_DUPLICATE"]),
    null,
  );
  ok("the reviewer's Not-a-duplicate decision lifts the import block for that line only");
}

// ── §8/§10.26–10.29 Completed-statement Business Description column ─────────
{
  assert.equal(businessDescriptionText({ businessDescription: "Saved by reviewer" }), "Saved by reviewer");
  assert.equal(
    businessDescriptionText({
      businessDescription: "Saved by reviewer",
      transactionDescription: "Imported transaction description",
    }),
    "Saved by reviewer",
  );
  ok("the staging Business Description wins; narration is never shown in its place");

  assert.equal(
    businessDescriptionText({ businessDescription: null, transactionDescription: "Imported description" }),
    "Imported description",
  );
  assert.equal(
    businessDescriptionText({ businessDescription: "   ", transactionDescription: "Imported description" }),
    "Imported description",
  );
  assert.equal(businessDescriptionText({ businessDescription: null, transactionDescription: null }), "—");
  assert.equal(businessDescriptionText({}), "—");
  ok(
    "historical rows without a Business Description fall back to the imported transaction's saved description, then an em dash",
  );
}

console.log(`\nDuplicate evidence: ${passed} checks passed.`);
