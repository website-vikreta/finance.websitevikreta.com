import { AppShell } from "@/components/layout/app-shell";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";

export default function InvoicesPage() {
  return (
    <AppShell>
      <PageHeader title="Invoices" description="Bill clients and track what's still owed." />
      <ComingSoon
        eyebrow="On the roadmap"
        title="Invoicing isn't built yet"
        description="Income is recorded today when a client pays, through Finance AI. Invoices will sit in front of that so you can see what's billed but not yet received."
        planned={[
          "Create GST invoices from a client and line items",
          "Track paid, due and overdue, with receivables on the dashboard",
          "Mark an invoice paid to record the income in one step",
        ]}
      />
    </AppShell>
  );
}
