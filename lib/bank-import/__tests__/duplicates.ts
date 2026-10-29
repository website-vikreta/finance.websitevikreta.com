/**
 * Offline checks for the duplicate-candidate logic that must hold without a
 * database: the canonical reference fold and the staging match key. The
 * database-backed candidate queries stay gated behind TEST_DATABASE_URL
 * (review-db.ts); everything checked here is pure so the fold semantics are
 * pinned even in offline runs.
 *
 * Run: tsx lib/bank-import/__tests__/duplicates.ts
 */
import assert from "node:assert/strict";
import { stagingCanonicalMatchKey } from "../duplicates";
import { canonicalReferenceKey, fingerprintLine } from "../normalize";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── Canonical reference fold ─────────────────────────────────────────────────
{
  // The two supplied statements print the same bank reference with and
  // without zero padding; the fold must merge that and nothing else.
  assert.equal(canonicalReferenceKey("0000610103695621"), "610103695621");
  assert.equal(canonicalReferenceKey("610103695621"), "610103695621");
  assert.equal(
    canonicalReferenceKey("0000610103695621"),
    canonicalReferenceKey("610103695621"),
  );
  ok("reference fold: zero-padding in one statement folds to the unpadded key");

  // Mixed references keep padding after a leading letter but must not strip
  // interior zeros.
  assert.equal(canonicalReferenceKey("NEFT-000610103695621"), "neft000610103695621");
  assert.equal(canonicalReferenceKey("neft 000610103695621"), "neft000610103695621");
  assert.equal(canonicalReferenceKey("NEFT0610103695621"), "neft0610103695621");
  assert.notEqual(canonicalReferenceKey("NEFT-0610103695621"), canonicalReferenceKey("NEFT-610103695621"));
  ok("reference fold: interior zeros preserved, leading-zero strip stays narrow");

  assert.equal(canonicalReferenceKey("AbCd/12.34"), "abcd1234");
  assert.equal(canonicalReferenceKey("  ABC 123 "), canonicalReferenceKey("abc123"));
  ok("reference fold: case and separators are cosmetic");

  // Real-distinct refs never merge.
  assert.notEqual(canonicalReferenceKey("ABC123"), canonicalReferenceKey("AB123"));
  assert.notEqual(canonicalReferenceKey("1001"), canonicalReferenceKey("101"));
  ok("reference fold: genuinely different references stay different");

  // Pure-zero and separator-only references are placeholders, never keys.
  assert.equal(canonicalReferenceKey("0"), null);
  assert.equal(canonicalReferenceKey("0000"), null);
  assert.equal(canonicalReferenceKey(null), null);
  assert.equal(canonicalReferenceKey(""), null);
  assert.equal(canonicalReferenceKey("---"), null);
  assert.equal(canonicalReferenceKey("-"), null);
  ok("reference fold: zero-only and separator-only values are placeholders");

  // Exact printing still yields an exact fingerprint — the fold affects only
  // the canonical candidate pass, never the content fingerprint.
  assert.notEqual(
    fingerprintLine({
      txnDate: "2026-04-13",
      valueDate: "2026-04-13",
      narration: "PAYMENT",
      reference: "0000610103695621",
      withdrawalAmount: null,
      depositAmount: "5000.00",
    }),
    fingerprintLine({
      txnDate: "2026-04-13",
      valueDate: "2026-04-13",
      narration: "PAYMENT",
      reference: "610103695621",
      withdrawalAmount: null,
      depositAmount: "5000.00",
    }),
  );
  ok("reference fold: the content fingerprint keeps both printings distinct");
}

// ── Staging canonical match key ──────────────────────────────────────────────
interface KeyRow {
  txnDate: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  reference: string | null;
}

function rowFor(overrides: Partial<KeyRow>): KeyRow {
  return {
    txnDate: "2026-04-13",
    withdrawalAmount: null,
    depositAmount: "5000.00",
    reference: "610103695621",
    ...overrides,
  };
}

{
  // Same entry across the two supplied statement formats.
  const padded = stagingCanonicalMatchKey(rowFor({ reference: "0000610103695621" }));
  const unpadded = stagingCanonicalMatchKey(rowFor({}));
  assert.ok(padded && unpadded && padded === unpadded);
  ok("staging key: zero-padded reference matches the unpadded print of the same row");

  // Different signed amount never matches.
  assert.notEqual(
    stagingCanonicalMatchKey(rowFor({ depositAmount: "5000.00" })),
    stagingCanonicalMatchKey(rowFor({ depositAmount: "500.00" })),
  );
  // Amount string padding does not matter.
  assert.equal(
    stagingCanonicalMatchKey(rowFor({ depositAmount: "5000.0" })),
    stagingCanonicalMatchKey(rowFor({ depositAmount: "5000.00" })),
  );
  ok("staging key: amount comparison is exact minor units");

  // Different day never matches.
  assert.notEqual(
    stagingCanonicalMatchKey(rowFor({ txnDate: "2026-04-13" })),
    stagingCanonicalMatchKey(rowFor({ txnDate: "2026-04-14" })),
  );
  ok("staging key: the transaction date is part of the key");

  // A reversal printed in the opposite column keeps a different key even with
  // the same reference, date and magnitude.
  assert.notEqual(
    stagingCanonicalMatchKey(rowFor({ depositAmount: "5000.00" })),
    stagingCanonicalMatchKey(rowFor({ depositAmount: null, withdrawalAmount: "5000.00" })),
  );
  // A negative amount printed in column keeps a different signed movement.
  assert.notEqual(
    stagingCanonicalMatchKey(rowFor({ depositAmount: "5000.00" })),
    stagingCanonicalMatchKey(rowFor({ depositAmount: "-5000.00" })),
  );
  assert.notEqual(
    stagingCanonicalMatchKey(rowFor({ depositAmount: null, withdrawalAmount: "-5000.00" })),
    stagingCanonicalMatchKey(rowFor({ depositAmount: null, withdrawalAmount: "5000.00" })),
  );
  ok("staging key: signed movement and direction keep reversals distinct");

  // Placeholder and under-formed rows never get a key.
  assert.equal(stagingCanonicalMatchKey(rowFor({ depositAmount: "0.00" })), null);
  assert.equal(
    stagingCanonicalMatchKey(rowFor({ depositAmount: "0.00", withdrawalAmount: "0.00" })),
    null,
  );
  assert.equal(stagingCanonicalMatchKey(rowFor({ depositAmount: null, withdrawalAmount: null })), null);
  assert.equal(stagingCanonicalMatchKey(rowFor({ txnDate: null })), null);
  assert.equal(stagingCanonicalMatchKey(rowFor({ reference: null })), null);
  assert.equal(stagingCanonicalMatchKey(rowFor({ reference: "0" })), null);
  ok("staging key: placeholder rows and rows without full data are excluded");
}

console.log(`\nduplicates: ${passed} checks passed`);
