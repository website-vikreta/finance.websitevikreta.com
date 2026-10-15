import { ArrowLeftRight, BarChart2, CreditCard, Users } from "lucide-react";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface KPICardData {
  id: string;
  label: string;
  /** Rupees, or a plain count when `isCount` is set. */
  amount: number;
  isCount?: boolean;
  badgeText: string;
  badgeType: "positive" | "negative" | "neutral";
  iconName: "credit-card" | "arrow-left-right" | "bar-chart-2" | "users";
}

const icons = {
  "credit-card": CreditCard,
  "arrow-left-right": ArrowLeftRight,
  "bar-chart-2": BarChart2,
  users: Users,
};

export function KPICard({ card }: { card: KPICardData }) {
  const Icon = icons[card.iconName];

  return (
    <section className="flex min-w-0 flex-col justify-between rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
          <Icon className="size-4" aria-hidden />
        </div>
        <span
          className={cn(
            "text-caption border-b-2 pb-1 text-right",
            card.badgeType === "positive" && "border-primary text-foreground",
            card.badgeType === "negative" && "border-destructive text-foreground",
            card.badgeType === "neutral" && "border-border text-muted-foreground",
          )}
        >
          {card.badgeText}
        </span>
      </div>

      <div className="mt-8 min-w-0">
        <p className="text-eyebrow text-muted-foreground">{card.label}</p>
        <p className="mt-2 truncate font-mono text-title-lg tabular-nums text-foreground sm:text-display-sm">
          {card.isCount ? card.amount : formatINR(card.amount)}
        </p>
      </div>
    </section>
  );
}
