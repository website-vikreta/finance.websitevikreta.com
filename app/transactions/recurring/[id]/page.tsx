import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatTile } from "@/components/layout/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatINR } from "@/lib/format";
import { todayInIndia } from "@/lib/transactions/period";
import { getBillDetails } from "@/lib/transactions/recurring";
import type { MonthStatus } from "@/lib/transactions/recurring-dates";
import { cn } from "@/lib/utils";

export const metadata = { title: "Recurring bill" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<MonthStatus, { label: string; className: string }> = {
  paid: { label: "Paid", className: "text-success" },
  part_paid: { label: "Part paid", className: "text-warning" },
  overdue: { label: "Overdue", className: "text-destructive" },
  due: { label: "Due", className: "text-foreground" },
  upcoming: { label: "Upcoming", className: "text-muted-foreground" },
};

const BILL_STATUS = { active: "Active", paused: "Paused", finished: "Finished", stopped: "Stopped" } as const;

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

async function Bill({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await connection(); // overdue is relative to today
  const bill = await getBillDetails(id, todayInIndia());
  if (!bill) notFound();

  const money = (n: number) => (bill.currency === "USD" ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : formatINR(n, { decimals: n % 1 === 0 ? 0 : 2 }));
  const paidMonths = bill.schedule.filter((m) => m.status === "paid").length;
  const open = bill.schedule.find((m) => m.status !== "paid");

  return (
    <>
      <div className="min-w-0 space-y-2">
        <Link href="/transactions?view=recurring" className="inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden />
          Recurring bills
        </Link>
        <h1 className="text-title-lg break-words md:text-display-sm">{bill.description}</h1>
        <p className="text-caption text-muted-foreground">{[bill.category, bill.clientName, BILL_STATUS[bill.status]].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="grid grid-cols-2 gap-6 @4xl:grid-cols-4">
        <StatTile label="Every month" value={money(bill.amount)} note={`Due on the ${ordinal(bill.anchorDay)}${bill.anchorDay >= 29 ? " (or last day)" : ""}`} />
        <StatTile label="Months paid" value={String(paidMonths)} note={bill.endDate ? `of ${bill.schedule.length}` : "Ongoing"} />
        <StatTile
          label="Next due"
          value={bill.status === "finished" || !open ? "—" : formatDate(open.due)}
          note={open && bill.status !== "finished" ? STATUS[open.status].label : undefined}
        />
        <StatTile label="Started" value={formatDate(bill.firstDue)} note={bill.endDate ? `Ends ${formatDate(bill.endDate)}` : `Added ${formatDate(bill.addedOn)}`} />
      </div>

      <section className="space-y-4">
        <h2 className="text-title-md">Months</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-body-sm">
            <thead className="border-b border-border bg-muted/60 text-caption text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Due</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bill.schedule.map((m) => (
                <tr key={m.due}>
                  <td className="px-4 py-3 text-foreground">{formatDate(m.due)}</td>
                  <td className={cn("px-4 py-3 font-medium", STATUS[m.status].className)}>
                    {STATUS[m.status].label}
                    {m.status === "part_paid" ? <span className="ml-1 font-normal text-muted-foreground">· {money(bill.amount - bill.paid)} left</span> : null}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{money(bill.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-title-md">Payments ({bill.payments.length})</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {bill.payments.length === 0 ? (
            <p className="px-6 py-12 text-center text-body-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <table className="w-full text-left text-body-sm">
              <thead className="border-b border-border bg-muted/60 text-caption text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Paid on</th>
                  <th scope="col" className="px-4 py-3 font-medium">For month</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bill.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 text-foreground">{formatDate(p.date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(p.due)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{p.currency === "USD" ? `$${p.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : formatINR(p.amount, { decimals: p.amount % 1 === 0 ? 0 : 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

// The whole shell renders at request time: the sidebar reads the URL, which has an id.
export default function BillPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-[48rem] rounded-xl" />}>
      <AppShell>
        <Bill params={params} />
      </AppShell>
    </Suspense>
  );
}
