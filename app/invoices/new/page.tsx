import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getCompanyProfile } from "@/lib/invoices/company";
import { listClientBilling } from "@/lib/invoices/invoices";

export const metadata = { title: "New invoice" };

async function Form({ searchParams }: { searchParams?: Promise<{ client?: string }> }) {
  const [company, clients, client] = await Promise.all([
    getCompanyProfile(),
    listClientBilling(),
    searchParams ? searchParams.then((s) => s.client) : Promise.resolve(undefined),
  ]);

  if (!company) {
    return (
      <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-body-sm">
        Set up the company profile in <Link href="/settings" className="font-medium underline">Settings</Link> first. It&apos;s printed on every invoice.
      </p>
    );
  }
  return <InvoiceForm company={company} clients={clients} initialClient={client} />;
}

export default function NewInvoicePage({
  searchParams,
}: {
  searchParams?: Promise<{ client?: string }>;
}) {
  return (
    <AppShell>
      <PageHeader title="New invoice" />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-xl" />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
