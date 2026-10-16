/**
 * Import FIRST in any suite that writes to Postgres. Suites only run against
 * TEST_DATABASE_URL, never the live DATABASE_URL: npm test once saved fake
 * Stripe/Zenith/Cloud-servers rows into the real ledger.
 *
 * Without TEST_DATABASE_URL the suite is skipped (exit 0) with a visible notice.
 */
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.log(`⚠️  SKIPPED ${path.basename(process.argv[1] ?? "suite")}: set TEST_DATABASE_URL to a separate database to run DB tests.`);
  process.exit(0);
}
if (testUrl === process.env.DATABASE_URL) {
  console.error("✗ TEST_DATABASE_URL equals DATABASE_URL. Point it at a separate test database.");
  process.exit(1);
}
// lib/db reads DATABASE_URL when first imported; dotenv never overrides an existing value.
process.env.DATABASE_URL = testUrl;
