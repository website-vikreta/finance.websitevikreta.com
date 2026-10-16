import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { Skeleton } from "@/components/ui/skeleton";
import { getCompanyProfile } from "@/lib/invoices/company";
import { getInvoice, listClientBilling } from "@/lib/invoices/invoices";

export const metadata = { title: "Edit invoice" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Form({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [invoice, company, clients] = await Promise.all([getInvoice(id), getCompanyProfile(), listClientBilling()]);
  if (!invoice || !company) notFound();
  if (invoice.status !== "draft") redirect(`/invoices/${id}`); // issued invoices are never edited
  return <InvoiceForm company={company} clients={clients} invoice={invoice} />;
}

// The whole shell renders at request time: the sidebar reads the URL, which has an id.
export default function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-[40rem] rounded-xl" />}>
      <AppShell>
        <PageHeader title="Edit invoice" />
        <Form params={params} />
      </AppShell>
    </Suspense>
  );
}
