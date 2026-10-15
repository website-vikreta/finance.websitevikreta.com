"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { CLIENTS, type ClientRecord } from "@/lib/mock-data";
import { formatINR } from "@/lib/format";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ClientsPage() {
  const [clients] = useState<ClientRecord[]>(CLIENTS);

  const totalOutstanding = clients.reduce((acc, c) => acc + c.outstanding, 0);
  const totalBilled = clients.reduce((acc, c) => acc + c.totalBilled, 0);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              Clients
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Active accounts, project retainers, and aggregate payment history.
            </p>
          </div>

          <Button
            onClick={() => toast.info("New client will be created on their first invoice.")}
            className="rounded-full bg-black text-white hover:bg-neutral-800 gap-2 h-9 text-xs font-semibold px-4"
          >
            <Users className="size-3.5 text-[#FFD600]" />
            <span>Add Client</span>
          </Button>
        </div>

        {/* Aggregate KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Total Client Accounts
            </span>
            <div className="text-2xl font-extrabold font-mono text-foreground mt-1">
              {clients.length}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Total Billed
            </span>
            <div className="text-2xl font-extrabold font-mono text-foreground mt-1">
              {formatINR(totalBilled)}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Total Outstanding
            </span>
            <div className="text-2xl font-extrabold font-mono text-amber-600 mt-1">
              {formatINR(totalOutstanding)}
            </div>
          </div>
        </div>

        {/* Client Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((c) => (
            <div
              key={c.id}
              className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-xs hover:border-neutral-300 transition-all cursor-pointer group"
            >
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-border/40">
                  <div className="flex size-8 items-center justify-center rounded-xl bg-secondary text-foreground font-bold text-xs">
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                    <span className="size-1 rounded-full bg-emerald-500" />
                    Active
                  </span>
                </div>

                <div className="mt-3">
                  <h3 className="text-sm font-bold text-foreground group-hover:text-black">
                    {c.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c.contactPerson} · {c.email}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2 pt-3 border-t border-border/40 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Billed:</span>
                  <span className="font-semibold font-mono">{formatINR(c.totalBilled)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Outstanding:</span>
                  <span className={`font-semibold font-mono ${c.outstanding > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                    {c.outstanding > 0 ? formatINR(c.outstanding) : "Nil (Settled)"}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] text-neutral-400 pt-1">
                  <span>Last Payment:</span>
                  <span>{c.lastPaymentDate}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
