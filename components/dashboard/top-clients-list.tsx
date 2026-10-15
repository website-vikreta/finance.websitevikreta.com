import Link from "next/link";
import { Users } from "lucide-react";
import { formatDate, formatINR } from "@/lib/format";
import type { ClientSummary } from "@/lib/transactions/queries";

interface TopClientsListProps {
  clients: ClientSummary[];
}

const VISIBLE = 5;

export function TopClientsList({ clients }: TopClientsListProps) {
  const paying = clients.filter((c) => c.totalReceived > 0);
  const total = paying.reduce((sum, c) => sum + c.totalReceived, 0);
  const top = paying.slice(0, VISIBLE);

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-6" aria-labelledby="top-clients-title">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 id="top-clients-title" className="text-title-md">Top clients</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {paying.length > 0
              ? `${formatINR(total, { compact: true })} received from ${paying.length} ${paying.length === 1 ? "client" : "clients"}`
              : "No client payments yet"}
          </p>
        </div>
        <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Users className="size-4" aria-hidden />
        </div>
      </div>

      {top.length === 0 ? (
        <p className="mt-5 text-body-sm text-muted-foreground">
          Record an income in Finance AI and the client shows up here.
        </p>
      ) : (
        <ul className="mt-5 space-y-6">
          {top.map((client) => {
            const share = Math.round((client.totalReceived / total) * 100);
            return (
              <li key={client.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-title-sm">{client.name}</h3>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {client.payments} {client.payments === 1 ? "payment" : "payments"}
                      {client.lastPaymentDate ? ` · last ${formatDate(client.lastPaymentDate)}` : null}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-title-sm tabular-nums text-foreground">
                    {formatINR(client.totalReceived)}
                  </p>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${share}% of total income`}
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {paying.length > VISIBLE ? (
        <Link href="/clients" className="mt-auto pt-6 text-caption font-medium text-foreground underline-offset-4 hover:underline">
          View all {paying.length} clients
        </Link>
      ) : null}
    </section>
  );
}
