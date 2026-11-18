/**
 * The exact database surface covered by Export backup / Import backup.
 *
 * Sheet order here is the export order and the hash order. Import uses its own
 * dependency order in lib/backup/import.ts (parents before children), because a
 * human reading the workbook should see transactions before staging tables.
 */

import { getTableColumns } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import {
  appUsers,
  auditEvents,
  bankAccounts,
  bankStatementLines,
  bankStatements,
  categories,
  chatSessions,
  clients,
  companyProfile,
  invoiceItems,
  invoices,
  recurringExpenses,
  transactionTypes,
  transactions,
} from "@/lib/db/schema";
import { columnKind, type BackupColumn } from "./format";

export interface BackupTableSpec {
  sheet: string;
  label: string;
  table: AnyPgTable;
}

export const BACKUP_TABLES: BackupTableSpec[] = [
  { sheet: "app_users", label: "Members", table: appUsers },
  { sheet: "clients", label: "Clients", table: clients },
  { sheet: "categories", label: "Categories", table: categories },
  { sheet: "transaction_types", label: "Transaction types", table: transactionTypes },
  { sheet: "recurring_expenses", label: "Recurring expenses", table: recurringExpenses },
  { sheet: "invoices", label: "Invoices", table: invoices },
  { sheet: "invoice_items", label: "Invoice items", table: invoiceItems },
  { sheet: "transactions", label: "Transactions", table: transactions },
  { sheet: "bank_accounts", label: "Bank accounts", table: bankAccounts },
  { sheet: "bank_statements", label: "Bank statements", table: bankStatements },
  { sheet: "bank_statement_lines", label: "Statement rows", table: bankStatementLines },
  { sheet: "company_profile", label: "Company profile", table: companyProfile },
  { sheet: "audit_events", label: "Audit log", table: auditEvents },
  { sheet: "chat_sessions", label: "Finance AI sessions", table: chatSessions },
];

interface DrizzleColumnShape {
  name: string;
  dataType: string;
  columnType: string;
  scale?: number;
  notNull: boolean;
}

export function columnsFor(spec: BackupTableSpec): BackupColumn[] {
  const columns = getTableColumns(spec.table) as unknown as Record<string, DrizzleColumnShape>;
  return Object.entries(columns).map(([prop, column]) => {
    const scale = typeof column.scale === "number" ? column.scale : undefined;
    return {
      name: column.name,
      prop,
      kind: columnKind(column.columnType, column.dataType, scale),
      scale,
      notNull: column.notNull,
    };
  });
}
