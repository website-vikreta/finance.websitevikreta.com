import {
  type AnyPgColumn,
  pgTable,
  serial,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  date,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── 1. APP USERS (Single Manager Identity Anchor) ───────────────────────────
export const appUsers = pgTable(
  "app_users",
  {
    id: varchar("id", { length: 64 }).primaryKey(), // "admin" from existing session
    email: varchar("email", { length: 255 }).unique(), // Nullable; explicitly bootstrapped
    role: varchar("role", { length: 50 }).notNull().default("manager"), // "admin" manages members; "manager" records money
    isActive: boolean("is_active").notNull().default(true),
    passwordHash: text("password_hash"), // scrypt "salt:hash"; NULL for the env-configured "admin"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_app_users_role").on(table.role),
  ],
).enableRLS();

// ─── 2. CLIENTS (Income Counterparty Records) ───────────────────────────────
export const clients = pgTable(
  "clients",
  {
    clientId: uuid("client_id").defaultRandom().primaryKey(),
    clientName: varchar("client_name", { length: 255 }).notNull(),
    // Billing defaults, prefilled on the next invoice (each invoice keeps its own copy).
    email: varchar("email", { length: 255 }),
    billingAddress: text("billing_address"),
    state: varchar("state", { length: 2 }), // GST state code, India only
    country: varchar("country", { length: 100 }).notNull().default("India"),
    gstin: varchar("gstin", { length: 15 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: varchar("deleted_by", { length: 64 }).references(() => appUsers.id),
  },
  (table) => [
    uniqueIndex("uq_clients_normalized_active_name")
      .on(sql`lower(trim(both from ${table.clientName}))`)
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_clients_deleted_at").on(table.deletedAt),
    check("chk_client_name_not_empty", sql`trim(${table.clientName}) <> ''`),
  ],
).enableRLS();

// ─── 2b. CATEGORIES (Expense categories; list in lib/transactions/categories.ts) ─
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ─── 2c. RECURRING EXPENSES (bills that repeat monthly; marked paid by a person, never automatically) ─
export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    description: varchar("description", { length: 200 }).notNull(),
    categoryId: integer("category_id").notNull().references(() => categories.id),
    originalAmount: numeric("original_amount", { precision: 18, scale: 2 }).notNull(),
    originalCurrency: varchar("original_currency", { length: 3 }).notNull(), // "INR" | "USD"
    /** Day of month the bill falls on (1–31); short months clamp to their last day. */
    anchorDay: integer("anchor_day").notNull(),
    nextDue: date("next_due").notNull(),
    /** Part payments made towards the occurrence due on next_due; resets when it moves on. */
    paidThisPeriod: numeric("paid_this_period", { precision: 18, scale: 2 }).notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true), // false = paused
    createdBy: varchar("created_by", { length: 64 }).notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    endDate: date("end_date"), // optional final due date after which recurring stops
    clientId: uuid("client_id").references(() => clients.clientId), // its payments are tagged to this client
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // stopped
  },
  (table) => [
    index("idx_recurring_next_due").on(table.nextDue),
    check("chk_recurring_amount", sql`${table.originalAmount} > 0`),
    check("chk_recurring_currency", sql`${table.originalCurrency} IN ('INR', 'USD')`),
    check("chk_recurring_anchor_day", sql`${table.anchorDay} BETWEEN 1 AND 31`),
  ],
).enableRLS();

// ─── 3. TRANSACTION TYPES (Lookup: 1 = income, 2 = expense) ──────────────────
export const transactionTypes = pgTable(
  "transaction_types",
  {
    id: integer("id").primaryKey(), // Fixed seeds: 1 and 2
    code: varchar("code", { length: 50 }).notNull().unique(), // "income" | "expense"
    displayName: varchar("display_name", { length: 100 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
).enableRLS();

// ─── 4. TRANSACTIONS (Confirmed Financial Records) ───────────────────────────
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    typeId: integer("type_id")
      .notNull()
      .references(() => transactionTypes.id),
    clientId: uuid("client_id").references(() => clients.clientId),
    clientNameSnapshot: varchar("client_name_snapshot", { length: 255 }),

    // Exact human-readable major units (rupees / dollars) stored as NUMERIC(18, 2)
    originalAmount: numeric("original_amount", { precision: 18, scale: 2 }).notNull(),
    originalCurrency: varchar("original_currency", { length: 3 }).notNull(), // "INR" | "USD"
    amountInr: numeric("amount_inr", { precision: 18, scale: 2 }).notNull(),

    // Exchange-rate metadata (NULL for INR; NOT NULL for USD)
    exchangeRate: numeric("exchange_rate", { precision: 12, scale: 4 }),
    exchangeRateDate: date("exchange_rate_date"),
    rateSource: varchar("rate_source", { length: 50 }), // Nullable; 'manual' for USD

    description: text("description"),
    categoryId: integer("category_id").references(() => categories.id), // Expenses only; NULL for income
    invoiceId: uuid("invoice_id").references((): AnyPgColumn => invoices.id), // Income that pays an invoice
    /** Expense that paid a recurring bill: which bill, which month, and whether it settled that month. */
    recurringId: uuid("recurring_id").references(() => recurringExpenses.id),
    recurringDue: date("recurring_due"),
    recurringSettled: boolean("recurring_settled"),
    txnDate: date("txn_date").notNull(),

    source: varchar("source", { length: 50 }).notNull(), // "chatbot" | "manual" | "bank_import"
    status: varchar("status", { length: 50 }).notNull(), // Strictly "confirmed"

    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),

    createdBy: varchar("created_by", { length: 64 })
      .notNull()
      .references(() => appUsers.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: varchar("deleted_by", { length: 64 }).references(() => appUsers.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_transactions_txn_date").on(table.txnDate),
    index("idx_transactions_type_date").on(table.typeId, table.txnDate),
    index("idx_transactions_client_id").on(table.clientId),
    index("idx_transactions_deleted_at").on(table.deletedAt),
    index("idx_transactions_source").on(table.source),
    index("idx_transactions_category_id").on(table.categoryId),
    index("idx_transactions_invoice_id").on(table.invoiceId),
    index("idx_transactions_recurring_id").on(table.recurringId),
    check(
      "chk_transactions_recurring_link",
      sql`(${table.recurringId} IS NULL) = (${table.recurringDue} IS NULL) AND (${table.recurringId} IS NULL) = (${table.recurringSettled} IS NULL)`,
    ),

    check(
      "chk_transactions_amounts",
      sql`${table.originalAmount} > 0 AND ${table.amountInr} > 0`,
    ),
    check(
      "chk_transactions_currency_rules",
      sql`
        (${table.originalCurrency} = 'INR' 
          AND ${table.exchangeRate} IS NULL 
          AND ${table.exchangeRateDate} IS NULL 
          AND ${table.rateSource} IS NULL 
          AND ${table.amountInr} = ${table.originalAmount})
        OR
        (${table.originalCurrency} = 'USD' 
          AND ${table.exchangeRate} IS NOT NULL 
          AND ${table.exchangeRate} > 0 
          AND ${table.exchangeRateDate} IS NOT NULL 
          AND ${table.rateSource} IS NOT NULL 
          AND ${table.rateSource} = 'manual' 
          AND ${table.amountInr} > 0)
      `,
    ),
    check(
      "chk_transactions_type_requirements",
      sql`
        (${table.typeId} = 1 AND ${table.clientId} IS NOT NULL)
        OR
        (${table.typeId} = 2 AND ${table.description} IS NOT NULL AND trim(${table.description}) <> '')
      `,
    ),
    check(
      "chk_transactions_valid_enums",
      sql`
        ${table.originalCurrency} IN ('INR', 'USD') AND
        ${table.source} IN ('chatbot', 'manual', 'bank_import') AND
        ${table.status} = 'confirmed'
      `,
    ),
  ],
).enableRLS();

// ─── 5. AUDIT EVENTS (Append-Only Audit Log) ─────────────────────────────────
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: varchar("entity_id", { length: 255 }).notNull(),
    action: varchar("action", { length: 50 }).notNull(),
    performedBy: varchar("performed_by", { length: 64 })
      .notNull()
      .references(() => appUsers.id),
    source: varchar("source", { length: 50 }).notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_audit_events_entity").on(table.entityType, table.entityId),
    index("idx_audit_events_created_at").on(table.createdAt),
    index("idx_audit_events_performer").on(table.performedBy),
  ],
).enableRLS();

// ─── 6. CHAT SESSIONS (Finance AI draft + state machine, one row per user) ───
// Persisted so a half-entered transaction survives restarts and works across
// server instances. Nothing financial lives here until it is confirmed.
export const chatSessions = pgTable("chat_sessions", {
  userId: varchar("user_id", { length: 64 })
    .primaryKey()
    .references(() => appUsers.id),
  draft: jsonb("draft").notNull(),
  session: jsonb("session").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date", precision: 3 }).notNull().defaultNow(),
}).enableRLS();

// ─── 7. COMPANY PROFILE (one row; printed on every invoice) ──────────────────
export const companyProfile = pgTable(
  "company_profile",
  {
    id: integer("id").primaryKey().default(1),
    legalName: varchar("legal_name", { length: 255 }).notNull(),
    address: text("address").notNull(),
    state: varchar("state", { length: 2 }).notNull(), // GST state code
    gstin: varchar("gstin", { length: 15 }),
    pan: varchar("pan", { length: 10 }),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 30 }),
    bankName: varchar("bank_name", { length: 255 }),
    accountName: varchar("account_name", { length: 255 }),
    accountNumber: varchar("account_number", { length: 34 }),
    ifsc: varchar("ifsc", { length: 11 }),
    upiId: varchar("upi_id", { length: 100 }),
    invoicePrefix: varchar("invoice_prefix", { length: 10 }).notNull().default("WV"),
    defaultGstRate: numeric("default_gst_rate", { precision: 5, scale: 2 }).notNull().default("18"),
    defaultTerms: text("default_terms"),
    updatedBy: varchar("updated_by", { length: 64 }).references(() => appUsers.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check("chk_company_profile_single_row", sql`id = 1`)],
).enableRLS();

// ─── 8. INVOICES ──────────────────────────────────────────────────────────────
// Stored status is draft | sent | void. "Partially paid", "paid" and "overdue" are derived
// from linked income transactions (transactions.invoice_id) and the due date, so deleting
// a payment always puts the balance back.
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** WV/2026-27/001, assigned when issued; drafts have none. */
    number: varchar("number", { length: 40 }),
    fy: varchar("fy", { length: 7 }),
    seq: integer("seq"),
    status: varchar("status", { length: 10 }).notNull().default("draft"),
    clientId: uuid("client_id").notNull().references(() => clients.clientId),
    // Bill-to copy taken when the invoice is saved (the client record may change later).
    billToName: varchar("bill_to_name", { length: 255 }).notNull(),
    billToAddress: text("bill_to_address"),
    billToState: varchar("bill_to_state", { length: 2 }),
    billToCountry: varchar("bill_to_country", { length: 100 }).notNull().default("India"),
    billToGstin: varchar("bill_to_gstin", { length: 15 }),
    billToEmail: varchar("bill_to_email", { length: 255 }),
    currency: varchar("currency", { length: 3 }).notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    taxType: varchar("tax_type", { length: 10 }).notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull(),
    cgst: numeric("cgst", { precision: 18, scale: 2 }).notNull().default("0"),
    sgst: numeric("sgst", { precision: 18, scale: 2 }).notNull().default("0"),
    igst: numeric("igst", { precision: 18, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 18, scale: 2 }).notNull(),
    notes: text("notes"),
    terms: text("terms"),
    /** Company profile as it was when issued; issued invoices never change if the profile does. */
    seller: jsonb("seller"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 64 }).notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // drafts only
  },
  (table) => [
    uniqueIndex("uq_invoices_number").on(table.number),
    uniqueIndex("uq_invoices_fy_seq").on(table.fy, table.seq),
    index("idx_invoices_client").on(table.clientId),
    index("idx_invoices_due").on(table.dueDate),
    check("chk_invoices_status", sql`${table.status} IN ('draft', 'sent', 'void')`),
    check("chk_invoices_currency", sql`${table.currency} IN ('INR', 'USD')`),
    check("chk_invoices_tax_type", sql`${table.taxType} IN ('cgst_sgst', 'igst', 'none')`),
    check("chk_invoices_total", sql`${table.total} > 0 AND ${table.subtotal} > 0`),
    check("chk_invoices_dates", sql`${table.dueDate} >= ${table.issueDate}`),
    check("chk_invoices_number_when_issued", sql`(${table.status} = 'draft') = (${table.number} IS NULL)`),
  ],
).enableRLS();

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  },
  (table) => [
    index("idx_invoice_items_invoice").on(table.invoiceId),
    check("chk_invoice_items_positive", sql`${table.quantity} > 0 AND ${table.rate} >= 0`),
  ],
).enableRLS();

// ─── 10. BANK STATEMENT IMPORT (staging only; not financial data) ────────────
// These rows are reviewed before a confirmed transactions row is created.
// Nothing here is joined into dashboard, report, client, invoice or export queries.

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    bankName: varchar("bank_name", { length: 120 }),
    /** Last four digits only; full account numbers are never stored. */
    accountLast4: varchar("account_last4", { length: 4 }),
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: varchar("created_by", { length: 64 }).notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: varchar("deleted_by", { length: 64 }).references(() => appUsers.id),
  },
  (table) => [
    uniqueIndex("uq_bank_accounts_normalized_active_name")
      .on(sql`lower(trim(both from ${table.displayName}))`)
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_bank_accounts_active").on(table.isActive),
    check("chk_bank_accounts_name_not_empty", sql`trim(${table.displayName}) <> ''`),
    check("chk_bank_accounts_currency", sql`${table.currency} IN ('INR', 'USD')`),
    check(
      "chk_bank_accounts_last4",
      sql`${table.accountLast4} IS NULL OR ${table.accountLast4} ~ '^[0-9]{4}$'`,
    ),
  ],
).enableRLS();

export const bankStatements = pgTable(
  "bank_statements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull().references(() => bankAccounts.id),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    pageCount: integer("page_count").notNull(),
    statementFrom: date("statement_from"),
    statementTo: date("statement_to"),
    openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }),
    closingBalance: numeric("closing_balance", { precision: 18, scale: 2 }),
    status: varchar("status", { length: 20 }).notNull().default("review"),
    parserVersion: varchar("parser_version", { length: 20 }),
    errorCode: varchar("error_code", { length: 50 }),
    createdBy: varchar("created_by", { length: 64 }).notNull().references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_bank_statements_active_file_sha256")
      .on(table.fileSha256)
      .where(sql`${table.status} NOT IN ('failed', 'cancelled')`),
    index("idx_bank_statements_status_created").on(table.status, table.createdAt),
    index("idx_bank_statements_account_period").on(table.accountId, table.statementTo),
    check("chk_bank_statements_file", sql`${table.fileSizeBytes} > 0 AND ${table.pageCount} > 0`),
    check("chk_bank_statements_sha256", sql`${table.fileSha256} ~ '^[0-9a-f]{64}$'`),
    check("chk_bank_statements_file_name", sql`trim(${table.fileName}) <> ''`),
    check(
      "chk_bank_statements_dates",
      sql`${table.statementFrom} IS NULL OR ${table.statementTo} IS NULL OR ${table.statementFrom} <= ${table.statementTo}`,
    ),
    check(
      "chk_bank_statements_status",
      sql`${table.status} IN ('review', 'importing', 'completed', 'failed', 'cancelled')`,
    ),
  ],
).enableRLS();

export const bankStatementLines = pgTable(
  "bank_statement_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    statementId: uuid("statement_id").notNull().references(() => bankStatements.id),
    pageNumber: integer("page_number").notNull(),
    rowNumber: integer("row_number").notNull(),
    /** Nullable so an unparseable date row survives review instead of being dropped. */
    txnDate: date("txn_date"),
    valueDate: date("value_date"),
    /** Nullable so a blank/unparseable narration row survives review. */
    narration: text("narration"),
    reference: varchar("reference", { length: 120 }),
    /** Business-friendly description generated from narration; editable in review. */
    businessDescription: text("business_description"),
    withdrawalAmount: numeric("withdrawal_amount", { precision: 18, scale: 2 }),
    depositAmount: numeric("deposit_amount", { precision: 18, scale: 2 }),
    closingBalance: numeric("closing_balance", { precision: 18, scale: 2 }),
    direction: varchar("direction", { length: 10 }),
    classification: varchar("classification", { length: 20 }).notNull().default("unclassified"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    clientId: uuid("client_id").references(() => clients.clientId),
    categoryId: integer("category_id").references(() => categories.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    importedPayloadHash: varchar("imported_payload_hash", { length: 64 }),
    importedCategoryId: integer("imported_category_id").references(() => categories.id),
    /** Starts at 0; bumped only when a consumed key must not be reused (explicit replace). */
    importAttempt: integer("import_attempt").notNull().default(0),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    flags: jsonb("flags").notNull().default(sql`'[]'::jsonb`),
    errorCode: varchar("error_code", { length: 50 }),
    skipReason: varchar("skip_reason", { length: 200 }),
    reviewedBy: varchar("reviewed_by", { length: 64 }).references(() => appUsers.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_bank_statement_lines_position").on(
      table.statementId,
      table.pageNumber,
      table.rowNumber,
    ),
    uniqueIndex("uq_bank_statement_lines_transaction").on(table.transactionId),
    index("idx_bank_statement_lines_statement_status").on(table.statementId, table.status),
    index("idx_bank_statement_lines_fingerprint").on(table.fingerprint),
    index("idx_bank_statement_lines_client").on(table.clientId),
    index("idx_bank_statement_lines_invoice").on(table.invoiceId),
    check(
      "chk_bank_statement_lines_position",
      sql`${table.pageNumber} > 0 AND ${table.rowNumber} > 0`,
    ),
    check(
      "chk_bank_statement_lines_amounts",
      sql`(${table.withdrawalAmount} IS NULL OR ${table.withdrawalAmount} > 0 OR (
          ${table.status} = 'pending' AND (
            (${table.withdrawalAmount} < 0 AND ${table.flags} @> '["NEGATIVE_AMOUNT"]'::jsonb)
            OR (${table.withdrawalAmount} = 0 AND ${table.flags} @> '["ZERO_AMOUNT"]'::jsonb)
          )
        ))
        AND (${table.depositAmount} IS NULL OR ${table.depositAmount} > 0 OR (
          ${table.status} = 'pending' AND (
            (${table.depositAmount} < 0 AND ${table.flags} @> '["NEGATIVE_AMOUNT"]'::jsonb)
            OR (${table.depositAmount} = 0 AND ${table.flags} @> '["ZERO_AMOUNT"]'::jsonb)
          )
        ))`,
    ),
    check(
      "chk_bank_statement_lines_direction",
      sql`${table.direction} IS NULL OR ${table.direction} IN ('deposit', 'withdrawal')`,
    ),
    check(
      "chk_bank_statement_lines_classification",
      sql`${table.classification} IN ('unclassified', 'income', 'expense', 'transfer', 'refund', 'reversal', 'other', 'non_business')`,
    ),
    check(
      "chk_bank_statement_lines_status",
      sql`${table.status} IN ('pending', 'ready', 'imported', 'skipped', 'duplicate', 'error')`,
    ),
    check(
      "chk_bank_statement_lines_ready",
      sql`${table.status} <> 'ready'
        OR (
          ${table.txnDate} IS NOT NULL
          AND ${table.narration} IS NOT NULL
          AND trim(${table.narration}) <> ''
          AND (${table.withdrawalAmount} IS NOT NULL) <> (${table.depositAmount} IS NOT NULL)
          AND (${table.withdrawalAmount} IS NULL OR ${table.withdrawalAmount} > 0)
          AND (${table.depositAmount} IS NULL OR ${table.depositAmount} > 0)
        )`,
    ),
    check(
      "chk_bank_statement_lines_imported",
      sql`(
          ${table.status} = 'imported'
          AND ${table.transactionId} IS NOT NULL
          AND ${table.importedAt} IS NOT NULL
        )
        OR (
          ${table.status} <> 'imported'
          AND ${table.transactionId} IS NULL
        )`,
    ),
    check("chk_bank_statement_lines_fingerprint", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check("chk_bank_statement_lines_import_attempt", sql`${table.importAttempt} >= 0`),
  ],
).enableRLS();
