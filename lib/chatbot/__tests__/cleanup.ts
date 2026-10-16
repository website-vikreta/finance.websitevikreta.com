/**
 * The chat E2E suites confirm real transactions through the API, which writes to the
 * configured database. Soft-delete what a dedicated test identity created so live totals
 * stay true. Audit history is kept: each removal appends a "deleted" event with a reason,
 * which also keeps these rows out of "Recently deleted" (see RESTORABLE in queries.ts).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

export async function removeTestRows(userId: string): Promise<number> {
  const result = await db.execute(sql`
    WITH removed AS (
      UPDATE "transactions" SET "deleted_at" = now(), "deleted_by" = ${userId}, "updated_at" = now()
      WHERE "created_by" = ${userId} AND "deleted_at" IS NULL
      RETURNING "id"
    )
    INSERT INTO "audit_events" ("entity_type", "entity_id", "action", "performed_by", "source", "metadata")
    SELECT 'transaction', id::text, 'deleted', ${userId}, 'test', ${JSON.stringify({ reason: "test-suite cleanup" })}::jsonb
    FROM removed
    RETURNING "entity_id"
  `);
  return result.rows.length;
}
