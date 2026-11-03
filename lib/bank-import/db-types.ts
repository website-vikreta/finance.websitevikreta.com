/**
 * Staging-only database types.
 *
 * These types are shared between persistence and the upload route. They are NOT
 * a financial transaction write path.
 */

import { db } from "@/lib/db";

/** A node-postgres database transaction as Drizzle uses it. */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PoolClientResult = DbTx;

/** The app_users row is only inserted as a session anchor; never a financial row. */
export const appUsersForWrite = { id: "app_users" };
