/**
 * Human wording for a backup import report. Pure and DB-free so the dialog and
 * the offline backup tests use exactly the same sentence.
 */

export interface BackupImportCounts {
  dryRun: boolean;
  inserted: number;
  restored: number;
  existing: number;
}

export function backupImportMessage(input: BackupImportCounts): string {
  const record = (count: number) => `${count} record${count === 1 ? "" : "s"}`;

  if (input.dryRun) {
    const parts: string[] = [];
    if (input.inserted > 0) parts.push(`${record(input.inserted)} would be added`);
    if (input.restored > 0) parts.push(`${record(input.restored)} deleted here would be restored`);
    if (input.existing > 0) parts.push(`${record(input.existing)} already ${input.existing === 1 ? "exists" : "exist"}`);
    return parts.length
      ? `Validation passed. ${parts.join(", ")}. Nothing was written.`
      : "Validation passed. The backup has no records. Nothing was written.";
  }

  const parts: string[] = [];
  if (input.inserted > 0) parts.push(`Added ${record(input.inserted)}`);
  if (input.restored > 0) parts.push(`restored ${record(input.restored)} deleted here`);
  if (input.existing > 0) {
    parts.push(`${record(input.existing)} already ${input.existing === 1 ? "was" : "were"} live and left untouched`);
  }
  return parts.length
    ? `${parts.join(". ")}.`
    : "Everything in this backup is already live in the database. Nothing was changed.";
}
