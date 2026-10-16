import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { InvoiceDocument } from "@/components/invoices/invoice-document";
import { StatusBadge } from "@/components/invoices/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatINR } from "@/lib/format";
import { getCompanyProfile } from "@/lib/invoices/company";
import { getInvoice } from "@/lib/invoices/invoices";
import { balanceOf, displayStatus } from "@/lib/invoices/math";
import { todayInIndia } from "@/lib/transactions/period";

export const metadata = { title: "Invoice" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Invoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await connection(); // overdue is relative to today
  const [invoice, company] = await Promise.all([getInvoice(id), getCompanyProfile()]);
  const effectiveCompany = invoice?.seller ?? company;
  if (!invoice || !effectiveCompany) notFound();
  const status = displayStatus(invoice, todayInIndia());
  const money = (n: string) => (invoice.currency === "USD" ? `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : formatINR(Number(n), { decimals: 2 }));

  return (
    <>
      <div className="flex flex-col gap-4 print:hidden @xl:flex-row @xl:items-end @xl:justify-between">
        <div className="min-w-0 space-y-2">
          <Link href="/invoices" className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Invoices
          </Link>
          <h1 className="flex flex-wrap items-center gap-3 text-title-lg md:text-display-sm">
            <span className="truncate">{invoice.number ?? "Draft invoice"}</span>
            <StatusBadge status={status} />
          </h1>
          <p className="text-body-sm text-muted-foreground">
            {invoice.clientName} · due {formatDate(invoice.dueDate)}
          </p>
        </div>
        <InvoiceActions
          id={invoice.id}
          status={status}
          number={invoice.number}
          clientName={invoice.clientName}
          currency={invoice.currency}
          balance={balanceOf(invoice.total, invoice.paid)}
          hasPayments={invoice.payments.length > 0}
        />
      </div>

      <InvoiceDocument invoice={invoice} company={effectiveCompany} />

      {invoice.payments.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-6 print:hidden">
          <h2 className="text-title-md">Payments received</h2>
          <ul className="mt-3 divide-y divide-border">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-body-sm">
                <span>{formatDate(p.date)}</span>
                <span className="text-right font-mono tabular-nums">
                  {money(p.amount)}
                  {invoice.currency === "USD" ? <span className="block text-caption text-muted-foreground">{formatINR(Number(p.amountInr))} @ ₹{Number(p.exchangeRate)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-muted-foreground">
            Each payment is an income entry in <Link href="/transactions" className="underline">Transactions</Link>. Deleting it there puts the amount back on this invoice.
          </p>
        </section>
      ) : null}
    </>
  );
}

// The whole shell renders at request time: the sidebar reads the URL, which has an id.
export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-[48rem] rounded-xl" />}>
      <AppShell>
        <Invoice params={params} />
      </AppShell>
    </Suspense>
  );
}
