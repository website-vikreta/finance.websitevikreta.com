import { Suspense } from "react";
import { connection } from "next/server";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { getAnalyticsOverview } from "@/lib/analytics/overview";
import { parseAnalyticsPeriod, type AnalyticsPeriod } from "@/lib/analytics/range";

export const metadata = { title: "Analytics" };

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function AnalyticsData({ params }: { params: Promise<SearchParams> }) {
  await connection(); // always runs against the current date in India
  const resolved = await params;
  const period: AnalyticsPeriod = parseAnalyticsPeriod(single(resolved.period) ?? "month");
  const data = await getAnalyticsOverview({
    period,
    customFrom: period === "custom" ? single(resolved.from) ?? null : null,
    customTo: period === "custom" ? single(resolved.to) ?? null : null,
  });
  return <AnalyticsView data={data} />;
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-64 rounded-lg" />
      <div className="grid grid-cols-2 gap-6 @4xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-5">
        <Skeleton className="h-80 rounded-xl @4xl:col-span-3" />
        <Skeleton className="h-80 rounded-xl @4xl:col-span-2" />
      </div>
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <AppShell>
      <PageHeader title="Analytics" />
      <p className="mt-2 text-caption text-muted-foreground">
        How the money moves — periods, trends, categories and clients, all in Indian financial years (April–March).
      </p>
      <div className="mt-6">
        <Suspense fallback={<AnalyticsSkeleton />}>
          <AnalyticsData params={searchParams} />
        </Suspense>
      </div>
    </AppShell>
  );
}
