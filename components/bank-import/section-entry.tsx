"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getSectionLocationServerSnapshot,
  getSectionLocationSnapshot,
  subscribeSectionLocation,
  writeSectionLocation,
} from "@/lib/bank-import/section-memory";

/**
 * Decides what opening `/bank-connections` means using the section's
 * last-visited memory: straight back into the remembered statement review
 * (when it still exists), otherwise the list. The redirect is a client
 * `router.replace` — the same soft App-Router navigation every other page
 * uses — never a server `redirect()`, which this page's streamed
 * partial-prerender segment would turn into a full-document (MPA) reload.
 *
 * The memory is read as an external store, not React state: the server (and
 * the hydration render) sees `hydrating` and renders the skeleton, and the
 * real decision lands with the first post-hydration snapshot. `resume=false`
 * (the `?list=1` visit) always shows the list and re-remembers it, so the
 * review page's back link stays a reliable escape.
 */
export function BankConnectionsEntry({
  statementIds,
  resume,
  children,
}: {
  statementIds: string[];
  resume: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const location = useSyncExternalStore(
    subscribeSectionLocation,
    getSectionLocationSnapshot,
    getSectionLocationServerSnapshot,
  );

  const rememberedStatement =
    resume && location.kind === "statement" && statementIds.includes(location.statementId)
      ? location.statementId
      : null;

  useEffect(() => {
    if (location.kind === "hydrating") return;
    if (rememberedStatement) {
      router.replace(`/bank-connections/${rememberedStatement}`);
      return;
    }
    // Staying on the list is itself a visit: remember it as the section's
    // last screen (also forgets a deleted statement's stale reference).
    // Writing an unchanged location is a no-op, so this never loops.
    writeSectionLocation({ kind: "list" });
  }, [location, rememberedStatement, router]);

  if (location.kind === "hydrating" || rememberedStatement) {
    return <Skeleton className="h-[38rem] rounded-xl" />;
  }

  return <>{children}</>;
}

/**
 * Marks a statement screen as the section's last visited location. Covers
 * every status — review, resumed import batch, completed history — so
 * whichever statement the reviewer was looking at is the one a later sidebar
 * click reopens. Renders nothing.
 */
export function TrackStatementVisit({ statementId }: { statementId: string }) {
  useEffect(() => {
    writeSectionLocation({ kind: "statement", statementId });
  }, [statementId]);

  return null;
}
