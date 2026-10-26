/**
 * Statement conversion helpers shared with persistence.
 *
 * This module does not write to the database; it prepares only staging data.
 */

import type { ParsedStatement } from "./types";

export interface StatementLine {
  statementId: string;
  pageNumber: number;
  rowNumber: number;
  txnDate: string | null;
  valueDate: string | null;
  narration: string | null;
  reference: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  closingBalance: string | null;
  direction: string | null;
  classification: string;
  status: string;
  fingerprint: string;
  flags: string[];
  errorCode: string | null;
}

/** Converts normalized parser rows into the staging line shape for one statement. */
export function bankImportStatementLines(parsed: ParsedStatement, statementId: string): StatementLine[] {
  return parsed.lines.map(line => ({
    statementId,
    pageNumber: line.pageNumber,
    rowNumber: line.rowNumber,
    txnDate: line.txnDate,
    valueDate: line.valueDate,
    narration: line.narration,
    reference: line.reference,
    withdrawalAmount: line.withdrawalAmount,
    depositAmount: line.depositAmount,
    closingBalance: line.closingBalance,
    direction: line.direction,
    classification: line.classification,
    status: line.status,
    fingerprint: line.fingerprint,
    flags: line.flags,
    errorCode: line.errorCode,
  }));
}

/** The staging fields parsed from a statement. Financial data is not touched. */
export function statementTotals(parsed: ParsedStatement) {
  return {
    pages: parsed.pages,
    lines: parsed.lines.length,
    openingBalance: parsed.openingBalance,
    closingBalance: parsed.closingBalance,
  };
}
