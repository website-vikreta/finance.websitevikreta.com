import Image from "next/image";
import { formatDate } from "@/lib/format";
import type { CompanyProfile } from "@/lib/invoices/company";
import type { InvoiceDetail } from "@/lib/invoices/invoices";
import { amountInWords, balanceOf, stateName } from "@/lib/invoices/math";
import { cn } from "@/lib/utils";

const fmt = (amount: string, currency: string) =>
  new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(amount));

const rate = (r: string) => `${Number(r)}%`;

/**
 * The invoice as an A4 sheet: sharp edges, A4 width and margins on screen, so the page you see
 * is the page that prints (Download PDF uses the browser's print, like Reports).
 */
export function InvoiceDocument({ invoice, company: current }: { invoice: InvoiceDetail; company: CompanyProfile }) {
  // Issued invoices print the company details they were issued with; drafts show the current profile.
  const company = invoice.seller ?? current;
  const cur = invoice.currency;
  const balance = balanceOf(invoice.total, invoice.paid);
  const placeOfSupply = invoice.billToState ? `${stateName(invoice.billToState)} (${invoice.billToState})` : invoice.billToCountry;
  const watermark = invoice.status === "draft" ? "DRAFT" : invoice.status === "void" ? "VOID" : null;
  const contact = [company.email, company.phone].filter(Boolean).join(" · ");

  return (
    <article
      className={cn(
        "print-document relative mx-auto flex w-full max-w-[210mm] flex-col overflow-hidden bg-card text-body-sm text-foreground",
        "px-6 py-8 shadow-sm ring-1 ring-border sm:min-h-[297mm] sm:px-[14mm] sm:py-[12mm]",
        // Under A4's 297mm so browser rounding never spills a blank second page.
        "print:min-h-[285mm] print:max-w-none print:overflow-visible print:shadow-none print:ring-0",
      )}
    >
      {watermark ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center select-none">
          <span className="-rotate-30 scale-[2.4] text-display-xl font-bold tracking-widest text-foreground/[0.04]">{watermark}</span>
        </span>
      ) : null}

      <header className="relative flex flex-col gap-6 sm:flex-row sm:justify-between">
        <Image src="/brand/websitevikreta-logo-horizontal.svg" alt="Website Vikreta" width={1364} height={300} className="h-auto w-44 self-start" priority />
        <div className="sm:text-right">
          <h1 className="text-title-lg uppercase tracking-wide">{invoice.taxType === "none" ? "Invoice" : "Tax invoice"}</h1>
          <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-6 gap-y-1 sm:justify-end">
            <Meta label="Invoice no." value={invoice.number ?? "Draft"} mono />
            <Meta label="Date" value={formatDate(invoice.issueDate)} />
            <Meta label="Due" value={formatDate(invoice.dueDate)} />
            <Meta label="Place of supply" value={placeOfSupply} />
          </dl>
        </div>
      </header>

      <div className="relative mt-8 h-0.5 bg-primary" aria-hidden />

      <section className="relative mt-6 grid grid-cols-1 gap-6 break-inside-avoid sm:grid-cols-2">
        <div className="space-y-0.5">
          <Label>From</Label>
          <p className="font-semibold">{company.legalName}</p>
          <p className="whitespace-pre-line text-muted-foreground">{company.address}</p>
          {company.gstin ? <p>GSTIN {company.gstin}</p> : null}
          {company.pan ? <p>PAN {company.pan}</p> : null}
          {contact ? <p className="text-muted-foreground">{contact}</p> : null}
        </div>
        <div className="space-y-0.5 sm:text-right">
          <Label>Bill to</Label>
          <p className="font-semibold">{invoice.clientName}</p>
          {invoice.billToAddress ? <p className="whitespace-pre-line text-muted-foreground">{invoice.billToAddress}</p> : null}
          <p className="text-muted-foreground">{[invoice.billToState ? stateName(invoice.billToState) : null, invoice.billToCountry].filter(Boolean).join(", ")}</p>
          {invoice.billToGstin ? <p>GSTIN {invoice.billToGstin}</p> : null}
          {invoice.billToEmail ? <p className="text-muted-foreground">{invoice.billToEmail}</p> : null}
        </div>
      </section>

      <section className="relative mt-8">
        {/* Scrolls sideways on phones; at A4 width and on paper the table always fits. */}
        <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:overflow-visible sm:px-0">
          <table className="w-full min-w-[30rem] border-collapse text-caption sm:min-w-0">
            <thead>
              <tr className="bg-foreground text-background">
                <th scope="col" className="w-8 px-2.5 py-2 text-left font-semibold">#</th>
                <th scope="col" className="px-2.5 py-2 text-left font-semibold">Description</th>
                <th scope="col" className="w-16 px-2.5 py-2 text-right font-semibold">Qty</th>
                <th scope="col" className="w-32 px-2.5 py-2 text-right font-semibold">Rate</th>
                <th scope="col" className="w-36 px-2.5 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it, n) => (
                <tr key={n} className="break-inside-avoid border-b border-border even:bg-muted">
                  <td className="px-2.5 py-2 align-top text-muted-foreground">{n + 1}</td>
                  <td className="px-2.5 py-2 align-top whitespace-pre-line">{it.description}</td>
                  <td className="px-2.5 py-2 text-right align-top tabular-nums">{Number(it.quantity)}</td>
                  <td className="px-2.5 py-2 text-right align-top whitespace-nowrap tabular-nums">{fmt(it.rate, cur)}</td>
                  <td className="px-2.5 py-2 text-right align-top whitespace-nowrap tabular-nums">{fmt(it.amount, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="relative mt-6 grid grid-cols-1 gap-8 break-inside-avoid sm:grid-cols-[1fr_17rem]">
        <div className="space-y-6 sm:order-1">
          <div>
            <Label>Amount in words</Label>
            <p>{amountInWords(invoice.total, cur)}</p>
            {invoice.taxType === "none" ? <p className="mt-1 text-caption text-muted-foreground">Export of services without payment of GST.</p> : null}
          </div>
          {company.bankName || company.upiId ? (
            <div>
              <Label>Payment details</Label>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                {company.bankName ? <Pair label="Bank" value={company.bankName} /> : null}
                {company.accountName ? <Pair label="Account name" value={company.accountName} /> : null}
                {company.accountNumber ? <Pair label="Account no." value={company.accountNumber} /> : null}
                {company.ifsc ? <Pair label="IFSC" value={company.ifsc} /> : null}
                {company.upiId ? <Pair label="UPI" value={company.upiId} /> : null}
              </dl>
            </div>
          ) : null}
        </div>

        <dl className="space-y-1.5 tabular-nums sm:order-2">
          <Line label="Subtotal" value={fmt(invoice.subtotal, cur)} />
          {invoice.taxType === "cgst_sgst" ? (
            <>
              <Line label={`CGST ${rate(String(Number(invoice.gstRate) / 2))}`} value={fmt(invoice.cgst, cur)} />
              <Line label={`SGST ${rate(String(Number(invoice.gstRate) / 2))}`} value={fmt(invoice.sgst, cur)} />
            </>
          ) : invoice.taxType === "igst" ? (
            <Line label={`IGST ${rate(invoice.gstRate)}`} value={fmt(invoice.igst, cur)} />
          ) : null}
          <div className="mt-3 flex justify-between gap-4 bg-foreground px-2.5 py-2 font-semibold text-background">
            <dt>Total</dt>
            <dd>{fmt(invoice.total, cur)}</dd>
          </div>
          {Number(invoice.paid) > 0 ? (
            <>
              <Line label="Paid" value={`− ${fmt(invoice.paid, cur)}`} />
              <Line label="Balance due" value={fmt(balance, cur)} strong />
            </>
          ) : null}
        </dl>
      </section>

      <footer className="relative mt-auto pt-10 break-inside-avoid">
        {invoice.notes || invoice.terms ? (
          <div className="grid gap-6 border-t border-border pt-6 sm:grid-cols-2">
            {invoice.notes ? <Note title="Notes" text={invoice.notes} /> : null}
            {invoice.terms ? <Note title="Terms" text={invoice.terms} /> : null}
          </div>
        ) : null}
        <div className="mt-12 flex justify-end">
          <div className="w-56 text-center">
            <p className="font-medium">For {company.legalName}</p>
            <div className="mt-14 border-t border-foreground pt-1.5 text-caption text-muted-foreground">Authorised signatory</div>
          </div>
        </div>
      </footer>
    </article>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground sm:text-right">{label}</dt>
      <dd className={cn("text-right", mono && "font-mono font-semibold")}>{value}</dd>
    </>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4 px-2.5", strong && "border-t border-border pt-1.5 font-semibold")}>
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{value}</dd>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1.5 text-caption font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>;
}

function Note({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <Label>{title}</Label>
      <p className="whitespace-pre-line text-muted-foreground">{text}</p>
    </div>
  );
}
