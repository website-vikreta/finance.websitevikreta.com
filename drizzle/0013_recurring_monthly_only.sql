-- Recurring bills are monthly only. Refuse to run if a yearly bill exists, rather than silently turning it monthly.
-- (The column itself is dropped in 0016.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "recurring_expenses" WHERE "frequency" <> 'monthly') THEN
    RAISE EXCEPTION 'recurring_expenses has non-monthly bills; convert or stop them first';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ALTER COLUMN "frequency" SET DEFAULT 'monthly';--> statement-breakpoint
ALTER TABLE "recurring_expenses" DROP CONSTRAINT "chk_recurring_frequency";--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "chk_recurring_frequency" CHECK ("frequency" = 'monthly');
