import { AppShell } from "@/components/layout/app-shell";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export default function BankConnectionsPage() {
  return (
    <AppShell>
      <PageHeader title="Bank connections" />
      <ComingSoon
        title="Coming soon"
        planned={[
          "Connect bank accounts",
          "Import statement lines for review",
          "Skip lines already recorded",
        ]}
      />
    </AppShell>
  );
}
