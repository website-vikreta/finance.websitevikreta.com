CREATE TABLE "app_users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"email" varchar(255),
	"role" varchar(50) DEFAULT 'manager' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"action" varchar(50) NOT NULL,
	"performed_by" varchar(64) NOT NULL,
	"source" varchar(50) NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"client_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" varchar(64),
	CONSTRAINT "chk_client_name_not_empty" CHECK (trim("clients"."client_name") <> '')
);
--> statement-breakpoint
CREATE TABLE "transaction_types" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" integer NOT NULL,
	"client_id" uuid,
	"client_name_snapshot" varchar(255),
	"original_amount_minor" bigint NOT NULL,
	"original_currency" varchar(3) NOT NULL,
	"inr_amount_minor" bigint NOT NULL,
	"exchange_rate" numeric(12, 4),
	"exchange_rate_date" date,
	"rate_source" varchar(50),
	"description" text,
	"txn_date" date NOT NULL,
	"source" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "chk_transactions_amounts" CHECK ("transactions"."original_amount_minor" > 0 AND "transactions"."inr_amount_minor" > 0),
	CONSTRAINT "chk_transactions_currency_rules" CHECK (
        ("transactions"."original_currency" = 'INR' 
          AND "transactions"."exchange_rate" IS NULL 
          AND "transactions"."exchange_rate_date" IS NULL 
          AND "transactions"."rate_source" IS NULL 
          AND "transactions"."inr_amount_minor" = "transactions"."original_amount_minor")
        OR
        ("transactions"."original_currency" = 'USD' 
          AND "transactions"."exchange_rate" IS NOT NULL 
          AND "transactions"."exchange_rate" > 0 
          AND "transactions"."exchange_rate_date" IS NOT NULL 
          AND "transactions"."rate_source" IS NOT NULL 
          AND "transactions"."rate_source" = 'manual' 
          AND "transactions"."inr_amount_minor" > 0)
      ),
	CONSTRAINT "chk_transactions_type_requirements" CHECK (
        ("transactions"."type_id" = 1 AND "transactions"."client_id" IS NOT NULL)
        OR
        ("transactions"."type_id" = 2 AND "transactions"."description" IS NOT NULL AND trim("transactions"."description") <> '')
      ),
	CONSTRAINT "chk_transactions_valid_enums" CHECK (
        "transactions"."original_currency" IN ('INR', 'USD') AND
        "transactions"."source" IN ('chatbot', 'manual', 'bank_import') AND
        "transactions"."status" = 'confirmed'
      )
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_performed_by_app_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_deleted_by_app_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_id_transaction_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."transaction_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_deleted_by_app_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_app_users_role" ON "app_users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_audit_events_entity" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_events_created_at" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_events_performer" ON "audit_events" USING btree ("performed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_clients_normalized_active_name" ON "clients" USING btree (lower(trim(both from "client_name"))) WHERE "clients"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_clients_deleted_at" ON "clients" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_transactions_txn_date" ON "transactions" USING btree ("txn_date");--> statement-breakpoint
CREATE INDEX "idx_transactions_type_date" ON "transactions" USING btree ("type_id","txn_date");--> statement-breakpoint
CREATE INDEX "idx_transactions_client_id" ON "transactions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_deleted_at" ON "transactions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_transactions_source" ON "transactions" USING btree ("source");
--> statement-breakpoint
-- Seed: Manager identity anchor (matches existing session userId = 'admin')
INSERT INTO "app_users" ("id", "role", "is_active")
VALUES ('admin', 'manager', true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Seed: Fixed transaction types (1 = income, 2 = expense)
INSERT INTO "transaction_types" ("id", "code", "display_name", "description")
VALUES
  (1, 'income', 'Income', 'Company incoming revenue and client receipts'),
  (2, 'expense', 'Expense', 'Company outgoing operational and vendor expenses')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Engine-enforced audit immutability trigger
CREATE OR REPLACE FUNCTION trg_fn_audit_events_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: updates and deletes are prohibited.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_immutable
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_events_immutable();