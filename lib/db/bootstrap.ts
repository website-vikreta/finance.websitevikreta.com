import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import { appUsers } from "./schema";

async function bootstrapManagerEmail() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();

  if (!adminEmail) {
    console.log("No ADMIN_EMAIL environment variable found. app_users.email left unchanged.");
    await pool.end();
    return;
  }

  console.log("Binding configured Manager email to app_users table...");

  await db
    .update(appUsers)
    .set({
      email: adminEmail,
      updatedAt: new Date(),
    })
    .where(eq(appUsers.id, "admin"));

  console.log("✓ Manager email successfully bound to 'admin' identity.");
  await pool.end();
}

bootstrapManagerEmail().catch(async (err) => {
  console.error("Bootstrap failed:", err);
  await pool.end();
  process.exit(1);
});
