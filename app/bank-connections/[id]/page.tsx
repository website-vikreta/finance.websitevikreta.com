import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { TrackStatementVisit } from "@/components/bank-import/section-entry";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import {
  StatementDetailScreen,
  StatementSummaryCard,
} from "@/components/bank-import/statement-detail";
import { ReconciliationCard } from "@/components/bank-import/reconciliation-card";
import { ReviewTable } from "@/components/bank-import/review-table";
import { getStatementDetail } from "@/lib/bank-import/queries";
import { listReviewOptions } from "@/lib/bank-import/review";
import { findDuplicateCandidates } from "@/lib/bank-import/duplicates";
import { finalizeStatementStatuses } from "@/lib/bank-import/statement-sync";
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
  let detail = await getStatementDetail(statementId);
  if (!detail) {
    return (
      <>
        <div className="space-y-2 print:hidden">
          <Link
            href="/bank-connections?list=1"
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
        <div className="space-y-2">
          <p className="text-body-sm text-muted-foreground">
            This statement is no longer available.
          </p>
          <Link
            href="/bank-connections?list=1"
            className="inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back to bank connections
          </Link>
        </div>
      </>
    );
  }

  // One-time completeness reconcile: a statement whose rows are all imported /
  // skipped / duplicate but still claims `review` (its last decision landed
  // before this sync existed) completes here instead of staying stuck forever.
  // Dead imports are deliberately excluded: an imported row whose transaction
  // was deleted is not settled, so the statement must stay in review where the
  // row can be restored or re-imported. `finalizeStatementStatuses` guards the
  // write with `WHERE status = 'review'`, so concurrent writers can't race it.
  const hasDeadImports = detail.lines.some(
    (line) => line.status === "imported" && line.importLive === false,
  );
  if (
    detail.statement.status === "review" &&
    detail.statement.pendingCount === 0 &&
    detail.statement.readyCount === 0 &&
    detail.statement.errorCount === 0 &&
    !hasDeadImports
  ) {
    await db.transaction((tx) =>
      finalizeStatementStatuses(tx, statementId, ["review"]),
    );
    const refreshed = await getStatementDetail(statementId);
    if (refreshed) detail = refreshed;
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
  let screen: ReactNode;
  if (detail.statement.status === "importing") {
    screen = (
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
  } else if (detail.statement.status !== "review") {
    screen = <StatementDetailScreen detail={detail} />;
  } else {
    screen = (
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

  // Every statement screen (review, resumed import batch, completed history)
  // is remembered locally, so returning to the section reopens exactly this
  // statement — the one the reviewer was last working on.
  return (
    <>
      <TrackStatementVisit statementId={detail.statement.id} />
      {screen}
    </>
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
          {/* ?list=1 forces the list and re-remembers it; the plain path
              would resume the review visited last — often this statement,
              which would bounce the user straight back here. */}
          <Link
            href="/bank-connections?list=1"
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
