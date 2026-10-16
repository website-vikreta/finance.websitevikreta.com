CREATE TABLE "company_profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"legal_name" varchar(255) NOT NULL,
	"address" text NOT NULL,
	"state" varchar(2) NOT NULL,
	"gstin" varchar(15),
	"pan" varchar(10),
	"email" varchar(255),
	"phone" varchar(30),
	"bank_name" varchar(255),
	"account_name" varchar(255),
	"account_number" varchar(34),
	"ifsc" varchar(11),
	"upi_id" varchar(100),
	"invoice_prefix" varchar(10) DEFAULT 'WV' NOT NULL,
	"default_gst_rate" numeric(5, 2) DEFAULT '18' NOT NULL,
	"default_terms" text,
	"updated_by" varchar(64),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_company_profile_single_row" CHECK (id = 1)
);
--> statement-breakpoint
ALTER TABLE "company_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"rate" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	CONSTRAINT "chk_invoice_items_positive" CHECK ("invoice_items"."quantity" > 0 AND "invoice_items"."rate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(40),
	"fy" varchar(7),
	"seq" integer,
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"client_id" uuid NOT NULL,
	"bill_to_name" varchar(255) NOT NULL,
	"bill_to_address" text,
	"bill_to_state" varchar(2),
	"bill_to_country" varchar(100) DEFAULT 'India' NOT NULL,
	"bill_to_gstin" varchar(15),
	"bill_to_email" varchar(255),
	"currency" varchar(3) NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"tax_type" varchar(10) NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"cgst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"notes" text,
	"terms" text,
	"sent_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chk_invoices_status" CHECK ("invoices"."status" IN ('draft', 'sent', 'void')),
	CONSTRAINT "chk_invoices_currency" CHECK ("invoices"."currency" IN ('INR', 'USD')),
	CONSTRAINT "chk_invoices_tax_type" CHECK ("invoices"."tax_type" IN ('cgst_sgst', 'igst', 'none')),
	CONSTRAINT "chk_invoices_total" CHECK ("invoices"."total" > 0 AND "invoices"."subtotal" > 0),
	CONSTRAINT "chk_invoices_dates" CHECK ("invoices"."due_date" >= "invoices"."issue_date"),
	CONSTRAINT "chk_invoices_number_when_issued" CHECK (("invoices"."status" = 'draft') = ("invoices"."number" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "email" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "state" varchar(2);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "country" varchar(100) DEFAULT 'India' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "gstin" varchar(15);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_updated_by_app_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invoice_items_invoice" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_number" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_fy_seq" ON "invoices" USING btree ("fy","seq");--> statement-breakpoint
CREATE INDEX "idx_invoices_client" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_due" ON "invoices" USING btree ("due_date");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_transactions_invoice_id" ON "transactions" USING btree ("invoice_id");