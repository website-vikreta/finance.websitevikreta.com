import {
  decimalAdd,
  decimalCompare,
  decimalSubtract,
  isIsoDate,
  normalizeNarration,
  parseAmountCell,
} from "./normalize";
import {
  BLOCKING_LINE_FLAGS,
  type Classification,
  type LineFlag,
  type ParsedLine,
  type SafeErrorCode,
} from "./types";

export { BLOCKING_LINE_FLAGS };

export type LineValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: SafeErrorCode;
      reason: string;
      flags: LineFlag[];
    };

type ReadyLine = Pick<
  ParsedLine,
  | "txnDate"
  | "valueDate"
  | "narration"
  | "withdrawalAmount"
  | "depositAmount"
  | "direction"
  | "classification"
  | "flags"
>;

/**
 * Enforces the rule that a malformed row may exist but can never become
 * `ready` until the date, narration, and one amount side are valid.
 */
export function validateLineForReady(line: ReadyLine): LineValidationResult {
  if (!isIsoDate(line.txnDate)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "A valid transaction date is required.",
      flags: line.flags.includes("MISSING_DATE") ? ["MISSING_DATE"] : ["INVALID_DATE"],
    };
  }
  if (line.valueDate != null && !isIsoDate(line.valueDate)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "The value date is invalid.",
      flags: ["INVALID_VALUE_DATE"],
    };
  }
  if (!normalizeNarration(line.narration)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "Narration is required.",
      flags: ["MISSING_NARRATION"],
    };
  }

  const hasWithdrawal = line.withdrawalAmount !== null;
  const hasDeposit = line.depositAmount !== null;
  if (hasWithdrawal === hasDeposit) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "Exactly one withdrawal or deposit amount is required.",
      flags: hasWithdrawal ? ["BOTH_AMOUNTS"] : ["MISSING_AMOUNT"],
    };
  }

  const amount = hasWithdrawal ? line.withdrawalAmount : line.depositAmount;
  const parsed = parseAmountCell(amount);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "The amount must be a positive decimal with at most two places.",
      flags: ["INVALID_AMOUNT"],
    };
  }
  if (parsed.negative || parsed.value === "0.00") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "The amount must be a positive decimal with at most two places.",
      flags: [parsed.negative ? "NEGATIVE_AMOUNT" : "ZERO_AMOUNT"],
    };
  }

  const expectedDirection = hasWithdrawal ? "withdrawal" : "deposit";
  if (line.direction == null) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "The payment direction could not be established from the source amount columns.",
      flags: ["UNKNOWN_DIRECTION"],
    };
  }
  if (line.direction !== expectedDirection) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "The amount side and direction do not agree.",
      flags: ["DIRECTION_CONFLICT"],
    };
  }

  if (!isImportableClassification(line.classification)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "This line needs a reviewer decision before it can be ready.",
      flags: [],
    };
  }

  const blocking = line.flags.filter((flag) => BLOCKING_LINE_FLAGS.has(flag));
  if (blocking.length > 0) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "Resolve the highlighted parser flags before importing this line.",
      flags: blocking,
    };
  }

  return { ok: true };
}

export function isImportableClassification(
  classification: Classification,
): classification is "income" | "expense" {
  return classification === "income" || classification === "expense";
}

/**
 * A classification has to agree with the direction of the money at import
 * time: income imports from deposits, expense imports from withdrawals.
 */
export function validateImportDirection(
  direction: "deposit" | "withdrawal" | null,
  classification: Classification,
): string | null {
  if (classification === "income" && direction !== "deposit") {
    return "Income lines import from deposits only.";
  }
  if (classification === "expense" && direction !== "withdrawal") {
    return "Expense lines import from withdrawals only.";
  }
  return null;
}

/**
 * Server-side mapping gate for Phase 4. It runs before a transaction insert:
 * an income line needs an existing client; a withdrawal needs an explicit
 * existing category. The line row itself is locked in that same DB transaction.
 */
export function validateLineForImport(
  line: ReadyLine & { clientId: string | null; categoryId: number | null },
): LineValidationResult {
  const ready = validateLineForReady(line);
  if (!ready.ok) return ready;

  if (line.classification === "income" && !line.clientId) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "Select an existing client for this deposit.",
      flags: [],
    };
  }
  if (line.classification === "expense" && line.categoryId == null) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "Select an existing category for this withdrawal.",
      flags: [],
    };
  }

  return { ok: true };
}

export type ReconciliationResult =
  | {
      checked: true;
      ok: boolean;
      expectedClosing: string;
      difference: string;
    }
  | {
      checked: false;
      reason: string;
    };

/**
 * Compares opening + deposits − withdrawals with the declared closing balance.
 * All arithmetic is exact decimal-string arithmetic; no floating point.
 */
export function reconcileStatement(
  lines: Pick<ParsedLine, "withdrawalAmount" | "depositAmount">[],
  openingBalance: string | null,
  closingBalance: string | null,
): ReconciliationResult {
  if (!openingBalance || !closingBalance) {
    return { checked: false, reason: "Opening or closing balance is missing." };
  }

  let movement = "0.00";
  for (const line of lines) {
    const hasWithdrawal = line.withdrawalAmount !== null;
    const hasDeposit = line.depositAmount !== null;
    if (hasWithdrawal === hasDeposit) {
      return { checked: false, reason: "Some rows do not have exactly one valid amount." };
    }
    const amount = hasWithdrawal ? line.withdrawalAmount : line.depositAmount;
    if (!amount) {
      return { checked: false, reason: "Some rows do not have exactly one valid amount." };
    }
    const parsed = parseAmountCell(amount);
    if (!parsed.ok || parsed.negative) {
      return { checked: false, reason: "Some rows contain an invalid amount." };
    }
    movement = hasWithdrawal
      ? decimalSubtract(movement, parsed.value)
      : decimalAdd(movement, parsed.value);
  }

  const expectedClosing = decimalAdd(openingBalance, movement);
  const difference = decimalSubtract(closingBalance, expectedClosing);
  return {
    checked: true,
    ok: decimalCompare(difference, "0.00") === 0,
    expectedClosing,
    difference,
  };
}
