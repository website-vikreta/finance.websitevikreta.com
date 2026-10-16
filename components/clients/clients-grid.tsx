"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { formatDate, formatINR, formatShare } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClientSummary } from "@/lib/transactions/queries";
import type { Owed } from "@/lib/invoices/invoices";
import { toClientsCsv } from "@/lib/clients/csv";
import { todayInIndia } from "@/lib/transactions/period";

type Filter = "all" | "owed";

const SORTS = {
  received: {
    label: "Received",
    compare: (a: ClientSummary, b: ClientSummary) => b.totalReceived - a.totalReceived,
  },
  owed: {
    label: "Owes",
    // INR first, then USD: no exchange rate is assumed.
    compare: (a: ClientSummary, b: ClientSummary, owed: Record<string, Owed>) =>
      (owed[b.id]?.INR ?? 0) - (owed[a.id]?.INR ?? 0) || (owed[b.id]?.USD ?? 0) - (owed[a.id]?.USD ?? 0),
  },
  profit: {
    label: "Net profit",
    compare: (a: ClientSummary, b: ClientSummary) => b.netMargin - a.netMargin,
  },
  recent: {
    label: "Last payment",
    compare: (a: ClientSummary, b: ClientSummary) =>
      (b.lastPaymentDate ?? "").localeCompare(a.lastPaymentDate ?? ""),
  },
  name: {
    label: "Name",
    compare: (a: ClientSummary, b: ClientSummary) => a.name.localeCompare(b.name),
  },
} as const;

type Sort = keyof typeof SORTS;

/** "₹50,000 + $1,200" for what a client still owes on invoices. */
const owedText = (o: Owed) =>
  [o.INR > 0 ? formatINR(o.INR) : null, o.USD > 0 ? `$${o.USD.toLocaleString("en-US")}` : null].filter(Boolean).join(" + ");

export function ClientsGrid({ clients, owed }: { clients: ClientSummary[]; owed: Record<string, Owed> }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("received");

  const totalReceived = clients.reduce((s, c) => s + c.totalReceived, 0);
  const query = search.trim().toLowerCase();

  const owingCount = clients.filter((c) => {
    const o = owed[c.id];
    return o && (o.INR > 0 || o.USD > 0);
  }).length;

  const matchesSearch = (c: ClientSummary) => {
    if (!query) return true;
    return (
      c.name.toLowerCase().includes(query) ||
      (c.email?.toLowerCase().includes(query) ?? false) ||
      (c.gstin?.toLowerCase().includes(query) ?? false) ||
      (c.state?.toLowerCase().includes(query) ?? false)
    );
  };

  const matchesFilter = (c: ClientSummary) => {
    if (filter === "owed") {
      const o = owed[c.id];
      return Boolean(o && (o.INR > 0 || o.USD > 0));
    }
    return true;
  };

  const visible = clients
    .filter((c) => matchesSearch(c) && matchesFilter(c))
    .sort((a, b) => SORTS[sort].compare(a, b, owed));

  const exportCsv = () => {
    const csvContent = toClientsCsv(visible, owed);
    const url = URL.createObjectURL(new Blob([csvContent], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `clients-${todayInIndia()}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
          <div role="tablist" aria-label="Filter clients" className={cn(segmentedTrack, "max-w-full overflow-x-auto")}>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              onClick={() => setFilter("all")}
              className={segmentedItem(filter === "all")}
            >
              All ({clients.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "owed"}
              onClick={() => setFilter("owed")}
              className={segmentedItem(filter === "owed")}
            >
              Owes money ({owingCount})
            </button>
          </div>

          <div className="flex w-full items-center gap-2 @3xl:max-w-md">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, GSTIN, email…"
                aria-label="Search clients"
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={visible.length === 0}
              aria-label={`Export CSV, ${visible.length} clients`}
              className="shrink-0"
            >
              <Download className="size-4" aria-hidden />
              <span className="hidden @md:inline">Export CSV</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <div role="tablist" aria-label="Sort clients" className={cn(segmentedTrack, "max-w-full overflow-x-auto")}>
            {(Object.keys(SORTS) as Sort[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={sort === key}
                onClick={() => setSort(key)}
                className={segmentedItem(sort === key)}
              >
                {SORTS[key].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-6 py-10 text-center text-body-sm text-muted-foreground">
          {search.trim()
            ? `No clients match "${search.trim()}".`
            : filter === "owed"
              ? "No one owes money."
              : "No clients yet."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 items-stretch gap-6 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {visible.map((c) => {
            const share = totalReceived > 0 ? (c.totalReceived / totalReceived) * 100 : 0;
            const shareLabel = formatShare(c.totalReceived, totalReceived);
            const clientOwed = owed[c.id];
            const hasOwed = clientOwed && (clientOwed.INR > 0 || clientOwed.USD > 0);

            return (
              <li key={c.id} className="h-full">
                <Link
                  href={`/clients/${c.id}`}
                  className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-[border-color,box-shadow] hover:border-foreground/30 hover:shadow-xs focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="flex shrink-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-caption font-semibold text-foreground transition-colors group-hover:bg-primary/20"
                        aria-hidden
                      >
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="truncate text-title-sm group-hover:underline">{c.name}</h2>
                          {c.totalExpenses > 0 && c.totalReceived > 0 ? (
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-caption font-medium text-muted-foreground">
                              {Math.round((c.netMargin / c.totalReceived) * 100)}% margin
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                  </div>

                  <dl className="mt-5 space-y-2 border-t border-border pt-4 text-body-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-muted-foreground">Received</dt>
                      <dd className="font-mono font-semibold tabular-nums text-foreground">{formatINR(c.totalReceived)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-muted-foreground">Direct costs</dt>
                      <dd className="font-mono tabular-nums text-muted-foreground">{formatINR(c.totalExpenses)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-muted-foreground">Net profit</dt>
                      <dd
                        className={cn(
                          "font-mono font-semibold tabular-nums",
                          c.netMargin > 0 ? "text-success" : c.netMargin < 0 ? "text-destructive" : "text-foreground"
                        )}
                      >
                        {formatINR(c.netMargin)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-muted-foreground">Owes</dt>
                      <dd
                        className={cn(
                          "truncate font-mono font-semibold tabular-nums",
                          hasOwed && clientOwed.overdue > 0 ? "text-destructive" : "text-foreground"
                        )}
                      >
                        {hasOwed ? owedText(clientOwed) : "₹0"}
                        {hasOwed && clientOwed.overdue > 0 ? (
                          <span className="ml-1 font-sans text-caption font-normal">({clientOwed.overdue} overdue)</span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-muted-foreground">Payments</dt>
                      <dd className="tabular-nums text-foreground">{c.payments}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-muted-foreground">Last payment</dt>
                      <dd className="truncate text-foreground">{c.lastPaymentDate ? formatDate(c.lastPaymentDate) : "None yet"}</dd>
                    </div>
                  </dl>

                  <div className="mt-auto pt-5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${shareLabel} of all income`}>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                    </div>
                    <p className="mt-1.5 text-caption text-muted-foreground">{shareLabel} of all income</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
