import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  StatementDetailScreen,
  StatementSummaryCard,
} from "@/components/bank-import/statement-detail";
import { ReconciliationCard } from "@/components/bank-import/reconciliation-card";
import { ReviewTable } from "@/components/bank-import/review-table";
import { getStatementDetail } from "@/lib/bank-import/queries";
import { listReviewOptions } from "@/lib/bank-import/review";
import { findDuplicateCandidates } from "@/lib/bank-import/duplicates";
import {
  listOverlappingStatements,
  reconcileStatementDetail,
  resolveStatementPeriod,
} from "@/lib/bank-import/reconciliation";

interface DetailProps {
  params: Promise<{ id: string }>;
}

async function StatementData({ params }: { params: Promise<{ id: string }> }) {
  const statementId = await params.then((value) => value.id);
  const detail = await getStatementDetail(statementId);
  if (!detail) {
    return (
      <p className="text-body-sm text-muted-foreground">
        This statement is no longer available.
      </p>
    );
  }

  const period = resolveStatementPeriod(detail);
  const [options, duplicates, overlappingStatements] = await Promise.all([
    listReviewOptions(),
    findDuplicateCandidates(detail),
    listOverlappingStatements(detail.statement.accountId, detail.statement.id, period),
  ]);
  const reconciliation = reconcileStatementDetail(detail, overlappingStatements);

  // Statements that already left review are history: keep the read-only screen.
  // An interrupted import batch (`importing`) keeps its rows importable so a
  // crashed batch can be resumed, while review edits stay closed.
  if (detail.statement.status === "importing") {
    return (
      <div className="space-y-6">
        <StatementSummaryCard detail={detail} />
        <ReconciliationCard reconciliation={reconciliation} />
        <ReviewTable
          statementId={detail.statement.id}
          editable={false}
          importable
          lines={detail.lines}
          options={options}
          duplicatesByLine={duplicates.byLine}
          unresolvedCount={reconciliation.unresolvedCount}
        />
      </div>
    );
  }
  if (detail.statement.status !== "review") {
    return <StatementDetailScreen detail={detail} />;
  }

  return (
    <div className="space-y-6">
      <StatementSummaryCard detail={detail} />
      <ReconciliationCard reconciliation={reconciliation} />
      <ReviewTable
        statementId={detail.statement.id}
        editable
        importable
        lines={detail.lines}
        options={options}
        duplicatesByLine={duplicates.byLine}
        unresolvedCount={reconciliation.unresolvedCount}
      />
    </div>
  );
}

function StatementSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-48 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-[28rem] rounded-xl" />
    </div>
  );
}

export default function StatementDetailPage(props: DetailProps) {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-[48rem] rounded-xl" />}>
      <AppShell>
        <div className="space-y-2">
          <Link
            href="/bank-connections"
            className="inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Bank connections
          </Link>
          <PageHeader
            title="Statement review"
            description="Classify staging rows and import approved lines as transactions"
          />
        </div>

        <Suspense fallback={<StatementSkeleton />}>
          <StatementData params={props.params} />
        </Suspense>
      </AppShell>
    </Suspense>
  );
}
