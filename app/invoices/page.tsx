import { AppShell } from "@/components/layout/app-shell";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = { title: "Invoices" };

export default function InvoicesPage() {
  return (
    <AppShell>
      <PageHeader title="Invoices" />
      <ComingSoon
        title="Coming soon"
        planned={[
          "Create GST invoices",
          "Track paid, due and overdue",
          "Mark paid to record the income",
        ]}
      />
    </AppShell>
  );
}
