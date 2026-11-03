/**
 * Remembers the last screen a reviewer visited inside the bank-connections
 * section — the list or one specific statement review — so returning to the
 * section from another page lands exactly where they were, through a soft
 * client navigation.
 *
 * Browser-local on purpose: it survives sidebar navigations and reloads with
 * no server round-trip, and a per-device convenience like this has nothing to
 * persist in the database. Used only by "use client" components, which read
 * it through the snapshot/subscribe pair below (useSyncExternalStore) instead
 * of React state, so the entry component never cascades renders.
 */

const STORAGE_KEY = "finance.bank-connections.section";

export type SectionLocation =
  | { kind: "list" }
  | { kind: "statement"; statementId: string };

type Snapshot = SectionLocation | { readonly kind: "hydrating" };

/**
 * What getServerSnapshot returns while the memory is unreadable (SSR and the
 * hydration render), including during the first client paint. The entry
 * component renders its skeleton for this value; after hydration React
 * switches to the real snapshot.
 */
const HYDRATING: Snapshot = { kind: "hydrating" };

/** Raw storage read: validated, or null when absent/corrupted/unavailable. */
export function readSectionLocation(): SectionLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "kind" in parsed) {
      const record = parsed as { kind: unknown; statementId?: unknown };
      if (record.kind === "list") return { kind: "list" };
      if (record.kind === "statement" && typeof record.statementId === "string") {
        return { kind: "statement", statementId: record.statementId };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The external store. The snapshot is cached so repeated reads return a
 * stable value (useSyncExternalStore compares with Object.is); writes update
 * the cache and notify subscribers. An absent/corrupted memory reads as the
 * list, which is also what the entry component writes back when staying.
 */
const listeners = new Set<() => void>();
let cache: SectionLocation | null = null;

function currentSnapshot(): Snapshot {
  if (cache === null) {
    cache = readSectionLocation() ?? { kind: "list" };
  }
  return cache;
}

function sameLocation(a: Snapshot, b: SectionLocation): boolean {
  if (a.kind === "hydrating" || a.kind !== b.kind) return false;
  if (a.kind === "statement" && b.kind === "statement") {
    return a.statementId === b.statementId;
  }
  return true;
}

export function subscribeSectionLocation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSectionLocationSnapshot(): Snapshot {
  return currentSnapshot();
}

export function getSectionLocationServerSnapshot(): Snapshot {
  return HYDRATING;
}

export function writeSectionLocation(location: SectionLocation): void {
  if (typeof window === "undefined") return;
  try {
    if (cache !== null && sameLocation(cache, location)) return; // duplicate writes are no-ops
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    cache = location;
    for (const listener of listeners) listener();
  } catch {
    // Storage unavailable (private mode, quota): resume simply degrades to
    // the list. Never worth breaking a page render over.
  }
}
