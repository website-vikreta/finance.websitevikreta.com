import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { NewTransactionButton } from "@/components/layout/new-transaction-button";
import { PageHeader } from "@/components/layout/page-header";
import { LedgerTable } from "@/components/transactions/ledger-table";
import { RecentlyDeleted } from "@/components/transactions/recently-deleted";
import { Skeleton } from "@/components/ui/skeleton";
import { listDeleted, listLedger } from "@/lib/transactions/queries";

export const metadata = { title: "Transactions" };

async function Ledger() {
  const [rows, deleted] = await Promise.all([listLedger(), listDeleted()]);
  return (
    <>
      <LedgerTable rows={rows} />
      <RecentlyDeleted rows={deleted} />
    </>
  );
}

export default function TransactionsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Transactions"
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
