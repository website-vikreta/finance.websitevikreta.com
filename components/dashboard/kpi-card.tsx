import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface KPICardData {
  id: string;
  label: string;
  /** Rupees, or a plain count when `isCount` is set. */
  amount: number;
  isCount?: boolean;
  /** Short line under the figure, e.g. "+12.4% vs last month". */
  note?: string;
  tone?: "good" | "bad" | "neutral";
}

export function KPICard({ card }: { card: KPICardData }) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-5">
      <p className="text-caption text-muted-foreground">{card.label}</p>
      <p className="mt-2 truncate font-mono text-title-lg tabular-nums text-foreground">
        {card.isCount ? card.amount : formatINR(card.amount)}
      </p>
      {card.note ? (
        <p
          className={cn(
            "mt-1 text-caption tabular-nums",
            card.tone === "good" && "text-success",
            card.tone === "bad" && "text-destructive",
            (!card.tone || card.tone === "neutral") && "text-muted-foreground",
          )}
        >
          {card.note}
        </p>
      ) : null}
    </section>
  );
}
