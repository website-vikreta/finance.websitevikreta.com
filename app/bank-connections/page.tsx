import { AppShell } from "@/components/layout/app-shell";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export default function BankConnectionsPage() {
  return (
    <AppShell>
      <PageHeader title="Bank connections" description="Import statement lines instead of typing them in." />
      <ComingSoon
        eyebrow="On the roadmap"
        title="No banks are connected yet"
        description="Every transaction is entered through Finance AI for now. Bank import will pull statement lines in for you to review and confirm, so nothing is saved without your say-so."
        planned={[
          "Connect business accounts and see balances",
          "Import statement lines as transactions waiting for review",
          "Match imports against what's already recorded to avoid duplicates",
        ]}
      />
    </AppShell>
  );
}
