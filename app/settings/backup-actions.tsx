"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MAX_BACKUP_BYTES, type BackupImportReport } from "@/lib/backup/types";

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupActions() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<BackupImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);

  function reset() {
    setFile(null);
    setReport(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function changeOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) reset();
  }

  function selectFile(next: File | null) {
    setReport(null);
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!next.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setError("Choose the .xlsx file downloaded from Export backup.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (next.size > MAX_BACKUP_BYTES) {
      setFile(null);
      setError("This file is larger than 25 MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(next);
  }

  async function submit(dryRun: boolean) {
    if (!file || busy) return;
    setBusy(dryRun ? "check" : "import");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/settings/backup/import${dryRun ? "?dryRun=1" : ""}`, {
        method: "POST",
        body: form,
      });
      const body = (await response.json().catch(() => null)) as BackupImportReport | { error?: string } | null;
      if (!body || !("totals" in body)) {
        setError(body && "error" in body && body.error ? body.error : "The backup could not be imported. Nothing was changed.");
        return;
      }
      setReport(body);
      // The route already invalidated server caches. Refresh this screen now so
      // the settings page and the rest of the tab agree before the dialog closes.
      if (body.ok && !dryRun) router.refresh();
    } catch {
      setError("The upload did not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      <a
        href="/api/settings/backup/export"
        download
        className={buttonVariants({ variant: "outline" })}
        title="Download every database record as one Excel workbook"
      >
        <Download aria-hidden />
        Export backup
      </a>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger render={<Button type="button" variant="outline" />}>
          <Upload aria-hidden />
          Import backup
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-title-md">Import backup</DialogTitle>
            <DialogDescription>
              Choose the Excel file downloaded from Export backup. Missing records are added, and records deleted here
              are restored when the backup still has them live. Bank statement rows that still point at a deleted
              transaction are reconnected. Everything else stays exactly as it is. The whole import runs as one
              transaction, so a failure saves nothing.
            </DialogDescription>
          </DialogHeader>

          {!report ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="backup-file">Backup file</Label>
              <Input
                ref={inputRef}
                id="backup-file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy !== null}
                onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)}
                className="h-auto cursor-pointer py-2 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-body-sm file:font-semibold file:text-foreground"
                aria-describedby="backup-file-help"
              />
              <p id="backup-file-help" className="text-caption text-muted-foreground">
                {file ? `${file.name} · ${formatBytes(file.size)}` : "Excel .xlsx, up to 25 MB."}
              </p>
              <p className="text-caption text-muted-foreground">
                The backup contains financial records and member sign-in hashes. Store it somewhere private.
              </p>
            </div>
          ) : (
            <ImportReport report={report} />
          )}

          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-body-sm text-destructive">
              <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}

          <DialogFooter>
            {report ? (
              <>
                {!report.ok || report.dryRun ? (
                  <Button type="button" variant="outline" onClick={reset} disabled={busy !== null}>
                    Choose another file
                  </Button>
                ) : null}
                {report.ok && report.dryRun && (report.totals.inserted > 0 || report.totals.restored > 0) ? (
                  <Button type="button" onClick={() => submit(false)} disabled={busy !== null}>
                    <Upload aria-hidden />
                    {busy === "import" ? "Importing…" : "Apply import"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => {
                      const refresh = report.ok && !report.dryRun;
                      changeOpen(false);
                      if (refresh) router.refresh();
                    }}
                    disabled={busy !== null}
                  >
                    {report.ok ? "Done" : "Close"}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={busy !== null}>
                  Cancel
                </Button>
                <Button type="button" variant="outline" onClick={() => submit(true)} disabled={!file || busy !== null}>
                  {busy === "check" ? "Checking…" : "Check file"}
                </Button>
                <Button type="button" onClick={() => submit(false)} disabled={!file || busy !== null}>
                  <Upload aria-hidden />
                  {busy === "import" ? "Importing…" : "Import backup"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImportReport({ report }: { report: BackupImportReport }) {
  const title = !report.ok ? "Import stopped" : report.dryRun ? "Backup checked" : "Backup imported";
  const tone = !report.ok ? "text-destructive" : report.dryRun ? "text-warning" : "text-success";
  const relations = report.relations.reduce((sum, relation) => sum + relation.count, 0);
  const tables = report.tables.filter((table) => table.inserted > 0 || table.restored > 0 || table.existing > 0);

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex items-start gap-3">
        {report.ok ? (
          <CheckCircle2 aria-hidden className={cn("mt-0.5 size-5 shrink-0", tone)} />
        ) : (
          <XCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
        )}
        <div className="min-w-0">
          <p className={cn("text-title-sm", tone)}>{title}</p>
          <p className="mt-1 text-body-sm text-muted-foreground">{report.message}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Added" value={report.totals.inserted} />
        <Stat label="Restored" value={report.totals.restored} />
        <Stat label="Already present" value={report.totals.existing} />
        <Stat label="Re-linked" value={relations} />
      </dl>

      {tables.length ? (
        <div className="max-h-64 overflow-auto rounded-lg border border-border">
          <table className="w-full text-body-sm">
            <thead className="sticky top-0 bg-muted text-caption text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Table</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Added</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Restored</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Already present</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tables.map((table) => (
                <tr key={table.sheet}>
                  <td className="px-3 py-2 text-foreground">{table.label}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{table.inserted}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{table.restored}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{table.existing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {report.relations.length ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-caption font-medium text-foreground">How records were linked</p>
          <ul className="mt-1 flex flex-col gap-1 text-body-sm text-muted-foreground">
            {report.relations.map((relation) => (
              <li key={relation.label}>
                <span className="font-mono tabular-nums text-foreground">{relation.count}</span>{" "}
                {relation.label} {relation.count === 1 ? "reference" : "references"} reused an existing record
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.notes.length ? (
        <ul className="flex flex-col gap-1 text-body-sm text-muted-foreground">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {report.warnings.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-body-sm">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.errors.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-body-sm">
          <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <ul className="flex flex-col gap-1">
            {report.errors.map((issue, index) => (
              <li key={`${issue.sheet}-${issue.row}-${index}`} className="text-destructive">
                <span className="font-mono text-caption">{issue.sheet}{issue.row ? ` · row ${issue.row}` : ""}</span>
                <span className="block text-body-sm">{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <FileSpreadsheet aria-hidden className="size-3.5" />
        {report.fileName} · {formatDuration(report.durationMs)}
        {report.rolledBack ? " · no changes written" : ""}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-title-sm tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
