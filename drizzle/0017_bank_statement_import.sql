CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"bank_name" varchar(120),
	"account_last4" varchar(4),
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" varchar(64),
	CONSTRAINT "chk_bank_accounts_name_not_empty" CHECK (trim("bank_accounts"."display_name") <> ''),
	CONSTRAINT "chk_bank_accounts_currency" CHECK ("bank_accounts"."currency" IN ('INR', 'USD')),
	CONSTRAINT "chk_bank_accounts_last4" CHECK ("bank_accounts"."account_last4" IS NULL OR "bank_accounts"."account_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"row_number" integer NOT NULL,
	"txn_date" date,
	"value_date" date,
	"narration" text,
	"reference" varchar(120),
	"withdrawal_amount" numeric(18, 2),
	"deposit_amount" numeric(18, 2),
	"closing_balance" numeric(18, 2),
	"direction" varchar(10),
	"classification" varchar(20) DEFAULT 'unclassified' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"client_id" uuid,
	"category_id" integer,
	"invoice_id" uuid,
	"transaction_id" uuid,
	"imported_payload_hash" varchar(64),
	"imported_category_id" integer,
	"import_attempt" integer DEFAULT 0 NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" varchar(50),
	"skip_reason" varchar(200),
	"reviewed_by" varchar(64),
	"reviewed_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_bank_statement_lines_position" CHECK ("bank_statement_lines"."page_number" > 0 AND "bank_statement_lines"."row_number" > 0),
	CONSTRAINT "chk_bank_statement_lines_amounts" CHECK (("bank_statement_lines"."withdrawal_amount" IS NULL OR "bank_statement_lines"."withdrawal_amount" > 0)
        AND ("bank_statement_lines"."deposit_amount" IS NULL OR "bank_statement_lines"."deposit_amount" > 0)),
	CONSTRAINT "chk_bank_statement_lines_direction" CHECK ("bank_statement_lines"."direction" IS NULL OR "bank_statement_lines"."direction" IN ('deposit', 'withdrawal')),
	CONSTRAINT "chk_bank_statement_lines_classification" CHECK ("bank_statement_lines"."classification" IN ('unclassified', 'income', 'expense', 'transfer', 'refund', 'reversal', 'other', 'non_business')),
	CONSTRAINT "chk_bank_statement_lines_status" CHECK ("bank_statement_lines"."status" IN ('pending', 'ready', 'imported', 'skipped', 'duplicate', 'error')),
	CONSTRAINT "chk_bank_statement_lines_ready" CHECK ("bank_statement_lines"."status" <> 'ready'
        OR (
          "bank_statement_lines"."txn_date" IS NOT NULL
          AND "bank_statement_lines"."narration" IS NOT NULL
          AND trim("bank_statement_lines"."narration") <> ''
          AND ("bank_statement_lines"."withdrawal_amount" IS NOT NULL) <> ("bank_statement_lines"."deposit_amount" IS NOT NULL)
        )),
	CONSTRAINT "chk_bank_statement_lines_imported" CHECK ((
          "bank_statement_lines"."status" = 'imported'
          AND "bank_statement_lines"."transaction_id" IS NOT NULL
          AND "bank_statement_lines"."imported_at" IS NOT NULL
        )
        OR (
          "bank_statement_lines"."status" <> 'imported'
          AND "bank_statement_lines"."transaction_id" IS NULL
        )),
	CONSTRAINT "chk_bank_statement_lines_fingerprint" CHECK ("bank_statement_lines"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_bank_statement_lines_import_attempt" CHECK ("bank_statement_lines"."import_attempt" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"page_count" integer NOT NULL,
	"statement_from" date,
	"statement_to" date,
	"opening_balance" numeric(18, 2),
	"closing_balance" numeric(18, 2),
	"status" varchar(20) DEFAULT 'review' NOT NULL,
	"parser_version" varchar(20),
	"error_code" varchar(50),
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "chk_bank_statements_file" CHECK ("bank_statements"."file_size_bytes" > 0 AND "bank_statements"."page_count" > 0),
	CONSTRAINT "chk_bank_statements_sha256" CHECK ("bank_statements"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_bank_statements_file_name" CHECK (trim("bank_statements"."file_name") <> ''),
	CONSTRAINT "chk_bank_statements_dates" CHECK ("bank_statements"."statement_from" IS NULL OR "bank_statements"."statement_to" IS NULL OR "bank_statements"."statement_from" <= "bank_statements"."statement_to"),
	CONSTRAINT "chk_bank_statements_status" CHECK ("bank_statements"."status" IN ('review', 'importing', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "bank_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_deleted_by_app_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_imported_category_id_categories_id_fk" FOREIGN KEY ("imported_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_reviewed_by_app_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bank_accounts_normalized_active_name" ON "bank_accounts" USING btree (lower(trim(both from "display_name"))) WHERE "bank_accounts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_bank_accounts_active" ON "bank_accounts" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bank_statement_lines_position" ON "bank_statement_lines" USING btree ("statement_id","page_number","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bank_statement_lines_transaction" ON "bank_statement_lines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_bank_statement_lines_statement_status" ON "bank_statement_lines" USING btree ("statement_id","status");--> statement-breakpoint
CREATE INDEX "idx_bank_statement_lines_fingerprint" ON "bank_statement_lines" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "idx_bank_statement_lines_client" ON "bank_statement_lines" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_bank_statement_lines_invoice" ON "bank_statement_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bank_statements_active_file_sha256" ON "bank_statements" USING btree ("file_sha256") WHERE "bank_statements"."status" NOT IN ('failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "idx_bank_statements_status_created" ON "bank_statements" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_bank_statements_account_period" ON "bank_statements" USING btree ("account_id","statement_to");