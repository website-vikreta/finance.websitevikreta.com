"use client";

import Image from "next/image";
import { AppShell } from "@/components/layout/app-shell";
import { formatINR } from "@/lib/format";
import { Download, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ReportsPage() {
  const handleExportCSV = () => {
    toast.success("CSV Download initiated", {
      description: "Financial breakdown exported to your downloads folder.",
    });
  };

  const revenueCategories = [
    { name: "Web & Full-Stack Apps", amount: 4_20_000, percentage: 50 },
    { name: "AI Automation Workflows", amount: 2_60_000, percentage: 31 },
    { name: "UI/UX & Retainers", amount: 1_62_600, percentage: 19 },
  ];

  const expenseCategories = [
    { name: "Team Payroll & Contractors", amount: 2_10_000, percentage: 66 },
    { name: "Office Rent & Facilities", amount: 65_000, percentage: 20 },
    { name: "Software, LLM APIs & Cloud", amount: 28_440, percentage: 9 },
    { name: "Marketing & Lead Acquisition", amount: 14_800, percentage: 5 },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header Hero Banner with illustration-web-development.png */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 md:p-8 shadow-xs">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-2 max-w-lg">
              <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
                Audited Statements
              </span>
              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
                Financial Reports & Profitability
              </h1>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Reconciled metrics for fiscal tax filing, P&L statements, and automated cash flow forecasting.
              </p>

              <div className="pt-2 flex items-center gap-3">
                <Button
                  onClick={handleExportCSV}
                  className="rounded-full bg-black text-white hover:bg-neutral-800 gap-2 h-8 text-xs font-semibold px-4"
                >
                  <Download className="size-3 text-[#FFD600]" />
                  <span>Export CSV</span>
                </Button>
              </div>
            </div>

            {/* Watercolor Illustration from Public Brand */}
            <div className="relative h-32 w-48 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-neutral-100/50 hidden sm:block">
              <Image
                src="/brand/illustration-web-development.png"
                alt="Web development and finance illustration"
                fill
                className="object-contain p-2"
                priority
              />
            </div>
          </div>
        </div>

        {/* P&L Executive Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">
                Gross Revenue
              </span>
              <TrendingUp className="size-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold font-mono text-emerald-600 mt-2">
              {formatINR(8_42_600)}
            </div>
            <span className="text-[11px] text-muted-foreground mt-1 block">
              +12.4% vs previous month
            </span>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">
                Total Operating Expenses
              </span>
              <TrendingDown className="size-4 text-neutral-500" />
            </div>
            <div className="text-2xl font-extrabold font-mono text-foreground mt-2">
              {formatINR(3_18_240)}
            </div>
            <span className="text-[11px] text-muted-foreground mt-1 block">
              -4.8% operating optimization
            </span>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">
                Net Margin (Profit)
              </span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                62.2% Margin
              </span>
            </div>
            <div className="text-2xl font-extrabold font-mono text-[#0A0A0A] mt-2">
              {formatINR(5_24_360)}
            </div>
            <span className="text-[11px] text-muted-foreground mt-1 block">
              Retained in primary reserves
            </span>
          </div>
        </div>

        {/* Category Breakdown Breakdown Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue Breakdown */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-foreground">
              Revenue by Service Line
            </h2>
            <div className="space-y-3.5">
              {revenueCategories.map((cat) => (
                <div key={cat.name} className="space-y-1.5 text-xs">
                  <div className="flex justify-between font-medium">
                    <span>{cat.name}</span>
                    <span className="font-mono font-bold">{formatINR(cat.amount)} ({cat.percentage}%)</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      style={{ width: `${cat.percentage}%` }}
                      className="h-full rounded-full bg-[#FFD600]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Expense Breakdown */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-foreground">
              Expenses by Operational Category
            </h2>
            <div className="space-y-3.5">
              {expenseCategories.map((cat) => (
                <div key={cat.name} className="space-y-1.5 text-xs">
                  <div className="flex justify-between font-medium">
                    <span>{cat.name}</span>
                    <span className="font-mono font-bold">{formatINR(cat.amount)} ({cat.percentage}%)</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      style={{ width: `${cat.percentage}%` }}
                      className="h-full rounded-full bg-neutral-400"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
