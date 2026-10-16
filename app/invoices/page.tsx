import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { StatTile } from "@/components/layout/stat-tile";
import { StatusBadge } from "@/components/invoices/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { getCompanyProfile } from "@/lib/invoices/company";
import { listInvoices } from "@/lib/invoices/invoices";
import { STATUS_LABEL, balanceOf, displayStatus, type DisplayStatus } from "@/lib/invoices/math";
import { todayInIndia } from "@/lib/transactions/period";
import { cn } from "@/lib/utils";

export const metadata = { title: "Invoices" };

const TABS = { all: "All", unpaid: "Unpaid", overdue: "Overdue", paid: "Paid", draft: "Drafts", void: "Void" } as const;
type Tab = keyof typeof TABS;
const IN_TAB: Record<Tab, (s: DisplayStatus) => boolean> = {
  all: () => true,
  unpaid: (s) => s === "sent" || s === "partial" || s === "overdue",
  overdue: (s) => s === "overdue",
  paid: (s) => s === "paid",
  draft: (s) => s === "draft",
  void: (s) => s === "void",
};

const fmt = (amount: number, currency: string) =>
  new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", { style: "currency", currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);

/** "₹50,000 + $1,200": INR and USD are never added together. */
function byCurrency(rows: { currency: string; amount: number }[]): string {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.currency, (sums.get(r.currency) ?? 0) + r.amount);
  return sums.size === 0 ? fmt(0, "INR") : [...sums].map(([c, a]) => fmt(a, c)).join(" + ");
}

async function InvoiceList({ tab }: { tab: Tab }) {
  await connection(); // overdue is relative to today
  const today = todayInIndia();
  const [rows, company] = await Promise.all([listInvoices(), getCompanyProfile()]);
  const enriched = rows.map((r) => ({ ...r, display: displayStatus(r, today), balance: Number(balanceOf(r.total, r.paid)) }));
  const unpaid = enriched.filter((r) => IN_TAB.unpaid(r.display));
  const overdue = enriched.filter((r) => r.display === "overdue");
  const visible = enriched.filter((r) => IN_TAB[tab](r.display));

  return (
    <>
      {!company ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-body-sm">
          Set up the company profile in <Link href="/settings" className="font-medium underline">Settings</Link> before creating invoices. It&apos;s printed on every invoice.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-3">
        <StatTile label="Outstanding" value={byCurrency(unpaid.map((r) => ({ currency: r.currency, amount: r.balance })))} note={`${unpaid.length} unpaid`} />
        <StatTile label="Overdue" value={byCurrency(overdue.map((r) => ({ currency: r.currency, amount: r.balance })))} note={`${overdue.length} past due date`} />
        <StatTile label="Drafts" value={String(enriched.filter((r) => r.display === "draft").length)} note="Not issued yet" />
      </div>

      <nav aria-label="Invoice status" className={cn(segmentedTrack, "max-w-full overflow-x-auto")}>
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link key={t} href={t === "all" ? "/invoices" : `/invoices?status=${t}`} aria-current={t === tab ? "page" : undefined} className={segmentedItem(t === tab)}>
            {TABS[t]}
          </Link>
        ))}
      </nav>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {visible.length === 0 ? (
          <p className="px-4 py-14 text-center text-body-sm text-muted-foreground">
            {rows.length === 0 ? "No invoices yet." : "No invoices here."}
          </p>
        ) : (
          <table className="w-full text-left text-body-sm">
            <thead className="border-b border-border bg-muted/60 text-caption text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Invoice</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold @2xl:table-cell">Due</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold @xl:table-cell">Status</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((r) => (
                <tr key={r.id} className="relative transition-colors hover:bg-muted/50">
                  <td className="w-full max-w-0 px-4 py-3.5">
                    <Link href={`/invoices/${r.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                      <p className="truncate font-medium text-foreground">{r.clientName}</p>
                      <p className="truncate text-caption text-muted-foreground">
                        {r.number ?? "Draft"} · {formatDate(r.issueDate)}
                      </p>
                    </Link>
                  </td>
                  <td className={cn("hidden px-4 py-3.5 whitespace-nowrap @2xl:table-cell", r.display === "overdue" ? "text-destructive" : "text-muted-foreground")}>{formatDate(r.dueDate)}</td>
                  <td className="hidden px-4 py-3.5 @xl:table-cell">
                    <StatusBadge status={r.display} />
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    {IN_TAB.unpaid(r.display) ? (
                      <>
                        <p className="font-mono font-semibold tabular-nums">{fmt(r.balance, r.currency)}</p>
                        <p className={cn("text-caption", r.display === "overdue" ? "text-destructive" : "text-muted-foreground")}>
                          {r.balance !== Number(r.total) ? `due of ${fmt(Number(r.total), r.currency)}` : "due"}
                          <span className="@xl:hidden"> · {STATUS_LABEL[r.display]}</span>
                        </p>
                      </>
                    ) : (
                      <>
                        <p className={cn("font-mono font-semibold tabular-nums", r.display === "void" && "text-muted-foreground line-through")}>{fmt(Number(r.total), r.currency)}</p>
                        <p className="text-caption text-muted-foreground @xl:hidden">{STATUS_LABEL[r.display]}</p>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const status = (await searchParams).status;
  const tab: Tab = typeof status === "string" && status in TABS ? (status as Tab) : "all";
  return (
    <Suspense key={tab} fallback={<ListSkeleton />}>
      <InvoiceList tab={tab} />
    </Suspense>
  );
}

function ListSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </>
  );
}

export default function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  return (
    <AppShell>
      <PageHeader
        title="Invoices"
        action={
          <Link href="/invoices/new" className={buttonVariants()}>
            <Plus aria-hidden />
            New invoice
          </Link>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
