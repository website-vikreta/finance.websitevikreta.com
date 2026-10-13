import fs from "fs";
import path from "path";
import { extractTransaction, tryDeterministicExtraction } from "../extract";

try {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.log("Error reading .env.local:", e);
}

async function run() {
  console.log("=== Testing Deterministic Fallback ===");
  const d1 = tryDeterministicExtraction("USD", "2026-10-09", {
    missingField: "original_currency",
    pendingQuestion: "What currency?",
  });
  console.log("Deterministic USD result:", d1);
  if (d1?.original_currency !== "USD") throw new Error("Deterministic USD failed");

  const d2 = tryDeterministicExtraction("today", "2026-10-09", {
    missingField: "txn_date",
    pendingQuestion: "What date?",
  });
  console.log("Deterministic today result:", d2);
  if (d2?.txn_date !== "2026-10-09") throw new Error("Deterministic date failed");

  console.log("\n=== Testing Live extractTransaction ===");
  const t0 = Date.now();
  const res1 = await extractTransaction("Acme paid $500 today for design work", "2026-10-09");
  console.log(`Live call 1 took ${Date.now() - t0}ms:`, JSON.stringify(res1, null, 2));

  if (!res1.ok) {
    throw new Error(`Live call 1 failed: ${res1.error}`);
  }

  const t1 = Date.now();
  const res2 = await extractTransaction("Paid ₹12,000 for office rent yesterday", "2026-10-09");
  console.log(`Live call 2 took ${Date.now() - t1}ms:`, JSON.stringify(res2, null, 2));

  if (!res2.ok) {
    throw new Error(`Live call 2 failed: ${res2.error}`);
  }

  console.log("\nALL TESTS PASSED WITH 100% SUCCESS!");
}

run().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
