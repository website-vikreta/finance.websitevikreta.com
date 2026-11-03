/**
 * Invoice maths: exact (BigInt paise/cents, half-even), browser-safe, no DB.
 * Tested in lib/invoices/__tests__/math.ts.
 */

import { divideHalfEven, formatScaledBigIntToDecimal, parseExactDecimalToBigInt } from "@/lib/currency/precision";

export type TaxType = "cgst_sgst" | "igst" | "none";
export type InvoiceCurrency = "INR" | "USD";

export const GST_RATES = ["0", "5", "12", "18", "28"] as const;

/** GST state codes (first two digits of a GSTIN). */
export const STATES: { code: string; name: string }[] = [
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"],
  ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"],
  ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"],
  ["24", "Gujarat"], ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"],
  ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"], ["35", "Andaman and Nicobar Islands"],
  ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"],
].map(([code, name]) => ({ code, name }));

export const stateName = (code: string | null | undefined) => STATES.find((s) => s.code === code)?.name ?? null;

/** Same state → CGST + SGST; another Indian state → IGST; outside India → no GST (export of services). */
export function taxTypeFor(companyState: string | null, client: { country: string; state: string | null }): TaxType {
  if (client.country.trim().toLowerCase() !== "india") return "none";
  if (!companyState || !client.state) return "igst";
  return companyState === client.state ? "cgst_sgst" : "igst";
}

export interface LineInput {
  quantity: string;
  rate: string;
}

export interface Totals {
  lines: string[];
  subtotal: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  total: string;
}

const ZERO = BigInt(0);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const TEN_THOUSAND = BigInt(10000);
const money = (minor: bigint) => formatScaledBigIntToDecimal(minor, 2);

/**
 * Line = quantity × rate (both ≤ 2 decimals), rounded half-even to the paisa.
 * Tax = subtotal × rate%, rounded once on the subtotal. CGST + SGST always equals tax.
 * Throws DecimalPrecisionError for malformed numbers.
 */
export function computeTotals(items: LineInput[], gstRate: string, taxType: TaxType): Totals {
  const lineMinor = items.map((i) => divideHalfEven(parseExactDecimalToBigInt(i.quantity, 2) * parseExactDecimalToBigInt(i.rate, 2), HUNDRED));
  const subtotal = lineMinor.reduce((s, n) => s + n, ZERO);
  const rate = taxType === "none" ? ZERO : parseExactDecimalToBigInt(gstRate, 2);
  const tax = divideHalfEven(subtotal * rate, TEN_THOUSAND);
  const sgst = taxType === "cgst_sgst" ? tax / TWO : ZERO;
  const cgst = taxType === "cgst_sgst" ? tax - sgst : ZERO;
  return {
    lines: lineMinor.map(money),
    subtotal: money(subtotal),
    cgst: money(cgst),
    sgst: money(sgst),
    igst: money(taxType === "igst" ? tax : ZERO),
    tax: money(tax),
    total: money(subtotal + tax),
  };
}

/** Indian financial year label for a YYYY-MM-DD date: 2026-10-16 → "2026-27". */
export function financialYear(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** WV/2026-27/001 (at least 3 digits). */
export const invoiceNumber = (prefix: string, fy: string, seq: number) => `${prefix}/${fy}/${String(seq).padStart(3, "0")}`;

// ─── Amount in words ─────────────────────────────────────────────────────────

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Indian grouping: crore, lakh, thousand. */
function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor((n % 1e7) / 1e5);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Math.floor((n % 1e5) / 1e3);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  const rest = n % 1e3;
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** International grouping: billion, million, thousand. */
function internationalWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  for (const [size, word] of [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]] as const) {
    const chunk = Math.floor(n / size) % 1000;
    if (chunk) parts.push(`${belowThousand(chunk)} ${word}`);
  }
  if (n % 1000) parts.push(belowThousand(n % 1000));
  return parts.join(" ");
}

/** "Rupees Fifty Thousand Nine Hundred and Fifty Paise Only" / "US Dollars One Thousand Only". */
export function amountInWords(amount: string, currency: InvoiceCurrency): string {
  const minor = parseExactDecimalToBigInt(amount, 2);
  const whole = Number(minor / HUNDRED);
  const fraction = Number(minor % HUNDRED);
  if (currency === "INR") {
    return `Rupees ${indianWords(whole)}${fraction ? ` and ${belowHundred(fraction)} Paise` : ""} Only`;
  }
  return `US Dollars ${internationalWords(whole)}${fraction ? ` and ${belowHundred(fraction)} Cents` : ""} Only`;
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type DisplayStatus = "draft" | "sent" | "partial" | "overdue" | "paid" | "void";

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Part paid",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

/** Balance in exact minor units, never below zero. */
export function balanceOf(total: string, paid: string): string {
  const b = parseExactDecimalToBigInt(total, 2) - parseExactDecimalToBigInt(paid, 2);
  return money(b > ZERO ? b : ZERO);
}

/** draft/void are stored; paid, overdue and part paid come from payments and the due date. */
export function displayStatus(inv: { status: string; total: string; paid: string; dueDate: string }, today: string): DisplayStatus {
  if (inv.status === "draft" || inv.status === "void") return inv.status;
  const balance = parseExactDecimalToBigInt(balanceOf(inv.total, inv.paid), 2);
  if (balance === ZERO) return "paid";
  if (inv.dueDate < today) return "overdue";
  return parseExactDecimalToBigInt(inv.paid, 2) > ZERO ? "partial" : "sent";
}
