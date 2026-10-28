-- Add the "Contractor Payment" expense category (same list as lib/transactions/categories.ts).
INSERT INTO "categories" ("name") VALUES ('Contractor Payment') ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
-- SWIFT/BIC for international payments, alongside IFSC (max 11 chars, same shape as "ifsc").
ALTER TABLE "company_profile" ADD COLUMN "swift_code" varchar(11);
