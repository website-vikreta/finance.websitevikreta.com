ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "chk_transactions_amounts";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "chk_transactions_currency_rules";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "original_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "amount_inr" numeric(18, 2);--> statement-breakpoint
UPDATE "transactions"
SET "original_amount" = ("original_amount_minor"::numeric / 100)::numeric(18, 2),
    "amount_inr" = ("inr_amount_minor"::numeric / 100)::numeric(18, 2);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "original_amount" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amount_inr" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "original_amount_minor";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "inr_amount_minor";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "chk_transactions_amounts" CHECK ("transactions"."original_amount" > 0 AND "transactions"."amount_inr" > 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "chk_transactions_currency_rules" CHECK (
  ("transactions"."original_currency" = 'INR' 
    AND "transactions"."exchange_rate" IS NULL 
    AND "transactions"."exchange_rate_date" IS NULL 
    AND "transactions"."rate_source" IS NULL 
    AND "transactions"."amount_inr" = "transactions"."original_amount")
  OR
  ("transactions"."original_currency" = 'USD' 
    AND "transactions"."exchange_rate" IS NOT NULL 
    AND "transactions"."exchange_rate" > 0 
    AND "transactions"."exchange_rate_date" IS NOT NULL 
    AND "transactions"."rate_source" IS NOT NULL 
    AND "transactions"."rate_source" = 'manual' 
    AND "transactions"."amount_inr" > 0)
);
