"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { formatDate, formatINR } from "@/lib/format";
import type { LedgerRow } from "@/lib/transactions/queries";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const FILTERS = [
  { value: "all", label: "All" },
  { value: "income", label: "Money in" },
  { value: "expense", label: "Money out" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

const SOURCE_LABELS: Record<string, string> = {
  chatbot: "Finance AI",
  manual: "Manual",
  bank_import: "Bank import",
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function matches(row: LedgerRow, query: string): boolean {
  if (!query) return true;
  const haystack = [row.title, row.detail, SOURCE_LABELS[row.source] ?? row.source, formatDate(row.date), row.originalCurrency]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

// ponytail: filters and pages in the browser over the full ledger; move to server-side paging once it reaches a few thousand rows
export function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);

  const query = search.trim().toLowerCase();
  const filtered = rows.filter((r) => (filter === "all" || r.type === filter) && matches(r, query));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const totalIn = filtered.filter((r) => r.type === "income").reduce((s, r) => s + r.amountInr, 0);
  const totalOut = filtered.filter((r) => r.type === "expense").reduce((s, r) => s + r.amountInr, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search client, description, source…"
            aria-label="Search transactions"
            className="pl-9"
          />
        </div>
        <div role="tablist" aria-label="Filter by type" className={segmentedTrack}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => {
                setFilter(f.value);
                setPage(0);
              }}
              className={segmentedItem(filter === f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-body-sm">
            <thead className="border-b border-border bg-muted/60">
              <tr className="text-eyebrow text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                <th scope="col" className="px-4 py-3 font-semibold">Description</th>
                <th scope="col" className="px-4 py-3 font-semibold">Source</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-14 text-center text-muted-foreground">
                    {rows.length === 0
                      ? "No transactions yet. Record one with Finance AI to see it here."
                      : "No transactions match your search."}
                  </td>
                </tr>
              ) : (
                visible.map((row) => {
                  const isIncome = row.type === "income";
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-muted/50">
                      <td className="px-4 py-3.5 whitespace-nowrap text-muted-foreground tabular-nums">{formatDate(row.date)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "grid size-7 shrink-0 place-items-center rounded-full",
                              isIncome ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                            )}
                            aria-hidden
                          >
                            {isIncome ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{row.title}</p>
                            <p className="truncate text-caption text-muted-foreground">
                              {isIncome ? "Income" : "Expense"}
                              {row.detail ? ` · ${row.detail}` : null}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                          {SOURCE_LABELS[row.source] ?? row.source}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <p className={cn("font-mono font-semibold tabular-nums", isIncome ? "text-success" : "text-foreground")}>
                          {isIncome ? "+" : "−"}
                          {formatINR(row.amountInr, { decimals: row.amountInr % 1 === 0 ? 0 : 2 })}
                        </p>
                        {row.originalCurrency === "USD" ? (
                          <p className="text-caption text-muted-foreground tabular-nums">
                            {usd.format(row.originalAmount)} @ ₹{row.exchangeRate}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-4 py-3 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular-nums">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"} · in {formatINR(totalIn)} · out {formatINR(totalOut)}
          </p>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                Page {current + 1} of {pageCount}
              </span>
              <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
