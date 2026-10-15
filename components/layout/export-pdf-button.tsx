"use client";

import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Browser print → "Save as PDF". Print styles (print:hidden on the shell) leave only the report.
 * The document title becomes the suggested PDF file name, so it is set for the duration of the dialog.
 */
export function ExportPdfButton({ fileName }: { fileName: string }) {
  const print = () => {
    const title = document.title;
    document.title = fileName;
    window.print();
    document.title = title;
  };
  return (
    <Button onClick={print} className="print:hidden">
      <FileDown aria-hidden />
      Export PDF
    </Button>
  );
}
