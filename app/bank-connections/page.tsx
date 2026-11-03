import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddBankAccountForm } from "@/components/bank-import/add-bank-account-form";
import { UploadStatementForm } from "@/components/bank-import/add-statement-form";
import { StatementList } from "@/components/bank-import/statement-list";
import { BankConnectionsEntry } from "@/components/bank-import/section-entry";
import { bankImportLimits } from "@/lib/bank-import/limits";
import {
  type StatementSummary,
  listBankAccounts,
  listStatements,
} from "@/lib/bank-import/queries";

export const metadata = { title: "Bank connections" };

export default function BankConnectionsPage({ searchParams }: PageProps<"/bank-connections">) {
  return (
    <AppShell>
      <PageHeader title="Bank connections" />
      <Suspense fallback={<Skeleton className="h-[38rem] rounded-xl" />}>
        <BankConnectionsBody searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function BankConnectionsBody({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const statements = await listStatements();

  // The section reopens wherever the reviewer last was (a list visit or one
  // specific statement review, remembered per browser). `?list=1` — the
  // review page's back link — forces the list instead.
  return (
    <BankConnectionsEntry
      statementIds={statements.map((statement) => statement.id)}
      resume={params.list !== "1"}
    >
      <Suspense fallback={<Skeleton className="h-[34rem] rounded-xl" />}>
        <BankConnectionsData statements={statements} />
      </Suspense>
    </BankConnectionsEntry>
  );
}

async function BankConnectionsData({ statements }: { statements: StatementSummary[] }) {
  const accounts = await listBankAccounts();
  const limits = bankImportLimits();

  if (accounts.length === 0 && statements.length === 0) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add bank account</CardTitle>
          </CardHeader>
          <CardContent>
            <AddBankAccountForm />
          </CardContent>
        </Card>

        <Card className="flex items-center justify-center">
          <CardContent className="space-y-1 text-center">
            <CardTitle>No statements yet</CardTitle>
            <p className="text-body-sm text-muted-foreground">
              Add a bank account, then upload its statement PDF for review.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Upload statement</CardTitle>
          </CardHeader>
          <CardContent>
            <UploadStatementForm
              accounts={accounts}
              limits={{
                maxFileMegabytes: Math.round(limits.maxBytes / (1024 * 1024)),
                maxPages: limits.maxPages,
                maxRows: limits.maxRows,
              }}
            />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Bank accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                No saved accounts. Add one above before uploading.
              </p>
            ) : (
              <ul className="space-y-2 text-body-sm">
                {accounts.map((account) => (
                  <li key={account.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <p className="font-medium">{account.displayName}</p>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {[account.bankName, account.accountLast4 ? `••••${account.accountLast4}` : null]
                        .filter(Boolean)
                        .join(" · ") || "Bank details not set"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Add account</CardTitle>
          </CardHeader>
          <CardContent>
            <AddBankAccountForm />
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Upload history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {statements.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">No uploads yet.</p>
          ) : (
            <StatementList statements={statements} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
