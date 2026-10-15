import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NewTransactionButton } from "@/components/layout/new-transaction-button";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/layout/stat-tile";
import { ClientsGrid } from "@/components/clients/clients-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { formatINR } from "@/lib/format";
import { clientSummaries } from "@/lib/transactions/queries";

export const metadata = { title: "Clients" };

async function ClientsData() {
  const clients = await clientSummaries();
  const totalReceived = clients.reduce((s, c) => s + c.totalReceived, 0);
  const payments = clients.reduce((s, c) => s + c.payments, 0);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-3">
        <StatTile label="Clients" value={String(clients.length)} />
        <StatTile label="Total received" value={formatINR(totalReceived)} />
        <StatTile label="Payments" value={String(payments)} />
      </div>

      {clients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-title-sm">No clients yet</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            A client is added automatically the first time you record income from them.
          </p>
        </div>
      ) : (
        <ClientsGrid clients={clients} />
      )}
    </>
  );
}

export default function ClientsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Clients"
        action={<NewTransactionButton label="Record income" />}
      />
      <Suspense
        fallback={
          <>
            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
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
