import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NewTransactionButton } from "@/components/layout/new-transaction-button";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/layout/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatINR, formatShare } from "@/lib/format";
import { clientSummaries } from "@/lib/transactions/queries";

async function ClientsData() {
  const clients = await clientSummaries();
  const totalReceived = clients.reduce((s, c) => s + c.totalReceived, 0);
  const payments = clients.reduce((s, c) => s + c.payments, 0);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="CLIENTS" value={String(clients.length)} />
        <StatTile label="TOTAL RECEIVED" value={formatINR(totalReceived)} />
        <StatTile label="PAYMENTS" value={String(payments)} />
      </div>

      {clients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-title-sm">No clients yet</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            A client is added automatically the first time you record income from them.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((c) => {
            const share = totalReceived > 0 ? (c.totalReceived / totalReceived) * 100 : 0;
            const shareLabel = formatShare(c.totalReceived, totalReceived);
            return (
              <li key={c.id} className="flex flex-col rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-caption font-semibold text-foreground" aria-hidden>
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-title-sm">{c.name}</h2>
                    <p className="text-caption text-muted-foreground">Client since {formatDate(c.firstSeen)}</p>
                  </div>
                </div>

                <dl className="mt-5 space-y-2 border-t border-border pt-4 text-body-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Received</dt>
                    <dd className="font-mono font-semibold tabular-nums text-foreground">{formatINR(c.totalReceived)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Payments</dt>
                    <dd className="tabular-nums text-foreground">{c.payments}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Last payment</dt>
                    <dd className="text-foreground">{c.lastPaymentDate ? formatDate(c.lastPaymentDate) : "None yet"}</dd>
                  </div>
                </dl>

                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${shareLabel} of all income`}>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                </div>
                <p className="mt-1.5 text-caption text-muted-foreground">{shareLabel} of all income</p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default function ClientsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Clients"
        description="Everyone who has paid us, with totals from confirmed income."
        action={<NewTransactionButton label="Record income" />}
      />
      <Suspense
        fallback={
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-60 rounded-xl" />)}
            </div>
          </>
        }
      >
        <ClientsData />
      </Suspense>
    </AppShell>
  );
}
