/**
 * Persists Finance AI chat state (draft + state machine) in Postgres so it survives
 * restarts/deploys and works when requests land on different server instances.
 *
 * The in-memory store (lib/chatbot/store.ts) stays the working copy for one request:
 * withChatState() loads the user's row first (only if it is newer than this instance's
 * copy) and writes it back afterwards (only if the request changed something).
 */

import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, chatSessions } from "@/lib/db/schema";
import { requireAuth } from "@/lib/server-auth";
import { clearAll, exportChatState, importChatState, type ChatSessionState } from "./store";
import type { ExtractionResult } from "./extract";

export async function loadChatState(userId: string): Promise<void> {
  const [row] = await db.select().from(chatSessions).where(eq(chatSessions.userId, userId)).limit(1);
  if (!row) return;
  const savedAt = row.updatedAt.getTime();
  if (savedAt <= exportChatState(userId).changedAt) return; // this instance already has the latest
  importChatState(userId, {
    draft: row.draft as ExtractionResult,
    session: row.session as ChatSessionState,
    changedAt: savedAt,
  });
}

export async function saveChatState(userId: string): Promise<void> {
  const { draft, session, changedAt } = exportChatState(userId);
  const updatedAt = new Date(changedAt);
  await db.transaction(async (tx) => {
    await tx.insert(appUsers).values({ id: userId, role: "manager", isActive: true }).onConflictDoNothing();
    await tx
      .insert(chatSessions)
      .values({ userId, draft, session, updatedAt })
      .onConflictDoUpdate({ target: chatSessions.userId, set: { draft, session, updatedAt } });
  });
}

/** A draft nobody touched for this long is dropped, so a forgotten entry never merges into a new one. */
const STALE_DRAFT_MS = 6 * 60 * 60 * 1000;

type Handler = (req: NextRequest) => Promise<NextResponse>;

/** Wraps a chat route handler with load-before / save-after of the user's chat state. */
export function withChatState(handler: Handler): Handler {
  return async (req) => {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { userId } = auth.session;

    try {
      await loadChatState(userId);
    } catch (err) {
      console.error("[chat-state] load failed; continuing with this instance's copy:", err);
    }

    const last = exportChatState(userId).changedAt;
    if (last > 0 && Date.now() - last > STALE_DRAFT_MS) clearAll(userId);

    const before = exportChatState(userId).changedAt;
    const response = await handler(req);

    if (exportChatState(userId).changedAt !== before) {
      try {
        await saveChatState(userId);
      } catch (err) {
        console.error("[chat-state] save failed; the draft may not survive a restart:", err);
      }
    }
    return response;
  };
}
