import { cn } from "@/lib/utils";

/**
 * Segmented control styles (type filter, report period). Plain class helpers so the same
 * look works on client <button role="tab"> and server <Link aria-current> alike.
 */
export const segmentedTrack = "flex w-fit items-center gap-1 rounded-lg bg-muted p-1";

export function segmentedItem(active: boolean): string {
  return cn(
    "rounded-md px-3 py-1.5 text-caption whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
  );
}
