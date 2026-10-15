import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";
import * as path from "path";

async function runMigrations() {
  const migrationsFolder = path.resolve(__dirname, "../../../drizzle");
  console.log(`Running migrations from: ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("✓ Migrations applied successfully!");
  await pool.end();
}

runMigrations().catch(async (err) => {
  console.error("Migration failed:", err);
  await pool.end();
  process.exit(1);
});
