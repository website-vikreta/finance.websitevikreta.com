import {
  pgTable,
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
    role: varchar("role", { length: 50 }).notNull().default("manager"), // Always "manager"
    isActive: boolean("is_active").notNull().default(true),
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
