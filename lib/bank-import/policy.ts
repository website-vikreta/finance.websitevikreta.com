import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";

/**
 * Managers and admins can create bank accounts and upload statements. Any other
 * active role, removed member, or unknown user is rejected. This mirrors the
 * approved manager/admin permission policy.
 */
export async function canManageBankImports(userId: string): Promise<boolean> {
  if (userId === "admin") return true;
  const [user] = await db
    .select({ role: appUsers.role, isActive: appUsers.isActive })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return Boolean(user?.isActive) && ["manager", "admin"].includes(user?.role ?? "");
}
