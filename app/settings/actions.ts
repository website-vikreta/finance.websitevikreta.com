"use server";

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { hashPassword, isAdmin } from "@/lib/credentials";
import { db } from "@/lib/db";
import { appUsers, auditEvents } from "@/lib/db/schema";
import { requireAuthAction } from "@/lib/server-auth";

export type AddMemberResult = { ok: boolean; error?: string };

const ROLES = ["manager", "admin"] as const;
const ADMIN_ONLY = "Only an admin can manage members.";

/** Admins add a teammate with an email + password they share with them, as a manager or another admin. */
export async function addMemberAction(_prev: AddMemberResult, formData: FormData): Promise<AddMemberResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return { ok: false, error: "Session expired. Sign in again." };
  if (!(await isAdmin(auth.session.userId))) return { ok: false, error: ADMIN_ONLY };

  const email = (formData.get("email")?.toString() ?? "").trim().toLowerCase();
  const password = formData.get("password")?.toString() ?? "";
  const role = formData.get("role")?.toString() ?? "manager";
  if (!ROLES.includes(role as (typeof ROLES)[number])) return { ok: false, error: "Pick a role." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  if (password.length < 8) return { ok: false, error: "Password needs at least 8 characters." };
  if (email === (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase()) return { ok: false, error: "That email is already a member." };

  const [existing] = await db.select({ id: appUsers.id, isActive: appUsers.isActive }).from(appUsers).where(eq(appUsers.email, email)).limit(1);
  if (existing?.isActive) return { ok: false, error: "That email is already a member." };

  // A removed member comes back as the same row, so their old audit history stays linked.
  const id = existing?.id ?? randomUUID();
  try {
    await db.transaction(async (tx) => {
      if (existing) {
        await tx.update(appUsers).set({ isActive: true, role, passwordHash: hashPassword(password), updatedAt: new Date() }).where(eq(appUsers.id, id));
      } else {
        await tx.insert(appUsers).values({ id, email, role, passwordHash: hashPassword(password) });
      }
      await tx.insert(auditEvents).values({
        entityType: "app_user",
        entityId: id,
        action: existing ? "reactivated" : "created",
        performedBy: auth.session.userId,
        source: "manual",
        afterState: { email, role },
      });
    });
  } catch (err) {
    if ((err as { cause?: { code?: string } }).cause?.code === "23505" || (err as { code?: string }).code === "23505") {
      return { ok: false, error: "That email is already a member." };
    }
    throw err;
  }

  revalidatePath("/settings");
  return { ok: true };
}

/** Admins soft-remove a member. The env-configured primary admin and the caller themselves can't be removed. */
export async function removeMemberAction(id: string): Promise<AddMemberResult> {
  const auth = await requireAuthAction();
  if (!auth.ok) return { ok: false, error: "Session expired. Sign in again." };
  if (!(await isAdmin(auth.session.userId))) return { ok: false, error: ADMIN_ONLY };
  if (id === "admin") return { ok: false, error: "The primary admin can't be removed." };
  if (id === auth.session.userId) return { ok: false, error: "You can't remove yourself." };

  await db.transaction(async (tx) => {
    const [removed] = await tx
      .update(appUsers)
      .set({ isActive: false, passwordHash: null, updatedAt: new Date() })
      .where(and(eq(appUsers.id, id), eq(appUsers.isActive, true)))
      .returning({ email: appUsers.email });
    if (!removed) return;
    await tx.insert(auditEvents).values({
      entityType: "app_user",
      entityId: id,
      action: "deactivated",
      performedBy: auth.session.userId,
      source: "manual",
      beforeState: { email: removed.email, isActive: true },
      afterState: { email: removed.email, isActive: false },
    });
  });

  revalidatePath("/settings");
  return { ok: true };
}
