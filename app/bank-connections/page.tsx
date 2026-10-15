"use client";

import Image from "next/image";
import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { BANK_ACCOUNTS, type BankAccount } from "@/lib/mock-data";
import { formatINR } from "@/lib/format";
import {
  Building2,
  RefreshCw,
  Plus,
  ArrowRight,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function BankConnectionsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>(BANK_ACCOUNTS);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  const handleSyncAll = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      setAccounts((prev) =>
        prev.map((acc) => ({ ...acc, lastSynced: "Just now" }))
      );
      toast.success("Bank accounts synchronized", {
        description: "Fetched latest statement lines from HDFC, ICICI & Stripe.",
      });
    }, 1000);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header Hero Banner with illustration-flow-wave.png */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xs">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-2 max-w-lg">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
                Automated Bank Feeds
              </span>
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Connected Corporate Accounts
              </h1>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Direct 256-bit encrypted API feeds for automated ledger reconciliation and settlement tracking.
              </p>

              <div className="pt-2 flex items-center gap-3">
                <Button
                  onClick={handleSyncAll}
                  disabled={isSyncing}
                  className="rounded-full bg-black text-white hover:bg-neutral-800 gap-2 h-8 text-xs font-semibold px-4"
                >
                  <RefreshCw className={`size-3 text-[#FFD600] ${isSyncing ? "animate-spin" : ""}`} />
                  <span>{isSyncing ? "Syncing Feeds…" : "Sync All Feeds"}</span>
                </Button>

                <Button
                  variant="outline"
                  onClick={() => setIsConnectModalOpen(true)}
                  className="rounded-full gap-2 h-8 text-xs font-semibold px-4"
                >
                  <Plus className="size-3" />
                  <span>Connect Account</span>
                </Button>
              </div>
            </div>

            {/* Watercolor Wave Illustration from Public Brand */}
            <div className="relative h-28 w-52 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-neutral-100/50 hidden sm:block">
              <Image
                src="/brand/illustration-flow-wave.png"
                alt="Automated flow wave illustration"
                fill
                className="object-contain p-2"
                priority
              />
            </div>
          </div>
        </div>

        {/* Security assurance pill */}
        <div className="flex items-center gap-2 rounded-xl bg-secondary/50 border border-border px-4 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-600 shrink-0" />
          <span>
            Bank credentials are tokenized via Reserve Bank of India (RBI) compliant Account Aggregator APIs. Read-only feed access.
          </span>
        </div>

        {/* Account Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-xs hover:border-neutral-300 transition-all space-y-6"
            >
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-border/40">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-secondary text-foreground">
                    <Building2 className="size-4 text-foreground/80" />
                  </div>

                  <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Synced
                  </span>
                </div>

                <div className="mt-4">
                  <h3 className="font-bold text-sm text-foreground">
                    {acc.bankName}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {acc.accountType} · {acc.accountNumberMasked}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-border/40 flex items-baseline justify-between">
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase block">
                    Available Balance
                  </span>
                  <span className="text-xl font-extrabold text-foreground font-mono mt-0.5 block">
                    {formatINR(acc.balance)}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {acc.lastSynced}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Connect New Account Modal */}
        {isConnectModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h2 className="text-base font-bold text-foreground">
                  Connect Corporate Bank Feed
                </h2>
                <button
                  onClick={() => setIsConnectModalOpen(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <p className="text-muted-foreground leading-relaxed">
                  Select your financial institution to connect a secure statement feed:
                </p>

                {["HDFC Bank Corporate", "ICICI Bank Corporate", "Axis Bank", "Kotak Corporate", "Stripe India"].map((bank) => (
                  <button
                    key={bank}
                    onClick={() => {
                      toast.success(`Connected ${bank}`, {
                        description: "Mock verification completed successfully.",
                      });
                      setIsConnectModalOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-border bg-secondary/40 p-3 text-left font-semibold hover:bg-secondary transition-colors"
                  >
                    <span>{bank}</span>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
