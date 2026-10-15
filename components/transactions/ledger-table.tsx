"use client";

import { useState } from "react";
import { ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpDown, ArrowUpRight, ChevronLeft, ChevronRight, Download, Info, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { formatDate, formatINR, formatTime } from "@/lib/format";
import type { LedgerRow } from "@/lib/transactions/queries";
import { SOURCE_LABELS, toCsv } from "@/lib/transactions/csv";
import { todayInIndia } from "@/lib/transactions/period";
import { DeleteTransactionDialog } from "./delete-transaction-dialog";
import { TransactionDetailsDialog } from "./transaction-details-dialog";
import { TransactionFormDialog } from "./transaction-form-dialog";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [10, 25, 50, 100];

const FILTERS = [
  { value: "all", label: "All" },
  { value: "income", label: "Money in" },
  { value: "expense", label: "Money out" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];


const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function matches(row: LedgerRow, query: string): boolean {
  if (!query) return true;
  const haystack = [row.title, row.detail, row.category, SOURCE_LABELS[row.source] ?? row.source, formatDate(row.date), row.originalCurrency]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

type SortKey = "date" | "amount";
type Sort = { key: SortKey; dir: "asc" | "desc" };

function FilterSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-caption text-muted-foreground">{label}</Label>
      <Select items={options} value={value} onValueChange={(v) => onChange(String(v))}>
        <SelectTrigger id={id} className="w-full @3xl:min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Page numbers with gaps: 1 … 4 5 6 … 10 */
function pageList(current: number, count: number): (number | "gap")[] {
  const pages = new Set([0, count - 1, current - 1, current, current + 1].filter((p) => p >= 0 && p < count));
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? ["gap" as const, p] : [p]));
}

// ponytail: filters and pages in the browser over the full ledger; move to server-side paging once it reaches a few thousand rows
export function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [currency, setCurrency] = useState("all");
  const [category, setCategory] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "date", dir: "desc" });
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerRow | null>(null);
  const [deleting, setDeleting] = useState<LedgerRow | null>(null);
  const [viewing, setViewing] = useState<LedgerRow | null>(null);

  const openForm = (row: LedgerRow | null) => {
    setEditing(row);
    setFormOpen(true);
  };

  // Every filter change goes back to page 1.
  const update = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };
  const categories = [...new Set(rows.map((r) => r.category).filter((c): c is string => c !== null))].sort();
  const filtersActive = currency !== "all" || category !== "all" || from !== "" || to !== "";
  const clearFilters = () => {
    setCurrency("all");
    setCategory("all");
    setFrom("");
    setTo("");
    setPage(0);
  };
  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
    setPage(0);
  };

  const query = search.trim().toLowerCase();
  const filtered = rows
    .filter(
      (r) =>
        (filter === "all" || r.type === filter) &&
        (currency === "all" || r.originalCurrency === currency) &&
        (category === "all" || r.category === category) &&
        (!from || r.date >= from) &&
        (!to || r.date <= to) &&
        matches(r, query),
    )
    .sort((a, b) => {
      const diff = sort.key === "date" ? (a.date + a.time).localeCompare(b.date + b.time) : a.amountInr - b.amountInr;
      return sort.dir === "asc" ? diff : -diff;
    });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize);

  const sortHeader = (key: SortKey, label: string, align: "left" | "right") => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn("inline-flex items-center gap-1 rounded-md font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50", active && "text-foreground", align === "right" && "flex-row-reverse")}
      >
        {label}
        <Icon className={cn("size-3.5", !active && "opacity-50")} aria-hidden />
      </button>
    );
  };
  // Exactly what's on screen after filters and sort (all pages), built in the browser.
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `transactions-${todayInIndia()}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");

  const totalIn = filtered.filter((r) => r.type === "income").reduce((s, r) => s + r.amountInr, 0);
  const totalOut = filtered.filter((r) => r.type === "expense").reduce((s, r) => s + r.amountInr, 0);

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-center @3xl:justify-between">
          <div role="tablist" aria-label="Filter by type" className={segmentedTrack}>
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => update(setFilter)(f.value)}
                className={segmentedItem(filter === f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex w-full items-center gap-2 @3xl:max-w-sm">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={search}
                onChange={(e) => update(setSearch)(e.target.value)}
                placeholder="Search"
                aria-label="Search transactions"
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0} aria-label={`Export CSV, ${filtered.length} transactions`}>
              <Download aria-hidden />
              <span className="hidden @md:inline">Export CSV</span>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 items-end gap-3 @3xl:flex @3xl:flex-wrap">
          <FilterSelect
            id="filter-currency"
            label="Currency"
            value={currency}
            onChange={update(setCurrency)}
            options={[{ value: "all", label: "All" }, { value: "INR", label: "INR" }, { value: "USD", label: "USD" }]}
          />
          <FilterSelect
            id="filter-category"
            label="Category"
            value={category}
            onChange={update(setCategory)}
            options={[{ value: "all", label: "All" }, ...categories.map((c) => ({ value: c, label: c }))]}
          />
          <div className="col-span-2 flex min-w-0 flex-col gap-1.5 @xs:col-span-1">
            <Label htmlFor="filter-from" className="text-caption text-muted-foreground">From</Label>
            <Input id="filter-from" type="date" value={from} max={to || undefined} onChange={(e) => update(setFrom)(e.target.value)} className="w-full px-2.5 @3xl:w-40 @3xl:px-3.5" />
          </div>
          <div className="col-span-2 flex min-w-0 flex-col gap-1.5 @xs:col-span-1">
            <Label htmlFor="filter-to" className="text-caption text-muted-foreground">To</Label>
            <Input id="filter-to" type="date" value={to} min={from || undefined} onChange={(e) => update(setTo)(e.target.value)} className="w-full px-2.5 @3xl:w-40 @3xl:px-3.5" />
          </div>
          {filtersActive ? (
            <Button variant="ghost" onClick={clearFilters} className="col-span-2 justify-self-start text-muted-foreground">
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead className="border-b border-border bg-muted/60">
              <tr className="text-caption text-muted-foreground">
                <th scope="col" aria-sort={ariaSort("date")} className="hidden px-4 py-3 @xl:table-cell">{sortHeader("date", "Date", "left")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">Description</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold @2xl:table-cell">Source</th>
                <th scope="col" aria-sort={ariaSort("amount")} className="px-4 py-3 text-right">{sortHeader("amount", "Amount", "right")}</th>
                <th scope="col" className="w-0 px-2 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-14 text-center text-muted-foreground">
                    {rows.length === 0
                      ? "No transactions yet. Record one with Finance AI to see it here."
                      : "No transactions match these filters."}
                  </td>
                </tr>
              ) : (
                visible.map((row) => {
                  const isIncome = row.type === "income";
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-muted/50">
                      <td className="hidden px-4 py-3.5 whitespace-nowrap tabular-nums @xl:table-cell">
                        <p className="text-foreground">{formatDate(row.date)}</p>
                        <p className="text-caption text-muted-foreground">{formatTime(row.time)}</p>
                      </td>
                      <td className="w-full max-w-0 py-3.5 pr-2 pl-4 @xl:px-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "hidden size-7 shrink-0 place-items-center rounded-full @xl:grid",
                              isIncome ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                            )}
                            aria-hidden
                          >
                            {isIncome ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{row.title}</p>
                            <p className="hidden truncate text-caption text-muted-foreground @xl:block">
                              {isIncome ? "Income" : "Expense"}
                              {(isIncome ? row.detail : row.category) ? ` · ${isIncome ? row.detail : row.category}` : null}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3.5 whitespace-nowrap @2xl:table-cell">
                        <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                          {SOURCE_LABELS[row.source] ?? row.source}
                        </span>
                      </td>
                      <td className="px-2 py-3.5 text-right whitespace-nowrap @xl:px-4">
                        <p className={cn("font-mono font-semibold tabular-nums", isIncome ? "text-success" : "text-foreground")}>
                          {isIncome ? "+" : "−"}
                          {formatINR(row.amountInr, { decimals: row.amountInr % 1 === 0 ? 0 : 2 })}
                        </p>
                        {row.originalCurrency === "USD" ? (
                          <p className="hidden text-caption text-muted-foreground tabular-nums @xl:block">
                            {usd.format(row.originalAmount)} @ ₹{row.exchangeRate}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-3.5 whitespace-nowrap">
                        <Button variant="ghost" size="icon-sm" aria-label={`Details for ${row.title}, ${formatDate(row.date)}`} onClick={() => setViewing(row)} className="text-muted-foreground @xl:hidden">
                          <Info aria-hidden />
                        </Button>
                        <div className="hidden justify-end gap-1 @xl:flex">
                          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${row.title}, ${formatDate(row.date)}`} onClick={() => openForm(row)} className="text-muted-foreground">
                            <Pencil aria-hidden />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${row.title}, ${formatDate(row.date)}`} onClick={() => setDeleting(row)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-4 py-3 text-caption text-muted-foreground @xl:flex-row @xl:items-center @xl:justify-between">
          <p className="tabular-nums">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"} · in {formatINR(totalIn)} · out {formatINR(totalOut)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {pageCount > 1 ? (
              <nav aria-label="Pages" className="flex items-center gap-1">
                <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  <ChevronLeft aria-hidden />
                </Button>
                {pageList(current, pageCount).map((p, i) =>
                  p === "gap" ? (
                    <span key={`gap-${i}`} className="px-1" aria-hidden>…</span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === current ? "default" : "ghost"}
                      size="icon-sm"
                      aria-label={`Page ${p + 1}`}
                      aria-current={p === current ? "page" : undefined}
                      onClick={() => setPage(p)}
                      className="tabular-nums"
                    >
                      {p + 1}
                    </Button>
                  ),
                )}
                <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
                  <ChevronRight aria-hidden />
                </Button>
              </nav>
            ) : null}
            <Select
              items={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} / page` }))}
              value={String(pageSize)}
              onValueChange={(v) => update(setPageSize)(Number(v))}
            >
              <SelectTrigger size="sm" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <TransactionFormDialog open={formOpen} onOpenChange={setFormOpen} row={editing} />
      <DeleteTransactionDialog row={deleting} onOpenChange={(open) => !open && setDeleting(null)} />
      <TransactionDetailsDialog
        row={viewing}
        sourceLabel={(source) => SOURCE_LABELS[source] ?? source}
        onOpenChange={(open) => !open && setViewing(null)}
        onEdit={(row) => {
          setViewing(null);
          openForm(row);
        }}
        onDelete={(row) => {
          setViewing(null);
          setDeleting(row);
        }}
      />
    </div>
  );
}
