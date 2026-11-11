"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportPdfButton } from "@/components/layout/export-pdf-button";
import { toStatementCsv } from "@/lib/bank-import/csv";
import type { StatementDetail } from "@/lib/bank-import/queries";
import { todayInIndia } from "@/lib/transactions/period";

/** Keep the statement's own name, without the .pdf suffix or filename-breaking characters. */
function safeFilePart(value: string): string {
  return value
    .replace(/\.pdf$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Completed statement → Export CSV / Export PDF. The CSV is built from the same
 * statement detail the PDF and the on-screen table use, so all three agree.
 */
export function StatementExportActions({ detail }: { detail: StatementDetail }) {
  const { statement, lines } = detail;
  const today = todayInIndia();
  const base = safeFilePart(statement.fileName) || "statement";
  const range =
    statement.periodFrom && statement.periodTo
      ? ` - ${statement.periodFrom} to ${statement.periodTo}`
      : "";
  const pdfFileName = `Bank statement - ${base}${range}`;

  const exportCsv = () => {
    const csv = toStatementCsv({ lines });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `bank-statement-${base}-${today}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-2 print:hidden">
      <Button
        type="button"
        variant="outline"
        onClick={exportCsv}
        aria-label={`Export CSV, ${lines.length} rows`}
      >
        <Download aria-hidden />
        <span className="hidden @md:inline">Export CSV</span>
      </Button>
      <ExportPdfButton fileName={pdfFileName} />
    </div>
  );
}
