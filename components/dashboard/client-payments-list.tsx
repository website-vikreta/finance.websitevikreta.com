import { CreditCard } from "lucide-react";
import { formatINR } from "@/lib/format";
import type { ClientPayment } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface ClientPaymentsListProps {
  payments: ClientPayment[];
}

const progressColor = {
  paid: "bg-success",
  due: "bg-primary",
  overdue: "bg-expense",
};

export function ClientPaymentsList({ payments }: ClientPaymentsListProps) {
  return (
    <section className="rounded-xl border border-border bg-card p-6" aria-labelledby="client-payments-title">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 id="client-payments-title" className="text-title-md">Client payments</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">₹2.14L outstanding</p>
        </div>
        <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
          <CreditCard className="size-4" aria-hidden />
        </div>
      </div>

      <div className="mt-5 space-y-6">
        {payments.map((payment) => (
          <div key={payment.id} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-title-sm">{payment.clientName}</h3>
                <p className="mt-1 text-caption text-muted-foreground">{payment.statusText}</p>
              </div>
              <p className="shrink-0 font-mono text-title-sm tabular-nums text-foreground">
                {formatINR(payment.amount)}
              </p>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${payment.progressPercent}% paid`}>
              <div className={cn("h-full rounded-full", progressColor[payment.status])} style={{ width: `${payment.progressPercent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
