"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  createClientAction,
  importLinesAction,
  listInvoiceOptionsAction,
  markLineDuplicateAction,
  markLineReadyAction,
  markLinesDuplicateAction,
  reopenLineAction,
  restoreImportAction,
  skipLineAction,
  updateLineReviewAction,
} from "@/app/bank-connections/actions";
import type { ImportBatchResult, ImportInvoiceOption } from "@/lib/bank-import/import";
import type { BulkDuplicateResult, ReviewResult } from "@/lib/bank-import/review";
import {
  BLOCKING_LINE_FLAGS,
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  LINE_STATUS_LABELS,
  type Classification,
  type LineFlag,
} from "@/lib/bank-import/types";
import type { StatementLineRow } from "@/lib/bank-import/queries";
import type { LineDuplicateCandidate } from "@/lib/bank-import/duplicates";
import { formatINR, formatDate } from "@/lib/format";

export interface ReviewPickerOption {
  value: string;
  label: string;
}

interface ReviewTableProps {
  statementId: string;
  /** False once the statement left the review state; rows become read-only. */
  editable: boolean;
  /** True while imports are possible on this statement (review or crashed import). */
  importable: boolean;
  lines: StatementLineRow[];
  options: { clients: ReviewPickerOption[]; categories: ReviewPickerOption[] };
  duplicatesByLine: Record<string, LineDuplicateCandidate[]>;
  unresolvedCount: number;
}

type FilterKey = "all" | "pending" | "ready" | "flagged" | "duplicates" | "skipped" | "error";

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  pending: "Pending",
  ready: "Ready",
  flagged: "Flagged",
  duplicates: "Duplicate candidates",
  skipped: "Skipped",
  error: "Errors",
};

interface EditorState {
  classification: Classification;
  description: string;
  businessDescription: string;
  clientId: string;
  categoryId: string;
  invoiceId: string;
  reason: string;
  newClientName: string;
}

const CLASSIFICATION_ITEMS = CLASSIFICATIONS.map((value) => ({
  value,
  label: CLASSIFICATION_LABELS[value],
}));

/** Mirrors `effectiveLineFlags` in review.ts: a filled description clears MISSING_NARRATION. */
function effectiveFlags(line: { narration: string | null; flags: LineFlag[] }): LineFlag[] {
  if (!line.narration || line.narration.trim() === "") return line.flags;
  return line.flags.filter((flag) => flag !== "MISSING_NARRATION");
}

function isFlagged(line: StatementLineRow): boolean {
  return effectiveFlags(line).some((flag) => BLOCKING_LINE_FLAGS.has(flag));
}

/** A row is importable while staged, or again after its transaction was deleted. */
function isImportSelectable(line: StatementLineRow, importable: boolean): boolean {
  if (!importable) return false;
  return line.status === "ready" || (line.status === "imported" && line.importLive === false);
}

/**
 * A row the reviewer can turn into a duplicate decision with the bulk
 * action: the same gate as the row editor's "Mark duplicate" button.
 */
function isDuplicateSelectable(line: StatementLineRow, editable: boolean): boolean {
  if (!editable) return false;
  return line.status === "pending" || line.status === "ready";
}

function amountCell(value: string | null) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono">{formatINR(Number(value), { decimals: 2 })}</span>;
}

function mappingLabel(line: StatementLineRow): string | null {
  if (line.clientId && line.clientName) return line.clientName;
  if (line.categoryId && line.categoryName) return line.categoryName;
  return null;
}

const STATUS_BADGE: Record<string, string> = {
  ready: "border-success/40 bg-success/10 text-success",
  pending: "border-warning/40 bg-warning/15 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function ReviewTable({
  statementId,
  editable,
  importable,
  lines,
  options,
  duplicatesByLine,
  unresolvedCount,
}: ReviewTableProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [rowError, setRowError] = useState<{ lineId: string; message: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // ── Import selection + batch state ────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importStage, setImportStage] = useState<"idle" | "confirm" | "running">("idle");
  const [importResult, setImportResult] = useState<ImportBatchResult | null>(null);
  // Bulk duplicate shares the checkboxes with the import; the two confirm
  // flows stay mutually exclusive so one selection is never acted on twice.
  const [duplicateStage, setDuplicateStage] = useState<"idle" | "confirm" | "running">("idle");
  const [duplicateResult, setDuplicateResult] = useState<BulkDuplicateResult | null>(null);
  const [invoiceOptions, setInvoiceOptions] = useState<Record<string, ImportInvoiceOption[]>>({});
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientDialog, setNewClientDialog] = useState<{ lineId: string; name: string } | null>(null);

  const counts = useMemo(() => {
    const result: Record<string, number> = {
      all: lines.length,
      pending: 0,
      ready: 0,
      flagged: 0,
      duplicates: 0,
      skipped: 0,
      error: 0,
    };
    for (const line of lines) {
      result[line.status] = (result[line.status] ?? 0) + 1;
      if (isFlagged(line)) result.flagged += 1;
      if ((duplicatesByLine[line.id] ?? []).length > 0) result.duplicates += 1;
    }
    return result;
  }, [lines, duplicatesByLine]);

  const visibleLines = useMemo(() => {
    if (filter === "all") return lines;
    if (filter === "flagged") return lines.filter(isFlagged);
    if (filter === "duplicates") {
      return lines.filter((line) => (duplicatesByLine[line.id] ?? []).length > 0);
    }
    return lines.filter((line) => line.status === filter);
  }, [lines, filter, duplicatesByLine]);

  function isSelectable(line: StatementLineRow): boolean {
    return isImportSelectable(line, importable) || isDuplicateSelectable(line, editable);
  }

  const selectableVisible = visibleLines.filter(isSelectable);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((line) => selectedIds.has(line.id));

  const lineById = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);

  /** The importable subset of the selection: what "Import selected" acts on. */
  const selectedImportIds = useMemo(
    () =>
      [...selectedIds].filter((id) => {
        const line = lineById.get(id);
        return line ? isImportSelectable(line, importable) : false;
      }),
    [selectedIds, lineById, importable],
  );

  /** The review-editable subset of the selection: what "Duplicate" acts on. */
  const selectedDuplicateIds = useMemo(
    () =>
      [...selectedIds].filter((id) => {
        const line = lineById.get(id);
        return line ? isDuplicateSelectable(line, editable) : false;
      }),
    [selectedIds, lineById, editable],
  );

  function toggleLine(lineId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const line of selectableVisible) {
        if (checked) next.add(line.id);
        else next.delete(line.id);
      }
      return next;
    });
  }

  function startImport() {
    if (selectedImportIds.length === 0) return;
    setDuplicateStage("idle");
    setImportStage("confirm");
  }

  function startDuplicate() {
    if (selectedDuplicateIds.length === 0) return;
    setImportStage("idle");
    setDuplicateStage("confirm");
  }

  function cancelImport() {
    if (importStage === "running") return;
    setImportStage("idle");
  }

  function cancelDuplicate() {
    if (duplicateStage === "running") return;
    setDuplicateStage("idle");
  }

  function runImport() {
    if (importStage === "running") return;
    const lineIds = selectedImportIds;
    if (lineIds.length === 0) return;
    setImportStage("running");
    startTransition(async () => {
      let result: ImportBatchResult;
      try {
        result = await importLinesAction(statementId, lineIds);
      } catch {
        result = {
          ok: false,
          error: "The import could not start. Refresh and try again.",
          requested: lineIds.length,
          imported: 0,
          failed: 0,
          statementStatus: null,
          results: [],
        };
      }
      setImportResult(result);
      setImportStage("idle");
      // Committed successes are done; keep the failed rows selected so a
      // corrected retry is one click away.
      setSelectedIds(
        new Set(
          result.results
            .filter((entry) => !entry.ok)
            .map((entry) => entry.lineId)
            .filter((lineId) => lineIds.includes(lineId)),
        ),
      );
      if (result.ok) {
        if (result.imported > 0) toast.success(`Imported ${result.imported} row${result.imported === 1 ? "" : "s"}.`);
        else if (!result.error) toast.info("No rows changed.");
      }
      if (result.error) toast.error(result.error);
      closeEditor();
    });
  }

  function runDuplicate() {
    if (duplicateStage === "running") return;
    const lineIds = selectedDuplicateIds;
    if (lineIds.length === 0) return;
    setDuplicateStage("running");
    startTransition(async () => {
      let result: BulkDuplicateResult;
      try {
        result = await markLinesDuplicateAction(statementId, lineIds);
      } catch {
        result = {
          ok: false,
          error: "The duplicate marking could not start. Refresh and try again.",
          requested: lineIds.length,
          marked: 0,
          alreadyDuplicate: 0,
          failed: lineIds.length,
          statementStatus: null,
          failures: [],
        };
      }
      setDuplicateResult(result);
      setDuplicateStage("idle");
      // Marked rows leave the selection; row blockers stay for a retry.
      setSelectedIds(
        new Set(result.failures.map((entry) => entry.lineId).filter((id) => lineIds.includes(id))),
      );
      if (result.ok) {
        if (result.marked > 0) {
          toast.success(
            `Marked ${result.marked} row${result.marked === 1 ? "" : "s"} as duplicate.` +
              (result.alreadyDuplicate > 0
                ? ` ${result.alreadyDuplicate} were already duplicates.`
                : "") +
              (result.failed > 0 ? ` ${result.failed} could not be changed.` : ""),
          );
        } else if (result.alreadyDuplicate === result.requested) {
          toast.info("Every selected row was already marked as duplicate.");
        }
      }
      if (result.error) toast.error(result.error);
      closeEditor();
    });
  }

  function dismissDuplicateResult() {
    setDuplicateResult(null);
  }

  function dismissImportResult() {
    setImportResult(null);
  }

  async function createNewClient(
    name: string,
  ): Promise<{ clientId: string; created: boolean } | null> {
    setCreatingClient(true);
    try {
      const result = await createClientAction(name);
      if (!result.ok) {
        toast.error(result.error);
        return null;
      }
      return { clientId: result.clientId, created: result.created };
    } catch {
      toast.error("The client could not be created. Try again.");
      return null;
    } finally {
      setCreatingClient(false);
    }
  }

  function restoreRow(line: StatementLineRow) {
    if (busyKey) return;
    setBusyKey(`${line.id}:restore`);
    startTransition(async () => {
      let result: ReviewResult;
      try {
        result = await restoreImportAction(statementId, line.id);
      } finally {
        setBusyKey(null);
      }
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Import restored to review — edit and import again when ready.");
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(line.id);
        return next;
      });
    });
  }

  // ── Row review editor ─────────────────────────────────────────────────────

  function openEditor(line: StatementLineRow) {
    setExpandedId(line.id);
    setRowError(null);
    setEditor({
      classification: line.classification,
      description: line.narration ?? "",
      businessDescription: line.businessDescription ?? "",
      clientId: line.clientId ?? "",
      categoryId: line.categoryId ? String(line.categoryId) : "",
      invoiceId: line.invoiceId ?? "",
      reason: "",
      newClientName: "",
    });
  }

  function closeEditor() {
    setExpandedId(null);
    setEditor(null);
    setRowError(null);
  }

  /** Invoice options are loaded per client while the income editor is open. */
  useEffect(() => {
    if (!editor || editor.classification !== "income" || !editor.clientId) return;
    const clientId = editor.clientId;
    if (invoiceOptions[clientId]) return;
    let cancelled = false;
    (async () => {
      const loaded = await listInvoiceOptionsAction(clientId);
      if (cancelled) return;
      setInvoiceOptions((current) => ({ ...current, [clientId]: loaded }));
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, invoiceOptions]);

  function run(lineId: string, action: () => Promise<ReviewResult>, message: string) {
    if (busyKey) return;
    setBusyKey(`${lineId}:busy`);
    startTransition(async () => {
      let result: ReviewResult;
      try {
        result = await action();
      } finally {
        setBusyKey(null);
      }
      if (!result.ok) {
        setRowError({ lineId, message: result.error });
        toast.error(result.error);
        return;
      }
      toast.success(message);
      closeEditor();
    });
  }

  function patchFor(state: EditorState) {
    return {
      classification: state.classification,
      description: state.description.trim() === "" ? null : state.description,
      businessDescription: state.businessDescription.trim() === "" ? null : state.businessDescription,
      clientId: state.classification === "income" ? state.clientId || null : null,
      categoryId:
        state.classification === "expense"
          ? state.categoryId
            ? Number(state.categoryId)
            : null
          : null,
      invoiceId:
        state.classification === "income"
          ? state.invoiceId || null
          : null,
    };
  }

  function saveAndMaybeReady(line: StatementLineRow, alsoReady: boolean) {
    if (!editor) return;
    const patch = patchFor(editor);
    run(line.id, async () => {
      const saved = await updateLineReviewAction(statementId, line.id, patch);
      if (!saved.ok) return saved;
      if (!alsoReady) return { ok: true } as const;
      return markLineReadyAction(statementId, line.id);
    }, alsoReady ? "Row reviewed — ready for import." : "Row updated.");
  }

  function skipRow(line: StatementLineRow) {
    const reason = editor?.reason.trim() ?? "";
    if (!reason) {
      setRowError({ lineId: line.id, message: "Add a reason for skipping this row." });
      return;
    }
    run(line.id, () => skipLineAction(statementId, line.id, reason), "Row skipped.");
  }

  function duplicateRow(line: StatementLineRow) {
    const note = editor?.reason.trim() || null;
    run(line.id, () => markLineDuplicateAction(statementId, line.id, note), "Row marked as duplicate.");
  }

  function reopenRow(line: StatementLineRow) {
    run(line.id, () => reopenLineAction(statementId, line.id), "Review reopened.");
  }

  const clientItems = [{ value: "", label: "No client chosen" }, ...options.clients];
  const categoryItems = [{ value: "", label: "No category chosen" }, ...options.categories];

  const selectedCount = selectedIds.size;
  const batchBusy = importStage !== "idle" || duplicateStage !== "idle";
  const replacements = importResult?.results.some((entry) => entry.ok && entry.replacement) ?? false;

  return (
    <div className="space-y-4">
      {importable && !editable ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-body-sm text-foreground">
          Importing on this statement is in progress or was interrupted. Remaining rows can still
          be selected and imported; review edits stay closed until the statement returns to
          review.
        </div>
      ) : null}

      {editable && unresolvedCount > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-body-sm text-warning">
          {unresolvedCount} line{unresolvedCount === 1 ? "" : "s"} still need
          {unresolvedCount === 1 ? "s" : ""} review before this statement can be completed.
        </div>
      ) : null}

      {importable ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {importStage === "confirm" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body-sm">
                Import {selectedImportIds.length} row
                {selectedImportIds.length === 1 ? "" : "s"} into the ledger as confirmed
                transactions?
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={runImport}>
                  Import now
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={cancelImport}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : duplicateStage === "confirm" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body-sm">
                Mark {selectedDuplicateIds.length} row
                {selectedDuplicateIds.length === 1 ? "" : "s"} as duplicate?
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={runDuplicate}>
                  Mark as duplicate
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={cancelDuplicate}>
                  Cancel
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">
                Marked rows are excluded from the import.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={startImport}
                disabled={selectedImportIds.length === 0 || batchBusy}
              >
                {importStage === "running" ? <Loader2 className="size-4 animate-spin" /> : null}
                {importStage === "running"
                  ? `Importing ${selectedImportIds.length} row${selectedImportIds.length === 1 ? "" : "s"}…`
                  : `Import selected${selectedImportIds.length > 0 ? ` (${selectedImportIds.length})` : ""}`}
              </Button>
              {editable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={startDuplicate}
                  disabled={selectedDuplicateIds.length === 0 || batchBusy}
                >
                  {duplicateStage === "running" ? <Loader2 className="size-4 animate-spin" /> : null}
                  {duplicateStage === "running"
                    ? `Marking ${selectedDuplicateIds.length} rows…`
                    : `Duplicate${selectedDuplicateIds.length > 0 ? ` (${selectedDuplicateIds.length})` : ""}`}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setImportStage("idle");
                  setDuplicateStage("idle");
                  setSelectedIds(new Set());
                }}
                disabled={selectedCount === 0 || batchBusy}
              >
                Clear selection
              </Button>
              <p className="text-caption text-muted-foreground">
                Ready rows import as income or expense; pending rows can be bulk-marked as
                duplicates; rows whose transaction was deleted can be re-imported.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {importResult ? (
        <div
          className={`rounded-lg border px-4 py-3 ${
            importResult.failed > 0 || !importResult.ok
              ? "border-warning/40 bg-warning/10"
              : "border-success/40 bg-success/10"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 text-body-sm">
              <p className="font-medium">
                {importResult.ok
                  ? `Imported ${importResult.imported} of ${importResult.requested} row${importResult.requested === 1 ? "" : "s"}.`
                  : importResult.error}
              </p>
              {importResult.ok && replacements ? (
                <p className="text-caption text-muted-foreground">
                  Some rows replaced deleted imports with fresh transactions.
                </p>
              ) : null}
              {importResult.results.filter((entry) => !entry.ok).length > 0 ? (
                <ul className="space-y-0.5 text-caption text-destructive">
                  {importResult.results
                    .filter((entry) => !entry.ok)
                    .map((entry) => (
                      <li key={entry.lineId}>
                        {entry.rowNumber > 0 ? `Row ${entry.rowNumber}` : "Selected row"}:{" "}
                        {entry.error}
                      </li>
                    ))}
                </ul>
              ) : null}
              {importResult.ok && importResult.failed > 0 ? (
                <p className="text-caption text-muted-foreground">
                  Failed rows stay ready. Fix the blocker and import them again; nothing was
                  double-counted.
                </p>
              ) : null}
              {importResult.statementStatus === "completed" ? (
                <p className="text-caption text-success">
                  Every row of this statement is accounted for — the statement is completed.
                </p>
              ) : null}
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={dismissImportResult}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {duplicateResult ? (
        <div
          className={`rounded-lg border px-4 py-3 ${
            duplicateResult.failed > 0 || !duplicateResult.ok
              ? "border-warning/40 bg-warning/10"
              : "border-success/40 bg-success/10"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 text-body-sm">
              <p className="font-medium">
                {duplicateResult.ok
                  ? `Marked ${duplicateResult.marked} of ${duplicateResult.requested} selected row${duplicateResult.requested === 1 ? "" : "s"} as duplicate.`
                  : duplicateResult.error}
              </p>
              {duplicateResult.ok && duplicateResult.alreadyDuplicate > 0 ? (
                <p className="text-caption text-muted-foreground">
                  {duplicateResult.alreadyDuplicate} row
                  {duplicateResult.alreadyDuplicate === 1 ? " was" : "s were"} already marked as
                  duplicate.
                </p>
              ) : null}
              {duplicateResult.ok &&
              duplicateResult.marked > 0 &&
              duplicateResult.alreadyDuplicate === 0 ? (
                <p className="text-caption text-muted-foreground">
                  Marked rows are excluded from the import; Reopen brings them back.
                </p>
              ) : null}
              {duplicateResult.failures.length > 0 ? (
                <ul className="space-y-0.5 text-caption text-destructive">
                  {duplicateResult.failures.map((entry) => (
                    <li key={entry.lineId}>
                      {entry.rowNumber > 0 ? `Row ${entry.rowNumber}` : "Selected row"}:{" "}
                      {entry.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={dismissDuplicateResult}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
            className="h-7 px-2.5 text-caption"
          >
            {FILTER_LABELS[key]}
            <span className="ml-1 font-mono">{counts[key] ?? 0}</span>
          </Button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {importable ? (
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    aria-label="Select all selectable rows on this page"
                    checked={allVisibleSelected}
                    disabled={selectableVisible.length === 0 || batchBusy}
                    onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                  />
                </TableHead>
              ) : null}
              <TableHead className="pl-4">Date</TableHead>
              <TableHead>Value date</TableHead>
              <TableHead>Narration</TableHead>
              <TableHead>Business Description</TableHead>
              <TableHead className="text-right">Withdrawal</TableHead>
              <TableHead className="text-right">Deposit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Classification</TableHead>
              <TableHead>Mapping</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4 text-right">Review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={importable ? 13 : 12} className="py-10 text-center text-muted-foreground">
                  {filter === "all"
                    ? "No statement rows."
                    : `No ${FILTER_LABELS[filter].toLowerCase()} rows.`}
                </TableCell>
              </TableRow>
            ) : null}

            {visibleLines.map((line) => {
              const canReview = editable && (line.status === "pending" || line.status === "ready");
              const canReopen = editable && (line.status === "skipped" || line.status === "duplicate");
              const canRestore =
                importable && line.status === "imported" && line.importLive === false;
              const duplicates = duplicatesByLine[line.id] ?? [];
              const effFlags = effectiveFlags(line);
              const expanded = expandedId === line.id;
              const label = mappingLabel(line);
              const selectable = isSelectable(line);
              const activeImport = line.status === "imported" && line.importLive === true;

              return (
                <Fragment key={line.id}>
                  <TableRow>
                    {importable ? (
                      <TableCell className="pl-4">
                        {activeImport ? (
                          <span
                            className="inline-block"
                            title="This line already has a live transaction and cannot be imported again."
                          >
                            <Checkbox checked disabled />
                          </span>
                        ) : (
                          <Checkbox
                            aria-label={`Select row ${line.rowNumber}`}
                            checked={selectedIds.has(line.id)}
                            disabled={!selectable || batchBusy}
                            onCheckedChange={(checked) => toggleLine(line.id, checked === true)}
                          />
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="font-mono whitespace-nowrap">
                      {line.txnDate ? (
                        formatDate(line.txnDate)
                      ) : (
                        <span className="text-destructive">Invalid</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap">
                      {line.valueDate ? formatDate(line.valueDate) : "—"}
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <p className="truncate" title={line.narration ?? undefined}>
                        {line.narration || <span className="text-destructive">Missing</span>}
                      </p>
                      {duplicates.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {duplicates.map((candidate, index) => (
                            <Badge
                              key={`${candidate.kind}:${candidate.when ?? ""}:${index}`}
                              variant="outline"
                              className={`text-caption ${
                                candidate.severity === "strong"
                                  ? "border-warning/40 bg-warning/15 text-warning"
                                  : "border-border bg-muted text-muted-foreground"
                              }`}
                              title={candidate.label}
                            >
                              {candidate.severity === "strong" ? "Duplicate" : "Possible dup"}
                              {candidate.when ? ` · ${candidate.when}` : ""}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <p className="truncate" title={line.businessDescription ?? undefined}>
                        {line.businessDescription || <span className="text-muted-foreground">—</span>}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">{amountCell(line.withdrawalAmount)}</TableCell>
                    <TableCell className="text-right">{amountCell(line.depositAmount)}</TableCell>
                    <TableCell className="text-right">{amountCell(line.closingBalance)}</TableCell>
                    <TableCell className="whitespace-nowrap">{CLASSIFICATION_LABELS[line.classification]}</TableCell>
                    <TableCell className="max-w-[10rem] truncate">
                      {label ?? <span className="text-muted-foreground">None</span>}
                      {line.invoiceNumber ? (
                        <p className="truncate text-caption text-muted-foreground">
                          Invoice {line.invoiceNumber}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[12rem] flex-wrap gap-1">
                        {effFlags.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          effFlags.map((flag) => (
                            <Badge
                              key={flag}
                              variant="outline"
                              className={`text-caption ${
                                BLOCKING_LINE_FLAGS.has(flag)
                                  ? "border-warning/40 bg-warning/15 text-warning"
                                  : "border-border bg-muted text-muted-foreground"
                              }`}
                              title={flag}
                            >
                              {flag}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <Badge
                          variant="outline"
                          className={STATUS_BADGE[line.status] ?? "border-border bg-muted text-muted-foreground"}
                        >
                          {LINE_STATUS_LABELS[line.status]}
                        </Badge>
                        {line.status === "imported" && line.importLive === false ? (
                          <p className="text-caption text-destructive" title="The imported transaction was deleted in the ledger.">
                            Import deleted
                          </p>
                        ) : null}
                        {line.skipReason ? (
                          <p
                            className="max-w-[10rem] truncate text-caption text-muted-foreground"
                            title={line.skipReason}
                          >
                            {line.skipReason}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {canReview ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-caption"
                          onClick={() => (expanded ? closeEditor() : openEditor(line))}
                          disabled={Boolean(busyKey)}
                        >
                          {expanded ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                          {expanded ? "Close" : "Review"}
                        </Button>
                      ) : canReopen ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-caption"
                          onClick={() => reopenRow(line)}
                          disabled={Boolean(busyKey)}
                        >
                          {busyKey === `${line.id}:busy` ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="size-3.5" />
                          )}
                          Reopen
                        </Button>
                      ) : canRestore ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-caption"
                          onClick={() => restoreRow(line)}
                          disabled={Boolean(busyKey) || batchBusy}
                        >
                          {busyKey === `${line.id}:restore` ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Undo2 className="size-3.5" />
                          )}
                          Restore
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>

                  {expanded && editor ? (
                    <TableRow>
                      <TableCell colSpan={importable ? 13 : 12} className="bg-muted/40 p-4">
                        {rowError?.lineId === line.id ? (
                          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-body-sm text-destructive">
                            {rowError.message}
                          </p>
                        ) : null}

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`desc-${line.id}`}>Description (from bank narration)</Label>
                            <Textarea
                              id={`desc-${line.id}`}
                              value={editor.description}
                              maxLength={500}
                              onChange={(event) =>
                                setEditor((current) =>
                                  current ? { ...current, description: event.target.value } : current,
                                )
                              }
                              placeholder="Expense description for the ledger"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`bizdesc-${line.id}`}>Business Description</Label>
                            <Textarea
                              id={`bizdesc-${line.id}`}
                              value={editor.businessDescription}
                              maxLength={500}
                              onChange={(event) =>
                                setEditor((current) =>
                                  current ? { ...current, businessDescription: event.target.value } : current,
                                )
                              }
                              placeholder="Business-friendly description for reports and ledger"
                            />
                            <p className="text-caption text-muted-foreground">
                              This description appears in the ledger, dashboard, reports and exports.
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`cls-${line.id}`}>Classification</Label>
                            <Select
                              items={CLASSIFICATION_ITEMS}
                              value={editor.classification}
                              onValueChange={(value) => {
                                const classification = String(value) as Classification;
                                setEditor((current) =>
                                  current
                                    ? {
                                        ...current,
                                        classification,
                                        clientId:
                                          classification === "income" ? current.clientId : "",
                                        categoryId:
                                          classification === "expense" ? current.categoryId : "",
                                        invoiceId:
                                          classification === "income" ? current.invoiceId : "",
                                      }
                                    : current,
                                );
                              }}
                            >
                              <SelectTrigger id={`cls-${line.id}`} className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CLASSIFICATION_ITEMS.map((item) => (
                                  <SelectItem key={item.value} value={item.value}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            {editor.classification === "income" ? (
                              <div className="mt-2 space-y-1.5">
                                <Label htmlFor={`client-${line.id}`}>Client (required for income)</Label>
                                <Select
                                  items={clientItems}
                                  value={editor.clientId}
                                  onValueChange={(value) => {
                                    const clientId = String(value);
                                    if (clientId === "__create_new__") {
                                      setNewClientDialog({ lineId: line.id, name: "" });
                                      return;
                                    }
                                    setEditor(
                                      (current) =>
                                        current
                                          ? {
                                              ...current,
                                              clientId,
                                              // A new client almost always invalidates the invoice link.
                                              invoiceId: "",
                                            }
                                          : current,
                                    );
                                  }}
                                >
                                  <SelectTrigger id={`client-${line.id}`} className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {clientItems.map((item) => (
                                      <SelectItem key={item.value} value={item.value}>
                                        {item.label}
                                      </SelectItem>
                                    ))}
                                    <SelectItem key="__create_new__" value="__create_new__" className="text-primary">
                                      <Plus className="mr-2 size-4" />
                                      Create new client…
                                    </SelectItem>
                                  </SelectContent>
                                </Select>

                                {editor.clientId ? (
                                  <div className="pt-1">
                                    <Label htmlFor={`invoice-${line.id}`}>
                                      Link an invoice (optional; INR only)
                                    </Label>
                                    {(() => {
                                      const loaded = invoiceOptions[editor.clientId];
                                      const items = [
                                        { value: "", label: "No invoice linked" },
                                        ...(loaded ?? []).map((option) => ({
                                          value: option.id,
                                          label: `${option.number} · outstanding ${formatINR(Number(option.outstanding), { decimals: 2 })}`,
                                        })),
                                      ];
                                      return (
                                        <Select
                                          items={items}
                                          value={editor.invoiceId}
                                          onValueChange={(value) =>
                                            setEditor((current) =>
                                              current ? { ...current, invoiceId: String(value) } : current,
                                            )
                                          }
                                        >
                                          <SelectTrigger id={`invoice-${line.id}`} className="w-full">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {items.map((item) => (
                                              <SelectItem key={item.value} value={item.value}>
                                                {item.label}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      );
                                    })()}
                                    {invoiceOptions[editor.clientId] ? null : (
                                      <p className="text-caption text-muted-foreground">
                                        Loading open invoices…
                                      </p>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {editor.classification === "expense" ? (
                              <div className="mt-2 space-y-1.5">
                                <Label htmlFor={`cat-${line.id}`}>Category (required for expense)</Label>
                                <Select
                                  items={categoryItems}
                                  value={editor.categoryId}
                                  onValueChange={(value) =>
                                    setEditor((current) =>
                                      current ? { ...current, categoryId: String(value) } : current,
                                    )
                                  }
                                >
                                  <SelectTrigger id={`cat-${line.id}`} className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {categoryItems.map((item) => (
                                      <SelectItem key={item.value} value={item.value}>
                                        {item.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ) : null}

                            {editor.classification !== "income" &&
                            editor.classification !== "expense" ? (
                              <p className="text-caption text-muted-foreground">
                                Transfers, refunds, reversals and non-business rows stay in review
                                until you classify them as income or expense.
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`reason-${line.id}`}>
                              Reason (required to skip, optional duplicate note)
                            </Label>
                            <Input
                              id={`reason-${line.id}`}
                              value={editor.reason}
                              maxLength={200}
                              autoComplete="off"
                              onChange={(event) =>
                                setEditor((current) =>
                                  current ? { ...current, reason: event.target.value } : current,
                                )
                              }
                              placeholder="e.g. Personal transfer, not business"
                            />
                          </div>

                          <div className="flex flex-wrap items-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => saveAndMaybeReady(line, false)}
                              disabled={Boolean(busyKey)}
                            >
                              {busyKey === `${line.id}:busy` ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : null}
                              Save
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => saveAndMaybeReady(line, true)}
                              disabled={Boolean(busyKey) || line.status !== "pending"}
                            >
                              Mark ready
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => skipRow(line)}
                              disabled={Boolean(busyKey)}
                            >
                              Skip
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => duplicateRow(line)}
                              disabled={Boolean(busyKey)}
                            >
                              Mark duplicate
                            </Button>
                            {line.status === "ready" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => reopenRow(line)}
                                disabled={Boolean(busyKey)}
                              >
                                <RotateCcw className="size-3.5" />
                                Reopen
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    {newClientDialog ? (
      <Dialog open={true} onOpenChange={(open) => !open && setNewClientDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new client</DialogTitle>
            <DialogDescription>
              An existing client with this name will be reused. Otherwise, a new
              client will be created. Save the row after selection to keep the link.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Label htmlFor={`new-client-${newClientDialog.lineId}`}>Client name</Label>
            <Input
              id={`new-client-${newClientDialog.lineId}`}
              value={editor?.newClientName ?? ""}
              onChange={(event) => {
                if (editor) setEditor({ ...editor, newClientName: event.target.value });
              }}
              placeholder="e.g. PARTH RAKESH DHARIA"
              maxLength={255}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewClientDialog(null)}
              disabled={creatingClient}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={async () => {
                const name = editor?.newClientName.trim();
                if (!name) {
                  toast.error("Client name is required.");
                  return;
                }
                const client = await createNewClient(name);
                if (client && editor) {
                  setEditor({ ...editor, clientId: client.clientId });
                  toast.success(
                    client.created
                      ? `Client "${name}" created and selected. Save the row to keep the link.`
                      : `Client "${name}" selected. Save the row to keep the link.`,
                  );
                  setNewClientDialog(null);
                }
              }}
              disabled={creatingClient || !editor?.newClientName.trim()}
            >
              {creatingClient ? "Creating…" : "Create client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null}
  </div>
  );
}
