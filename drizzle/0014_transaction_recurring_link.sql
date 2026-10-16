ALTER TABLE "transactions" ADD COLUMN "recurring_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_due" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_settled" boolean;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "chk_transactions_recurring_link" CHECK (("recurring_id" IS NULL) = ("recurring_due" IS NULL) AND ("recurring_id" IS NULL) = ("recurring_settled" IS NULL));--> statement-breakpoint
CREATE INDEX "idx_transactions_recurring_id" ON "transactions" USING btree ("recurring_id");
