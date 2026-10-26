import { formatDate, formatINR, formatTime, owedText } from "@/lib/format";
import type { ClientSummary } from "@/lib/transactions/queries";
import type { Owed } from "@/lib/invoices/invoices";
import { PrintSection, PrintTable } from "@/components/layout/print-table";

interface PrintClientsProps {
  /** Exactly what's on screen after search and filter. */
  clients: ClientSummary[];
  owed: Record<string, Owed>;
  filter: "all" | "owed";
  sortLabel: string;
  search: string;
  today: string;
  /** HH:MM, India time. */
  generatedAt: string;
}

/**
 * Clients → Export PDF. A clean, styled document rendered only in print;
 * on-screen filters, search, tabs, and client cards are hidden.
 */
export function PrintClients({ clients, owed, filter, sortLabel, search, today, generatedAt }: PrintClientsProps) {
  const totalReceived = clients.reduce((s, c) => s + c.totalReceived, 0);
  const totalExpenses = clients.reduce((s, c) => s + c.totalExpenses, 0);
  const netMargin = totalReceived - totalExpenses;
  const totalOwedInr = clients.reduce((s, c) => s + (owed[c.id]?.INR ?? 0), 0);
  const totalOwedUsd = clients.reduce((s, c) => s + (owed[c.id]?.USD ?? 0), 0);
  const signed = (n: number) => `${n < 0 ? "−" : ""}${formatINR(Math.abs(n))}`;

  const badges: string[] = [];
  if (filter === "owed") badges.push("Owes money");
  if (search) badges.push(`Search: "${search.trim()}"`);
  badges.push(`Sorted by: ${sortLabel}`);

  return (
    <div className="print-document hidden text-foreground print:block">
      <header>
        <h1 className="flex items-center gap-3 text-title-lg">
          Clients report
          <span className="rounded-md bg-primary px-2 py-0.5 text-caption font-semibold text-primary-foreground">
            {filter === "owed" ? "Owes money" : "All clients"}
          </span>
        </h1>
        <p className="mt-1 text-caption text-muted-foreground">
          Website Vikreta · {badges.join(" · ")} · generated {formatDate(today)}, {formatTime(generatedAt)} IST · amounts in INR
        </p>
      </header>

      <PrintSection title="Summary">
        <PrintTable
          head={["Metric", "Count", "Amount"]}
          align={["left", "right", "right"]}
          rows={[
            { key: "clients", cells: ["Matching clients", `${clients.length} clients`, ""] },
            {
              key: "received",
              cells: ["Received", `${clients.reduce((s, c) => s + c.payments, 0)} payments`, formatINR(totalReceived)],
            },
            { key: "costs", cells: ["Direct costs", "", formatINR(totalExpenses)] },
            {
              key: "net",
              cells: ["Net profit", totalReceived > 0 ? `${((netMargin / totalReceived) * 100).toFixed(1)}% margin` : "", signed(netMargin)],
              strong: true,
              negative: netMargin < 0,
            },
            { key: "owed-inr", cells: ["Total owed (INR)", "", formatINR(totalOwedInr)], negative: totalOwedInr > 0 },
            ...(totalOwedUsd > 0
              ? [{ key: "owed-usd", cells: ["Total owed (USD)", "", `$${totalOwedUsd.toFixed(2)}`], negative: true }]
              : []),
          ]}
        />
      </PrintSection>

      <PrintSection title={`Clients (${clients.length})`} breakable>
        {clients.length === 0 ? (
          <p className="text-caption text-muted-foreground">No clients match the current filters.</p>
        ) : (
          <PrintTable
            head={["Client", "Location", "Received", "Direct costs", "Net profit", "Owes", "Payments", "Last payment"]}
            align={["left", "left", "right", "right", "right", "right", "right", "left"]}
            rows={clients.map((c) => {
              const clientOwed = owed[c.id];
              const hasOwed = clientOwed && (clientOwed.INR > 0 || clientOwed.USD > 0);
              const loc = [c.state, c.country].filter(Boolean).join(", ");
              return {
                key: c.id,
                cells: [
                  c.name + (c.gstin ? ` (${c.gstin})` : ""),
                  loc || "—",
                  formatINR(c.totalReceived),
                  formatINR(c.totalExpenses),
                  signed(c.netMargin),
                  hasOwed ? owedText(clientOwed) : "₹0",
                  String(c.payments),
                  c.lastPaymentDate ? formatDate(c.lastPaymentDate) : "None yet",
                ],
              };
            })}
          />
        )}
      </PrintSection>
    </div>
  );
}
