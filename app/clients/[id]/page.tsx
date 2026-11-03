import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeft, Building2, Calendar, Mail, MapPin, Receipt } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatTile } from "@/components/layout/stat-tile";
import { StatusBadge } from "@/components/invoices/status-badge";
import { ClientActions } from "@/components/clients/client-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatINR } from "@/lib/format";
import { stateName } from "@/lib/invoices/math";
import { getClient } from "@/lib/clients/clients";
import { cn } from "@/lib/utils";

export const metadata = { title: "Client profile" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const owedText = (o: { INR: number; USD: number }) =>
  [o.INR > 0 ? formatINR(o.INR) : null, o.USD > 0 ? `$${o.USD.toLocaleString("en-US")}` : null].filter(Boolean).join(" + ");

async function ClientProfileView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  await connection();
  const client = await getClient(id);
  if (!client) notFound();

  const hasOwed = client.owed.INR > 0 || client.owed.USD > 0;
  const stateLabel = client.state ? `${stateName(client.state)} (${client.state})` : null;

  return (
    <>
      <div className="flex flex-col gap-4 @xl:flex-row @xl:items-end @xl:justify-between">
        <div className="min-w-0 space-y-2">
          <Link
            href="/clients"
            className="inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Clients
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-title-sm font-semibold text-foreground"
              aria-hidden
            >
              {client.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <h1 className="text-title-lg md:text-display-sm">{client.name}</h1>
              <p className="text-caption text-muted-foreground">
                Client since {formatDate(client.createdAt)}
                {client.lastPaymentDate ? ` · Last payment ${formatDate(client.lastPaymentDate)}` : ""}
              </p>
            </div>
          </div>
        </div>

        <ClientActions
          client={{
            id: client.id,
            name: client.name,
            email: client.email,
            billingAddress: client.billingAddress,
            state: client.state,
            country: client.country,
            gstin: client.gstin,
            transactionsCount: client.paymentsCount + client.expenses.length,
            invoicesCount: client.invoices.length,
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-6 @4xl:grid-cols-4">
        <StatTile
          label="Total received"
          value={formatINR(client.totalReceived)}
          note={`${client.paymentsCount} payments`}
        />
        <StatTile
          label="Direct expenses"
          value={formatINR(client.totalExpenses)}
          note={`${client.expenses.length} tagged expense(s)`}
        />
        <StatTile
          label="Net profit"
          value={formatINR(client.netMargin)}
          note={
            client.marginPct !== null
              ? `${client.marginPct.toFixed(1)}% margin`
              : "No income recorded"
          }
        />
        <StatTile
          label="Owed to us"
          value={hasOwed ? owedText(client.owed) : "₹0"}
          note={
            client.owed.overdue > 0
              ? `${client.owed.overdue} overdue invoice(s)`
              : hasOwed
                ? "Payment pending"
                : "All invoices settled"
          }
        />
      </div>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-title-md">Billing & tax details</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 text-body-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Building2 className="size-3.5" aria-hidden />
              GSTIN
            </span>
            <p className="font-mono font-medium text-foreground">{client.gstin ?? "Not specified"}</p>
          </div>

          <div className="space-y-1">
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden />
              State & country
            </span>
            <p className="text-foreground">
              {stateLabel ? `${stateLabel}, ` : ""}
              {client.country}
            </p>
          </div>

          <div className="space-y-1">
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Mail className="size-3.5" aria-hidden />
              Billing email
            </span>
            <p className="truncate text-foreground">{client.email ?? "Not specified"}</p>
          </div>

          <div className="space-y-1">
            <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Calendar className="size-3.5" aria-hidden />
              Billing address
            </span>
            <p className="line-clamp-2 text-foreground">{client.billingAddress ?? "Not specified"}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-title-md">Invoices ({client.invoices.length})</h2>
          <Link
            href={`/invoices/new?client=${encodeURIComponent(client.name)}`}
            className="text-caption font-medium text-foreground hover:underline"
          >
            Create invoice →
          </Link>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {client.invoices.length === 0 ? (
            <p className="px-6 py-12 text-center text-body-sm text-muted-foreground">
              No invoices created for {client.name} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead className="border-b border-border bg-muted/60 text-caption text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Invoice</th>
                    <th scope="col" className="px-4 py-3 font-medium">Issue date</th>
                    <th scope="col" className="px-4 py-3 font-medium">Due date</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Total</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Paid</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {client.invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="font-mono font-medium text-foreground hover:underline"
                        >
                          {inv.number ?? "Draft"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.dueDate)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.displayStatus} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                        {inv.currency === "USD" ? `$${Number(inv.total).toLocaleString("en-US")}` : formatINR(Number(inv.total))}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                        {inv.currency === "USD" ? `$${Number(inv.paid).toLocaleString("en-US")}` : formatINR(Number(inv.paid))}
                      </td>
                      <td className={cn(
                        "px-4 py-3 text-right font-mono font-semibold tabular-nums",
                        inv.displayStatus === "overdue" ? "text-destructive" : "text-foreground"
                      )}>
                        {inv.currency === "USD" ? `$${Number(inv.balance).toLocaleString("en-US")}` : formatINR(Number(inv.balance))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-title-md">Payments received ({client.payments.length})</h2>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {client.payments.length === 0 ? (
            <p className="px-6 py-12 text-center text-body-sm text-muted-foreground">
              No payments recorded from {client.name} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead className="border-b border-border bg-muted/60 text-caption text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Date</th>
                    <th scope="col" className="px-4 py-3 font-medium">Details / Invoice</th>
                    <th scope="col" className="px-4 py-3 font-medium">Source</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Original amount</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Amount (INR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {client.payments.map((p) => (
                    <tr key={p.id} className="hover:bg-accent/40">
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {formatDate(p.date)}
                        <span className="ml-2 font-mono text-caption text-muted-foreground">{p.time}</span>
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {p.invoiceId && p.invoiceNumber ? (
                          <Link
                            href={`/invoices/${p.invoiceId}`}
                            className="inline-flex items-center gap-1 font-mono text-caption text-foreground underline hover:text-primary"
                          >
                            <Receipt className="size-3" aria-hidden />
                            {p.invoiceNumber}
                          </Link>
                        ) : (
                          p.detail ?? "Direct payment"
                        )}
                      </td>
                      <td className="px-4 py-3 text-caption text-muted-foreground capitalize">
                        {p.source}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                        {p.originalCurrency === "USD" ? (
                          <span>
                            ${p.originalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                            {p.exchangeRate ? (
                              <span className="block text-caption text-muted-foreground">
                                @ ₹{p.exchangeRate.toFixed(2)}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          formatINR(p.originalAmount)
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-success">
                        +{formatINR(p.amountInr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-title-md">Direct expenses ({client.expenses.length})</h2>
            {client.totalExpenses > 0 ? (
              <span className="font-mono text-caption text-muted-foreground">
                Total: {formatINR(client.totalExpenses)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {client.expenses.length === 0 ? (
            <p className="px-6 py-12 text-center text-body-sm text-muted-foreground">
              No expenses tagged to {client.name} yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead className="border-b border-border bg-muted/60 text-caption text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Date</th>
                    <th scope="col" className="px-4 py-3 font-medium">Description</th>
                    <th scope="col" className="px-4 py-3 font-medium">Category</th>
                    <th scope="col" className="px-4 py-3 font-medium">Source</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Amount (INR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {client.expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-accent/40">
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {formatDate(e.date)}
                        <span className="ml-2 font-mono text-caption text-muted-foreground">{e.time}</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">{e.description}</td>
                      <td className="px-4 py-3 text-caption text-muted-foreground">{e.category ?? "Other"}</td>
                      <td className="px-4 py-3 text-caption text-muted-foreground capitalize">{e.source}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-foreground">
                        −{formatINR(e.amountInr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-title-md">Monthly bills ({client.bills.length})</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {client.bills.length === 0 ? (
            <p className="px-6 py-12 text-center text-body-sm text-muted-foreground">No monthly bills tagged to {client.name}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead className="border-b border-border bg-muted/60 text-caption text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Bill</th>
                    <th scope="col" className="px-4 py-3 font-medium">Next due</th>
                    <th scope="col" className="px-4 py-3 font-medium">Ends</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Every month</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {client.bills.map((b) => (
                    <tr key={b.id} className="hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <Link href={`/transactions/recurring/${b.id}`} className="font-medium text-foreground hover:underline">
                          {b.description}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{b.isActive ? formatDate(b.nextDue) : "Paused"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{b.endDate ? formatDate(b.endDate) : "Ongoing"}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                        {b.currency === "USD" ? `$${b.amount.toLocaleString("en-US")}` : formatINR(b.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ClientSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-14 w-64 rounded-xl" />
        <Skeleton className="h-10 w-48 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-6 @4xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-[48rem] rounded-xl" />}>
      <AppShell>
        <Suspense fallback={<ClientSkeleton />}>
          <ClientProfileView params={params} />
        </Suspense>
      </AppShell>
    </Suspense>
  );
}
