"use client";

import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Browser print → "Save as PDF". Print styles (print:hidden on the shell) leave only the report.
 * The document title becomes the suggested PDF file name, so it is set for the duration of the dialog.
 */
export function ExportPdfButton({ fileName, label = "Export PDF", variant, disabled }: { fileName: string; label?: string; variant?: "default" | "outline"; disabled?: boolean }) {
  const print = () => {
    const title = document.title;
    document.title = fileName;
    window.print();
    document.title = title;
  };
  return (
    <Button onClick={print} disabled={disabled} variant={variant} className="print:hidden">
      <FileDown aria-hidden />
      {label}
    </Button>
  );
}
