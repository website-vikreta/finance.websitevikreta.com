/**
 * Offline checks for lib/credentials.ts. Uses throwaway env values, never real ones.
 * Run: npx tsx lib/__tests__/credentials.ts
 */

import assert from "node:assert/strict";
import { createHash } from "crypto";
import { hashPassword, verifyCredentials, verifyPassword } from "../credentials";

process.env.ADMIN_EMAIL = "Manager@Example.com";
process.env.ADMIN_PASSWORD_HASH = createHash("sha256").update("correct horse").digest("hex");

const cases: [string, string, string][] = [
  ["manager@example.com", "correct horse", "ok"],
  ["  MANAGER@example.COM ", "correct horse", "ok"],
  ["manager@example.com", "wrong", "invalid"],
  ["other@example.com", "correct horse", "invalid"],
  ["manager@example.com", "", "invalid"],
];
for (const [email, password, want] of cases) assert.equal(verifyCredentials(email, password), want, `${email} / ${password}`);

process.env.ADMIN_PASSWORD_HASH = "not-a-hash";
assert.equal(verifyCredentials("manager@example.com", "correct horse"), "unconfigured", "malformed hash");
process.env.ADMIN_EMAIL = "";
assert.equal(verifyCredentials("", "x"), "unconfigured", "missing email");

const stored = hashPassword("member pass");
assert.ok(verifyPassword("member pass", stored), "member hash round-trip");
assert.ok(!verifyPassword("member pas", stored), "member wrong password");
assert.ok(!verifyPassword("member pass", "garbage"), "malformed member hash");

console.log(`Results: ${cases.length + 5} passed, 0 failed`);
