"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { TRANSACTIONS, type Transaction } from "@/lib/mock-data";
import { formatINR } from "@/lib/format";
import {
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function TransactionsPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "in" | "out">("all");
  const [transactions] = useState<Transaction[]>(TRANSACTIONS);

  const filtered = transactions.filter((t) => {
    const matchesSearch =
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase()) ||
      t.account.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "all" || t.type === typeFilter;
    return matchesSearch && matchesType;
  });

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
            className="rounded-full bg-black text-white hover:bg-neutral-800 gap-2 h-9 text-xs font-semibold px-4"
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
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                typeFilter === "all"
                  ? "bg-card text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setTypeFilter("in")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                typeFilter === "in"
                  ? "bg-card text-emerald-600 shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Money In
            </button>
            <button
              onClick={() => setTypeFilter("out")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
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
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Account</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-muted-foreground">
                      No transactions match your search filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((t) => (
                    <tr
                      key={t.id}
                      className="hover:bg-secondary/40 transition-colors group"
                    >
                      <td className="py-3.5 px-4 font-medium text-muted-foreground whitespace-nowrap">
                        {t.date}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-foreground">
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex size-6 items-center justify-center rounded-full shrink-0 ${
                              t.type === "in"
                                ? "bg-emerald-50 text-emerald-600"
                                : "bg-neutral-100 text-neutral-600"
                            }`}
                          >
                            {t.type === "in" ? (
                              <ArrowDownLeft className="size-3" />
                            ) : (
                              <ArrowUpRight className="size-3" />
                            )}
                          </div>
                          <span>{t.description}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-muted-foreground">
                        <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium border border-border/80">
                          {t.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-muted-foreground">
                        {t.account}
                      </td>
                      <td
                        className={`py-3.5 px-4 text-right font-extrabold font-mono text-sm ${
                          t.type === "in" ? "text-emerald-600" : "text-foreground"
                        }`}
                      >
                        {t.type === "in" ? "+" : "-"}
                        {formatINR(t.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-secondary/20 text-xs text-muted-foreground">
            <span>Showing {filtered.length} of {transactions.length} entries</span>
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
