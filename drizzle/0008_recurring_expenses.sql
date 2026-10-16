CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"description" varchar(200) NOT NULL,
	"category_id" integer NOT NULL,
	"original_amount" numeric(18, 2) NOT NULL,
	"original_currency" varchar(3) NOT NULL,
	"frequency" varchar(10) NOT NULL,
	"anchor_day" integer NOT NULL,
	"next_due" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chk_recurring_amount" CHECK ("recurring_expenses"."original_amount" > 0),
	CONSTRAINT "chk_recurring_currency" CHECK ("recurring_expenses"."original_currency" IN ('INR', 'USD')),
	CONSTRAINT "chk_recurring_frequency" CHECK ("recurring_expenses"."frequency" IN ('monthly', 'yearly')),
	CONSTRAINT "chk_recurring_anchor_day" CHECK ("recurring_expenses"."anchor_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
ALTER TABLE "recurring_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recurring_next_due" ON "recurring_expenses" USING btree ("next_due");