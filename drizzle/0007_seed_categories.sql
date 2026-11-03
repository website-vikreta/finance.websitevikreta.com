-- Seed the expense categories (same list as lib/transactions/categories.ts).
INSERT INTO "categories" ("name") VALUES
  ('Rent'), ('Salaries'), ('Software & subscriptions'), ('Cloud & hosting'), ('Office supplies'),
  ('Marketing'), ('Travel'), ('Utilities'), ('Food & refreshments'), ('Other')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
-- One-time best guess for existing expenses by description; each change is audited and editable later.
WITH mapped AS (
  SELECT t.id,
    CASE
      WHEN t.description ~* '\mrent\M' THEN 'Rent'
      WHEN t.description ~* '(salary|salaries|payroll|stipend)' THEN 'Salaries'
      WHEN t.description ~* '(subscri|claude|make\.com|software|licen[cs]e|saas)' THEN 'Software & subscriptions'
      WHEN t.description ~* '(cloud|server|hosting|domain|aws|vercel)' THEN 'Cloud & hosting'
      WHEN t.description ~* '(\mpens?\M|notebook|stationery|paper|printer)' THEN 'Office supplies'
      WHEN t.description ~* '(\mads?\M|marketing|promotion|campaign)' THEN 'Marketing'
      WHEN t.description ~* '(travel|flight|train|cab|uber|ola|hotel)' THEN 'Travel'
      WHEN t.description ~* '(internet|wifi|electric|water|phone)' THEN 'Utilities'
      WHEN t.description ~* '(shevpav|\mtea\M|chai|coffee|lunch|dinner|snack|food)' THEN 'Food & refreshments'
      ELSE 'Other'
    END AS category
  FROM "transactions" t
  WHERE t."type_id" = 2 AND t."category_id" IS NULL
),
updated AS (
  UPDATE "transactions" t SET "category_id" = c."id", "updated_at" = now()
  FROM mapped m JOIN "categories" c ON c."name" = m.category
  WHERE t."id" = m."id"
  RETURNING t."id", c."name"
)
INSERT INTO "audit_events" ("entity_type", "entity_id", "action", "performed_by", "source", "after_state", "metadata")
SELECT 'transaction', u."id"::text, 'updated', 'admin', 'migration', jsonb_build_object('category', u."name"), '{"reason": "category backfill"}'::jsonb
FROM updated u;
