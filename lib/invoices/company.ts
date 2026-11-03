/**
 * Company profile: the one row printed on every invoice. Admin-only edits, audited.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, companyProfile } from "@/lib/db/schema";
import { GST_RATES, STATES } from "./math";

export type CompanyProfile = typeof companyProfile.$inferSelect;

export async function getCompanyProfile(): Promise<CompanyProfile | null> {
  const [row] = await db.select().from(companyProfile).where(eq(companyProfile.id, 1));
  return row ?? null;
}

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const SWIFT = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;
const UPI = /^[\w.-]{2,}@[a-zA-Z]{2,}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const upper = (v: unknown, max: number) => text(v, max)?.toUpperCase().replace(/\s+/g, "") ?? null;

/** Validates untrusted form input. GSTIN must match the chosen state. */
export function parseCompanyProfile(raw: unknown) {
  const i = (raw ?? {}) as Record<string, unknown>;
  const v = {
    legalName: text(i.legalName, 255),
    address: text(i.address, 1000),
    state: typeof i.state === "string" && STATES.some((s) => s.code === i.state) ? i.state : null,
    gstin: upper(i.gstin, 15),
    pan: upper(i.pan, 10),
    email: text(i.email, 255),
    phone: text(i.phone, 30),
    bankName: text(i.bankName, 255),
    accountName: text(i.accountName, 255),
    accountNumber: upper(i.accountNumber, 34),
    ifsc: upper(i.ifsc, 11),
    swiftCode: upper(i.swiftCode, 11),
    upiId: text(i.upiId, 100),
    invoicePrefix: upper(i.invoicePrefix, 10) ?? "WV",
    defaultGstRate: typeof i.defaultGstRate === "string" && (GST_RATES as readonly string[]).includes(i.defaultGstRate) ? i.defaultGstRate : null,
    defaultTerms: text(i.defaultTerms, 2000),
  };
  if (!v.legalName) return { ok: false as const, error: "Enter the company's legal name." };
  if (!v.address) return { ok: false as const, error: "Enter the company address." };
  if (!v.state) return { ok: false as const, error: "Pick the company's state (decides CGST/SGST vs IGST)." };
  if (v.gstin && !GSTIN.test(v.gstin)) return { ok: false as const, error: "GSTIN should look like 27ABCDE1234F1Z5." };
  if (v.gstin && v.gstin.slice(0, 2) !== v.state) return { ok: false as const, error: "GSTIN's first two digits don't match the state." };
  if (v.pan && !PAN.test(v.pan)) return { ok: false as const, error: "PAN should look like ABCDE1234F." };
  if (v.gstin && v.pan && v.gstin.slice(2, 12) !== v.pan) return { ok: false as const, error: "PAN doesn't match the PAN inside the GSTIN." };
  if (v.email && !EMAIL.test(v.email)) return { ok: false as const, error: "Enter a valid email." };
  if (v.ifsc && !IFSC.test(v.ifsc)) return { ok: false as const, error: "IFSC should look like HDFC0001234." };
  if (v.swiftCode && !SWIFT.test(v.swiftCode)) return { ok: false as const, error: "SWIFT code should look like HDFCINBB." };
  if (v.upiId && !UPI.test(v.upiId)) return { ok: false as const, error: "UPI ID should look like name@bank." };
  if (!/^[A-Z0-9-]{1,10}$/.test(v.invoicePrefix)) return { ok: false as const, error: "Invoice prefix: letters, numbers or dashes (max 10)." };
  if (!v.defaultGstRate) return { ok: false as const, error: "Pick a default GST rate." };
  return { ok: true as const, value: { ...v, legalName: v.legalName, address: v.address, state: v.state, defaultGstRate: v.defaultGstRate } };
}

export async function saveCompanyProfile(userId: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseCompanyProfile(raw);
  if (!parsed.ok) return parsed;
  const value = { ...parsed.value, updatedBy: userId, updatedAt: new Date() };
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(companyProfile).where(eq(companyProfile.id, 1));
    await tx.insert(companyProfile).values({ id: 1, ...value }).onConflictDoUpdate({ target: companyProfile.id, set: value });
    await tx.insert(auditEvents).values({
      entityType: "company_profile",
      entityId: "1",
      action: before ? "updated" : "created",
      performedBy: userId,
      source: "manual",
      beforeState: before ? JSON.parse(JSON.stringify(before)) : null,
      afterState: JSON.parse(JSON.stringify(parsed.value)),
    });
  });
  return { ok: true };
}
