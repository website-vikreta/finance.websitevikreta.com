import assert from "node:assert/strict";
import {
  extractSafePgCode,
  formatSafeDbError,
  formatSafeDbConstraintError,
  logSafeDbError,
  logSafeDbConstraintError,
} from "../safe-log";

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 1. extractSafePgCode validates 5-character alphanumeric PostgreSQL codes
{
  assert.equal(extractSafePgCode({ code: "23505" }), "23505");
  assert.equal(extractSafePgCode({ code: "40001" }), "40001");
  assert.equal(extractSafePgCode({ code: "42P01" }), "42P01");
  assert.equal(extractSafePgCode({ code: " 23503 " }), "23503");
  ok("extractSafePgCode accepts valid 5-character alphanumeric PG error codes");
}

// 2. extractSafePgCode rejects invalid codes and sensitive data
{
  assert.equal(extractSafePgCode(null), undefined);
  assert.equal(extractSafePgCode(undefined), undefined);
  assert.equal(extractSafePgCode("error string"), undefined);
  assert.equal(extractSafePgCode(new Error("simple error")), undefined);
  assert.equal(extractSafePgCode({ code: "TOO_LONG_CUSTOM_CODE" }), undefined);
  assert.equal(extractSafePgCode({ code: "12" }), undefined);
  assert.equal(extractSafePgCode({ code: "SELECT * FROM transactions" }), undefined);
  assert.equal(extractSafePgCode({ code: 12345 }), undefined);
  ok("extractSafePgCode rejects invalid, non-alphanumeric, or arbitrary codes");
}

// 3. formatSafeDbError contains ONLY safe fields (operation and code)
{
  const sensitiveError = {
    name: "error",
    length: 180,
    severity: "ERROR",
    code: "23505",
    detail: "Key (fingerprint)=(abc123secret) already exists.",
    hint: "Check transaction reference 987654321",
    position: "12",
    internalQuery: "INSERT INTO bank_statement_lines VALUES ('secret', 500000)",
    where: "SQL statement 'INSERT INTO ...'",
    schema: "public",
    table: "bank_statement_lines",
    column: "fingerprint",
    dataType: "varchar",
    constraint: "bank_statement_lines_fingerprint_unique",
    stack: "Error: at Query.run (/app/node_modules/pg/lib/query.js:123:45)",
    message: "duplicate key value violates unique constraint",
  };

  const formatted = formatSafeDbError("updateLineReview", sensitiveError);
  assert.deepEqual(formatted, {
    operation: "updateLineReview",
    code: "23505",
  });

  // Verify none of the sensitive keys leak into formatted output
  assert.deepEqual(Object.keys(formatted).sort(), ["code", "operation"]);
  assert.equal((formatted as unknown as Record<string, unknown>).detail, undefined);
  assert.equal((formatted as unknown as Record<string, unknown>).hint, undefined);
  assert.equal((formatted as unknown as Record<string, unknown>).internalQuery, undefined);
  assert.equal((formatted as unknown as Record<string, unknown>).where, undefined);
  assert.equal((formatted as unknown as Record<string, unknown>).stack, undefined);
  assert.equal((formatted as unknown as Record<string, unknown>).message, undefined);
  ok("formatSafeDbError strips all sensitive DB properties and retains only operation and code");
}

// 4. formatSafeDbError defaults code to UNKNOWN when no valid code
{
  const formatted = formatSafeDbError("markLineReady", new Error("Generic failure"));
  assert.deepEqual(formatted, {
    operation: "markLineReady",
    code: "UNKNOWN",
  });
  ok("formatSafeDbError safely defaults code to UNKNOWN for generic errors");
}

// 5. Constraint diagnostics only allow schema-owned names and safe SQLSTATEs.
{
  assert.deepEqual(
    formatSafeDbConstraintError({ code: "23514", constraint: "chk_bank_statement_lines_amounts", detail: "amount=secret" }),
    { code: "23514", constraint: "chk_bank_statement_lines_amounts" },
  );
  assert.deepEqual(
    formatSafeDbConstraintError({ code: "23514", constraint: "secret_constraint", detail: "secret" }),
    { code: "23514", constraint: "UNKNOWN" },
  );
  assert.deepEqual(
    formatSafeDbConstraintError({
      name: "DrizzleQueryError",
      cause: { code: "23514", constraint: "chk_bank_statement_lines_amounts", detail: "private" },
    }),
    { code: "23514", constraint: "chk_bank_statement_lines_amounts" },
  );
  ok("formatSafeDbConstraintError allowlists safe SQLSTATEs and schema constraints");
}

// 6. logSafeDbError outputs structured safe log without leaking sensitive text
{
  const captured: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };

  try {
    const dangerousDbError = {
      code: "23514",
      message: "violates check constraint on balance: -500.00",
      detail: "account 123456789 had negative balance",
      sql: "UPDATE bank_accounts SET balance = -500 WHERE id = 'secret-uuid'",
    };

    logSafeDbError("skipLine", dangerousDbError);

    assert.equal(captured.length, 1);
    assert.equal(captured[0][0], "[bank-import] skipLine failed");
    assert.deepEqual(captured[0][1], {
      operation: "skipLine",
      code: "23514",
    });

    const serialized = JSON.stringify(captured[0]);
    assert.equal(serialized.includes("123456789"), false);
    assert.equal(serialized.includes("secret-uuid"), false);
    assert.equal(serialized.includes("violates check constraint"), false);
    assert.equal(serialized.includes("UPDATE bank_accounts"), false);
  } finally {
    console.error = originalError;
  }
  ok("logSafeDbError logs only safe prefix and payload to console.error");
}

// 7. Upload and review DB diagnostics exclude query, detail, values, and URLs.
{
  const captured: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => captured.push(args);
  try {
    logSafeDbConstraintError({
      code: "23514",
      constraint: "chk_bank_statement_lines_amounts",
      detail: "withdrawal_amount=-999999",
      query: "INSERT secret statement contents",
      connectionString: "postgres://secret",
    });
    logSafeDbConstraintError({
      code: "23514",
      constraint: "chk_bank_statement_lines_amounts",
      detail: "withdrawal_amount=-999999",
      query: "UPDATE secret statement contents",
    }, "review update");
  } finally {
    console.error = originalError;
  }
  assert.equal(captured.length, 2);
  assert.equal(captured[0][0], "[bank-import] upload database failure");
  assert.equal(captured[1][0], "[bank-import] review update database failure");
  assert.deepEqual(captured[0][1], {
    code: "23514",
    constraint: "chk_bank_statement_lines_amounts",
  });
  assert.deepEqual(captured[1][1], {
    code: "23514",
    constraint: "chk_bank_statement_lines_amounts",
  });
  const serialized = JSON.stringify(captured);
  assert.equal(serialized.includes("withdrawal_amount"), false);
  assert.equal(serialized.includes("statement contents"), false);
  assert.equal(serialized.includes("postgres://"), false);
  ok("logSafeDbConstraintError logs upload and review SQLSTATEs with allowlisted constraints only");
}

console.log(`\nsafe-log: ${passed} checks passed`);
