import assert from "node:assert/strict";
import { parseClient } from "../clients";
import { toClientsCsv } from "../csv";
import { dateCell } from "../../transactions/csv";

console.log("Running Client Validation Unit Tests...");

// 1. Missing name
{
  const res = parseClient({});
  assert.equal(res.ok, false);
  assert.equal(res.error, "Enter the client name.");
}

// 2. Whitespace-only name
{
  const res = parseClient({ name: "   " });
  assert.equal(res.ok, false);
  assert.equal(res.error, "Enter the client name.");
}

// 3. Valid basic client
{
  const res = parseClient({ name: "  Acme Corp  " });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.name, "Acme Corp");
    assert.equal(res.value.country, "India");
    assert.equal(res.value.email, null);
    assert.equal(res.value.gstin, null);
    assert.equal(res.value.state, null);
  }
}

// 4. Invalid email
{
  const res = parseClient({ name: "Acme", email: "not-an-email" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "Enter a valid email address.");
}

// 5. Valid email
{
  const res = parseClient({ name: "Acme", email: "billing@acme.com" });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.email, "billing@acme.com");
  }
}

// 6. Invalid GSTIN format
{
  const res = parseClient({ name: "Acme", gstin: "12345" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "GSTIN should look like 27ABCDE1234F1Z5.");
}

// 7. GSTIN state mismatch
{
  const res = parseClient({
    name: "Acme",
    gstin: "27ABCDE1234F1Z5", // Maharashtra (27)
    state: "29", // Karnataka (29)
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, "Client GSTIN's first two digits don't match their state.");
}

// 8. Valid GSTIN and state match
{
  const res = parseClient({
    name: "Acme Infotech Pvt Ltd",
    email: "accounts@acme.in",
    country: "India",
    state: "27",
    gstin: "27ABCDE1234F1Z5",
    address: "Bavdhan, Pune, Maharashtra 411021",
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.name, "Acme Infotech Pvt Ltd");
    assert.equal(res.value.state, "27");
    assert.equal(res.value.gstin, "27ABCDE1234F1Z5");
    assert.equal(res.value.country, "India");
    assert.equal(res.value.address, "Bavdhan, Pune, Maharashtra 411021");
  }
}

// 9. Foreign client without GSTIN
{
  const res = parseClient({
    name: "Globex Inc",
    country: "United States",
    email: "contact@globex.us",
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.name, "Globex Inc");
    assert.equal(res.value.country, "United States");
    assert.equal(res.value.state, null);
    assert.equal(res.value.gstin, null);
  }
}

// 10. toClientsCsv formatting & formula safety
{
  const mockClients = [
    {
      id: "c-1",
      name: "Acme Corp",
      email: "billing@acme.com",
      gstin: "27ABCDE1234F1Z5",
      state: "27",
      country: "India",
      totalReceived: 100000,
      totalExpenses: 25000,
      netMargin: 75000,
      payments: 4,
      lastPaymentDate: "2026-10-10",
      firstSeen: "2026-01-15",
    },
    {
      id: "c-2",
      name: "=cmd|' /C calc'!A0", // Formula injection attack vector
      email: null,
      gstin: null,
      state: null,
      country: "India",
      totalReceived: 0,
      totalExpenses: 0,
      netMargin: 0,
      payments: 0,
      lastPaymentDate: null,
      firstSeen: "2026-10-01",
    },
  ];

  const mockOwed = {
    "c-1": { INR: 15000, USD: 0, overdue: 1 },
    "c-2": { INR: 0, USD: 500, overdue: 0 },
  };

  const csv = toClientsCsv(mockClients, mockOwed);

  // Checks BOM for Excel compatibility
  assert.ok(csv.startsWith("\uFEFF"));

  // Checks header row
  assert.ok(csv.includes('"Client Name","GSTIN","Email"'));

  // Checks normal row — dates are text-forced ISO (leading space) so Excel never
  // converts them to date cells and shows ###### or a re-formatted value.
  assert.ok(csv.includes('"Acme Corp","27ABCDE1234F1Z5","billing@acme.com","27","India","100000.00","25000.00","75000.00","15000.00","0.00","4"," 2026-10-10"," 2026-01-15"'));

  // Checks formula injection prevention (escaped with leading single quote)
  assert.ok(csv.includes('\'=cmd|'));
}

// 11. dateCell — one text-safe value for every CSV date column (ledger, clients,
//     reports): raw text here, the caller's cell() adds the CSV quoting.
{
  assert.equal(dateCell("2026-10-10"), " 2026-10-10");
  // Full ISO timestamps keep only the date part.
  assert.equal(dateCell("2026-10-10T14:30:00.000Z"), " 2026-10-10");
  // Null falls back to its column label; undefined to an empty cell.
  assert.equal(dateCell(null, "None"), "None");
  assert.equal(dateCell(undefined), "");
  // Non-date junk still gets quoted hash-safely, never silently reformatted.
  assert.equal(dateCell("None"), "None");
}

console.log("All client validation & CSV unit tests passed!");
