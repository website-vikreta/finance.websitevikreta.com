import { ArrowLeftRight, BarChart2, CreditCard, Users } from "lucide-react";
import { formatINR } from "@/lib/format";
import type { KPICardData } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

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
            "text-caption border-b-2 pb-1 text-right text-foreground",
            card.badgeType === "positive" ? "border-primary" : "border-border",
          )}
        >
          {card.badgeText}
        </span>
      </div>

      <div className="mt-8 min-w-0">
        <p className="text-eyebrow text-muted-foreground">{card.label}</p>
        <p className="mt-2 truncate font-mono text-title-lg tabular-nums text-foreground sm:text-display-sm">
          {formatINR(card.amount)}
        </p>
      </div>
    </section>
  );
}
