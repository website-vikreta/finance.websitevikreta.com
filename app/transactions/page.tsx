import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { NewTransactionButton } from "@/components/layout/new-transaction-button";
import { PageHeader } from "@/components/layout/page-header";
import { LedgerTable } from "@/components/transactions/ledger-table";
import { RecentlyDeleted } from "@/components/transactions/recently-deleted";
import { RecurringList } from "@/components/transactions/recurring-list";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { todayInIndia } from "@/lib/transactions/period";
import { listCategories, listDeleted, listLedger } from "@/lib/transactions/queries";
import { listFinished, listRecurring } from "@/lib/transactions/recurring";
import { cn } from "@/lib/utils";

export const metadata = { title: "Transactions" };

const VIEWS = { all: "All", recurring: "Recurring" } as const;
type View = keyof typeof VIEWS;

async function Ledger() {
  const [rows, deleted, categories] = await Promise.all([listLedger(), listDeleted(), listCategories()]);
  return (
    <>
      <LedgerTable rows={rows} categories={categories} />
      <div className="print:hidden">
        <RecentlyDeleted rows={deleted} />
      </div>
    </>
  );
}

async function Recurring() {
  await connection(); // "due in N days" is relative to today
  const [rows, finished] = await Promise.all([listRecurring(), listFinished()]);
  return <RecurringList rows={rows} finished={finished} today={todayInIndia()} />;
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view: View = (await searchParams).view === "recurring" ? "recurring" : "all";
  return (
    <>
      <nav aria-label="Transactions view" className={cn(segmentedTrack, "print:hidden")}>
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link key={v} href={v === "all" ? "/transactions" : `/transactions?view=${v}`} aria-current={v === view ? "page" : undefined} className={segmentedItem(v === view)}>
            {VIEWS[v]}
          </Link>
        ))}
      </nav>
      <Suspense key={view} fallback={<ListSkeleton />}>
        {view === "recurring" ? <Recurring /> : <Ledger />}
      </Suspense>
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <AppShell>
      <div className="print:hidden">
        <PageHeader title="Transactions" action={<NewTransactionButton />} />
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
