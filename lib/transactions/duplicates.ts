/**
 * Likely-duplicate check run before saving (form and Finance AI).
 *
 * Same type, amount, currency and date, plus the same client (income) or the same
 * description (expense), case-insensitive. It only warns: the manager can still save,
 * because two identical payments on one day do happen.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/format";
import type { ExtractionResult } from "@/lib/chatbot/extract";

export interface Duplicate {
  id: string;
  /** "Office rent, 12 Oct 2026, entered at 12:39 am" */
  label: string;
}

export async function findDuplicate(draft: ExtractionResult, excludeId: string | null = null): Promise<Duplicate | null> {
  const { type, original_amount, original_currency, txn_date } = draft;
  const name = (type === "income" ? draft.client_name : draft.expense_description)?.trim();
  if (!type || original_amount === null || !original_currency || !txn_date || !name) return null;

  const stored = type === "income" ? sql`coalesce(c.client_name, t.client_name_snapshot, '')` : sql`coalesce(t.description, '')`;
  const result = await db.execute(sql`
    SELECT t.id, ${stored} AS name, to_char(t.created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS time
    FROM transactions t
    LEFT JOIN clients c ON c.client_id = t.client_id
    WHERE t.deleted_at IS NULL
      AND t.type_id = ${type === "income" ? 1 : 2}
      AND t.original_amount = ${String(original_amount)}::numeric
      AND t.original_currency = ${original_currency}
      AND t.txn_date = ${txn_date}::date
      AND lower(trim(${stored})) = lower(${name})
      ${excludeId ? sql`AND t.id <> ${excludeId}::uuid` : sql``}
    ORDER BY t.created_at DESC
    LIMIT 1
  `);
  const row = result.rows[0] as { id: string; name: string; time: string } | undefined;
  return row ? { id: row.id, label: `${row.name}, ${formatDate(txn_date)}, entered at ${formatTime(row.time)}` } : null;
}

export const duplicateMessage = (d: Duplicate) => `This looks like a duplicate of ${d.label}.`;
