import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NewTransactionButton } from "@/components/layout/new-transaction-button";
import { PageHeader } from "@/components/layout/page-header";
import { LedgerTable } from "@/components/transactions/ledger-table";
import { Skeleton } from "@/components/ui/skeleton";
import { listLedger } from "@/lib/transactions/queries";

async function Ledger() {
  const rows = await listLedger();
  return <LedgerTable rows={rows} />;
}

export default function TransactionsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Transactions"
        description="Every confirmed income and expense, newest first. Amounts in INR."
        action={<NewTransactionButton />}
      />
      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        }
      >
        <Ledger />
      </Suspense>
    </AppShell>
  );
}
