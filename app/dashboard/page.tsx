import { AppShell } from "@/components/layout/app-shell";
import { HeroCard } from "@/components/dashboard/hero-card";
import { KPICard } from "@/components/dashboard/kpi-card";
import { CashFlowChart } from "@/components/dashboard/cash-flow-chart";
import { ClientPaymentsList } from "@/components/dashboard/client-payments-list";
import {
  DASHBOARD_KPIS,
  CASH_FLOW_DATA_6M,
  CLIENT_PAYMENTS,
} from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        {/* Top Hero Overview */}
        <HeroCard />

        {/* 4 KPI Cards Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {DASHBOARD_KPIS.map((kpi) => (
            <KPICard key={kpi.id} card={kpi} />
          ))}
        </div>

        {/* Bottom Section: Cash Flow Chart + Client Payments */}
        <div className="grid grid-cols-1 items-stretch gap-6 2xl:grid-cols-12">
          <div className="flex min-w-0 flex-col 2xl:col-span-8">
            <CashFlowChart data={CASH_FLOW_DATA_6M} />
          </div>
          <div className="flex min-w-0 flex-col 2xl:col-span-4">
            <ClientPaymentsList payments={CLIENT_PAYMENTS} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
