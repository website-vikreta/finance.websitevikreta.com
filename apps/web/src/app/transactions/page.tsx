"use client";

import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { formatINR } from "@/lib/format";
import {
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { TransactionListItem } from "@/app/api/transactions/route";

function formatSource(source: string | null | undefined): string {
  if (!source) return "Unknown";
  return source
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export default function TransactionsPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "in" | "out">("all");
  const [showAll, setShowAll] = useState(false);
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    let inFlight = false;
    const abortController = new AbortController();

    async function loadData(isInitial = false) {
      if (inFlight) return;
      if (!isInitial && typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      inFlight = true;
      try {
        const res = await fetch("/api/transactions", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
          signal: abortController.signal,
        });

        if (!res.ok) {
          if (res.status === 401) {
            return;
          }
          throw new Error(`Failed to load transactions (status: ${res.status})`);
        }

        const data = await res.json();
        if (!ignore) {
          if (data.ok && Array.isArray(data.transactions)) {
            setTransactions(data.transactions);
            setError(null);
          } else {
            setError(data.error || "Failed to load transactions.");
          }
        }
      } catch (err: unknown) {
        if (!ignore) {
          const errorObj = err as { name?: string; message?: string };
          if (errorObj?.name === "AbortError") {
            return;
          }

          const isFailedFetch =
            errorObj instanceof TypeError ||
            String(errorObj?.message || "").toLowerCase().includes("failed to fetch");

          if (isFailedFetch) {
            setTransactions((current) => {
              if (current.length === 0) {
                setError("Unable to connect to server. Retrying…");
              }
              return current;
            });
          } else {
            console.warn("[TransactionsPage] Error loading transactions:", err);
            setTransactions((current) => {
              if (current.length === 0) {
                setError("Unable to load transactions from database.");
              }
              return current;
            });
          }
        }
      } finally {
        inFlight = false;
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    loadData(true);

    // 1. Instant update when chatbot confirms a transaction
    const handleTransactionConfirmed = () => {
      loadData();
    };
    window.addEventListener("finance:transaction-confirmed", handleTransactionConfirmed);

    // 2. Auto-refresh when tab/window gains focus or becomes visible
    const handleVisibilityOrFocus = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        loadData();
      }
    };
    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    // 3. Periodic polling every 5 seconds only when tab is actively visible
    const interval = setInterval(() => {
      loadData();
    }, 5000);

    return () => {
      ignore = true;
      abortController.abort();
      window.removeEventListener("finance:transaction-confirmed", handleTransactionConfirmed);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      clearInterval(interval);
    };
  }, []);

  // Sort by entry time (created_at DESC)
  const sorted = [...transactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Apply category filter first
  const filteredByType = sorted.filter((t) => {
    if (typeFilter === "in") return t.category === "Income";
    if (typeFilter === "out") return t.category === "Expense";
    return true;
  });

  // Apply search filter next
  const filtered = filteredByType.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.source.toLowerCase().includes(q) ||
      t.date.toLowerCase().includes(q) ||
      t.amountInr.toLowerCase().includes(q)
    );
  });

  // Limit to recent 10 unless See All Transactions is toggled
  const displayed = showAll ? filtered : filtered.slice(0, 10);

  const handleAddTransaction = () => {
    toast.info("Transaction Entry", {
      description: "You can enter transactions instantly using Finance AI in natural language!",
    });
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              Transactions
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Searchable ledger of all verified company income and expenditures.
            </p>
          </div>

          <Button
            onClick={handleAddTransaction}
            className="rounded-full bg-black text-white hover:bg-neutral-800 gap-2 h-9 text-xs font-semibold px-4 cursor-pointer"
          >
            <Plus className="size-3.5 text-[#FFD600]" />
            <span>New Transaction</span>
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-xs">
          {/* Search box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by vendor, description, or account…"
              className="pl-9 h-9 text-xs rounded-xl border-border bg-secondary/50 focus-visible:ring-primary"
            />
          </div>

          {/* Type tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-secondary/60">
            <button
              onClick={() => setTypeFilter("all")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                typeFilter === "all"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setTypeFilter("in")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                typeFilter === "in"
                  ? "bg-card text-emerald-600 shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Money In
            </button>
            <button
              onClick={() => setTypeFilter("out")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                typeFilter === "out"
                  ? "bg-card text-rose-600 shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Money Out
            </button>
          </div>
        </div>

        {/* Transactions Table Card */}
        <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/40 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {isLoading && transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        <span>Loading transactions from database…</span>
                      </div>
                    </td>
                  </tr>
                ) : error && transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-rose-500 font-medium">
                      {error}
                    </td>
                  </tr>
                ) : displayed.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-muted-foreground">
                      No transactions match your search filter.
                    </td>
                  </tr>
                ) : (
                  displayed.map((t) => {
                    const num = Number(t.amountInr);
                    const isIncome = t.category === "Income";
                    return (
                      <tr
                        key={t.id}
                        className="hover:bg-secondary/40 transition-colors group"
                      >
                        {/* 1. Date */}
                        <td className="py-3.5 px-4 font-medium text-muted-foreground whitespace-nowrap">
                          {t.date}
                        </td>

                        {/* 2. Category */}
                        <td className="py-3.5 px-4 text-muted-foreground">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-medium border ${
                              isIncome
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : "bg-secondary text-muted-foreground border-border/80"
                            }`}
                          >
                            {t.category}
                          </span>
                        </td>

                        {/* 3. Description */}
                        <td className="py-3.5 px-4 font-semibold text-foreground">
                          <div className="flex items-center gap-2">
                            <div
                              className={`flex size-6 items-center justify-center rounded-full shrink-0 ${
                                isIncome
                                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                                  : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                              }`}
                            >
                              {isIncome ? (
                                <ArrowDownLeft className="size-3" />
                              ) : (
                                <ArrowUpRight className="size-3" />
                              )}
                            </div>
                            <span className="truncate">{t.description}</span>
                          </div>
                        </td>

                        {/* 4. Amount */}
                        <td
                          className={`py-3.5 px-4 text-right font-extrabold font-mono text-sm whitespace-nowrap ${
                            isIncome
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-foreground"
                          }`}
                        >
                          {isIncome ? "+" : "-"}
                          {formatINR(isNaN(num) ? 0 : num, {
                            decimals: !isNaN(num) && num % 1 !== 0 ? 2 : 0,
                          })}
                        </td>

                        {/* 5. Source */}
                        <td className="py-3.5 px-4 text-muted-foreground">
                          <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-[11px] font-medium border border-border/60">
                            {formatSource(t.source)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-secondary/20 text-xs text-muted-foreground">
            <div>
              {!showAll ? (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="font-semibold text-primary hover:underline cursor-pointer transition-colors"
                >
                  See All Transactions
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span>Showing all {displayed.length} entries</span>
                  <span className="text-border">·</span>
                  <button
                    type="button"
                    onClick={() => setShowAll(false)}
                    className="font-semibold text-primary hover:underline cursor-pointer transition-colors"
                  >
                    Show Recent 10
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled className="h-7 text-xs rounded-lg">
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled className="h-7 text-xs rounded-lg">
                Next
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
