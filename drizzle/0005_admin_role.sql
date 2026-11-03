-- The env-configured primary admin was seeded as "manager"; roles now gate member management.
UPDATE "app_users" SET "role" = 'admin', "updated_at" = now() WHERE "id" = 'admin';
