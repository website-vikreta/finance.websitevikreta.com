/**
 * Pure, deterministic evidence rules for bank-statement duplicate matching.
 *
 * - No AI, no network, no randomness: the same inputs always produce the same
 *   decision, and the rules are unit-testable without a database.
 * - Strict transaction identity (exact date, exact direction, exact amount in
 *   minor units, compatible currency) is checked by the SQL callers BEFORE any
 *   function here runs; this module only weighs additional evidence.
 * - Weak similarities never harden into a duplicate: amount + date + direction
 *   alone is at most a "possible" advisory. Only strong wording evidence (or
 *   moderate wording with an agreeing client/category) is a confirmed
 *   duplicate. Conflicting evidence demands a review decision.
 * - Reviewer-approved Business Descriptions never feed back into any stored
 *   value here; normalizing is comparison-only.
 * - Labels follow the review-badge vocabulary: no narration text is ever
 *   embedded, only dates, file names and statement periods of the matched
 *   evidence, which the review surface already exposes.
 */

import { formatPeriodRange } from "./period";

// ─── Friendly source labels ──────────────────────────────────────────────────

export const DUPLICATE_SOURCE_LABELS = {
  manual: "Manual Entry",
  chatbot: "Finance AI",
  bank_import: "Bank Statement Import",
} as const;

export type DuplicateSourceKey = keyof typeof DUPLICATE_SOURCE_LABELS;

const OTHER_SOURCE_LABEL = "Other Source";

/** Maps a stored transaction source to a friendly badge label. Never renames. */
export function sourceBadgeLabel(source: string | null | undefined): string {
  if (
    source === "manual" ||
    source === "chatbot" ||
    source === "bank_import"
  ) {
    return DUPLICATE_SOURCE_LABELS[source];
  }
  return OTHER_SOURCE_LABEL;
}

/** "Duplicate · Manual Entry · 2026-04-11" from a ledger transaction. */
export function transactionBadgeLabel(input: {
  source: string | null | undefined;
  /** ISO date of the recorded transaction. */
  when: string | null;
  severity: CandidateSeverity;
  /** Set when the recorded bank-import transaction carries its own statement. */
  originFileName?: string | null;
}): string {
  const sourceLabel =
    input.originFileName && input.source === "bank_import"
      ? "Previous Statement"
      : sourceBadgeLabel(input.source);
  const prefix = severityPrefix(input.severity);
  return input.when
    ? `${prefix} · ${sourceLabel} · ${input.when}`
    : `${prefix} · ${sourceLabel}`;
}

function severityPrefix(severity: CandidateSeverity): string {
  if (severity === "strong") return "Duplicate";
  if (severity === "review") return "Duplicate? · Needs review";
  return "Possible dup";
}

/** Staging-row badge labels (candidate pairs between statement lines). */
export function stagingBadgeLabel(
  kind: "same_statement_row" | "other_statement_row" | "imported_before",
  when: string | null,
): string {
  if (kind === "same_statement_row") {
    return `Duplicate Candidate · Same Statement${when ? ` · ${when}` : ""}`;
  }
  if (kind === "other_statement_row") {
    return `Duplicate Candidate · Earlier Statement${when ? ` · ${when}` : ""}`;
  }
  return `Duplicate · Previous Statement${when ? ` · ${when}` : ""}`;
}

/** Kind C: the line's own import is live in the ledger. */
export const ALREADY_IMPORTED_LABEL = "Already Imported · This Statement";

// ─── Business-text normalization ─────────────────────────────────────────────

const TRANSLITERATE_WS = /[\s\u00a0]+/g;
const PUNCTUATION = /[^a-z0-9\s]+/g;

/**
 * Narration fragments the generated descriptions append and which never
 * identify the business activity. Stripped wherever they trail a text.
 */
const TRAILING_BOILERPLATE = [
  "payment purpose to confirm",
  "purpose to confirm",
  "sender and purpose must be confirmed",
  "purpose and client linkage must be confirmed",
  "purpose and category must be confirmed",
  "sender and purpose to confirm",
  "recipient and purpose to confirm",
  "merchant and purpose require review",
  "merchant and purpose to confirm",
  "review for reversal classification",
  "review required",
  "to confirm",
];

/** Transfer rails: they say HOW money moved, never WHAT moved. */
const RAIL_TOKENS = new Set([
  "neft",
  "imps",
  "rtgs",
  "upi",
  "ach",
  "clg",
  "ecs",
  "tpt",
]);

/** Company-legal suffixes that varyerate printings of the same entity. */
const LEGAL_SUFFIX_TOKENS = new Set([
  "inc",
  "pvt",
  "ltd",
  "llp",
  "limited",
  "private",
]);

/** Small connecting words; both sides drop them, so containment is unaffected. */
const STOPWORD_TOKENS = new Set([
  "the",
  "a",
  "an",
  "of",
  "from",
  "to",
  "via",
  "by",
  "and",
  "for",
  "in",
  "on",
  "with",
  "w",
  "at",
  "ax",
]);

/**
 * Our own name appears in bank narrations on every escrow credit. It can never
 * separate two different transactions, so it is dropped on both sides.
 */
const SELF_NAME_TOKENS = new Set(["website", "vikreta"]);

/** Any token holding ≥ 5 consecutive digits is a bank/reference fragment. */
const REFERENCE_LIKE = /\d{5,}/;

export interface BusinessTextInput {
  value: string | null | undefined;
}

/**
 * Normalizes a Business Description (or narration) for comparison only:
 * casing, punctuation, boilerplate suffixes, transfer rails, reference-like
 * fragments, legal suffixes and self-name tokens fold away; everything that
 * can describe the actual business activity stays.
 */
export function normalizeBusinessText(input: BusinessTextInput): string {
  if (!input.value) return "";
  let text = input.value.toLowerCase().replace(PUNCTUATION, " ");
  // Collapse spacing early so the boilerplate tail matches reliably.
  text = text.replace(TRANSLITERATE_WS, " ").trim();
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const phrase of TRAILING_BOILERPLATE) {
      if (text.endsWith(phrase)) {
        text = text.slice(0, -phrase.length).trim();
        stripped = true;
      }
    }
    if (text.endsWith("-") || text.endsWith("–") || text.endsWith("—")) {
      text = text.slice(0, -1).trim();
      stripped = true;
    }
  }
  return text;
}

/** Tokens of a normalized business text that can support a duplicate match. */
export function meaningfulTokens(input: BusinessTextInput): string[] {
  const normalized = normalizeBusinessText(input);
  if (!normalized) return [];
  return normalized.split(" ").filter((token) => {
    if (!token) return false;
    if (STOPWORD_TOKENS.has(token)) return false;
    if (RAIL_TOKENS.has(token)) return false;
    if (LEGAL_SUFFIX_TOKENS.has(token)) return false;
    if (SELF_NAME_TOKENS.has(token)) return false;
    if (REFERENCE_LIKE.test(token)) return false; // IFSC codes, UTRs, refs
    if (/^\d+$/.test(token)) return false; // bare numbers are never merchants
    return true;
  });
}

/** A token specific enough to identify a business activity on its own. */
function isDistinctiveToken(token: string): boolean {
  return token.length >= 5;
}

/** Tokens of four or more letters read as a name/counterparty fragment. */
const NAMED_TOKEN = /^[a-z]{4,}$/;

export type TextEvidence = "strong" | "moderate" | "none" | "unknown";

/**
 * Weights how strongly two business descriptions refer to the same activity.
 * - strong: containment (one token set absorbs the other) with at least one
 *   distinctive token in the absorbed side — the generated long narration
 *   around a short approved description, and the reverse.
 * - moderate: a meaningful token overlap that still needs corroboration.
 * - none: different business activities on both sides.
 * - unknown: at least one side has no usable text.
 *
 * Pure token-set logic over an EXACT match: no substring fuzz, no edit
 * distance, no scoring thresholds — the same inputs always decide the same.
 */
export function compareBusinessTexts(
  a: string | null | undefined,
  b: string | null | undefined,
): TextEvidence {
  const tokensA = new Set(meaningfulTokens({ value: a }));
  const tokensB = new Set(meaningfulTokens({ value: b }));
  if (tokensA.size === 0 || tokensB.size === 0) return "unknown";
  if (tokensA.size === tokensB.size && [...tokensA].every((t) => tokensB.has(t))) return "strong";

  const [smaller, larger] = tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  const containmentOk = [...smaller].every((t) => larger.has(t));
  if (containmentOk) {
    const distinctive = [...smaller].some(isDistinctiveToken);
    return distinctive ? "strong" : "moderate";
  }

  const shared = [...tokensA].filter((token) => tokensB.has(token));
  if (shared.length >= 2) {
    // A named difference on BOTH sides ("Client Alpha paid" vs "Client Beta
    // paid") means the wording diverges on each side around shared boilerplate
    // — two different activities. Short filler words on one side do not
    // disqualify a match.
    const namedDifference = (tokens: Set<string>, other: Set<string>): boolean =>
      [...tokens].some((t) => !other.has(t) && NAMED_TOKEN.test(t));
    if (namedDifference(tokensA, tokensB) && namedDifference(tokensB, tokensA)) return "none";
    return "moderate";
  }
  // A single distinctive token only connects two texts that describe nothing
  // else — e.g. "GitHub" alone on both sides. A shared filler ("industries")
  // between differently named merchants must not qualify.
  if (shared.length === 1 && isDistinctiveToken(shared[0])) {
    const onlyDistinctive = (tokens: Set<string>): boolean =>
      [...tokens].filter(isDistinctiveToken).length === 1;
    if (onlyDistinctive(tokensA) && onlyDistinctive(tokensB)) return "moderate";
  }
  return "none";
}

// ─── Candidate evaluation ────────────────────────────────────────────────────

export type CandidateSeverity = "strong" | "review" | "possible";

export interface TransactionCandidateInput {
  lineBusinessDescription: string | null;
  lineNarration: string | null;
  lineClientId: string | null;
  lineCategoryId: number | null;
  lineDirection: "deposit" | "withdrawal";
  transaction: {
    source: string | null | undefined;
    description: string | null;
    clientNameSnapshot: string | null;
    clientName: string | null;
    clientId: string | null;
    categoryId: number | null;
    txnDate: string | null;
    originFileName?: string | null;
    originStatementFrom?: string | null;
    originStatementTo?: string | null;
  };
}

export interface TransactionCandidateEvidence {
  severity: CandidateSeverity;
  /** Badge text, e.g. "Duplicate · Manual Entry · 2026-04-11". */
  label: string;
  /** Reviewer-facing explanation; never contains narration or references. */
  detail: string;
  /** ISO date of the recorded (or matched) transaction, when known. */
  when: string | null;
  amount: string | null;
}

/**
 * Weighs one ledger match for one statement line. Callers must only pass
 * candidates whose strict identity fields already agree (exact transaction
 * date, exact direction, exact amount in the same currency) — the evidence
 * here decides how strongly the same-money claim holds.
 */
export function evaluateTransactionCandidate(
  input: TransactionCandidateInput,
): TransactionCandidateEvidence {
  const { transaction, lineDirection, lineBusinessDescription, lineNarration } = input;

  const isIncome = lineDirection === "deposit";
  const clientCorroboration = corroboration(
    isIncome ? lineClientId(input) : null,
    isIncome ? transaction.clientId : null,
  );
  const categoryCorroboration = corroboration(
    isIncome ? null : input.lineCategoryId,
    isIncome ? null : transaction.categoryId,
  );

  const transactionText =
    transaction.description ?? transaction.clientNameSnapshot ?? transaction.clientName ?? null;
  // The reviewer-approved Business Description is the primary text (it is what
  // the ledger stores at import); the raw narration is a secondary witness.
  const primarySimilarity = compareBusinessTexts(lineBusinessDescription, transactionText);
  const secondarySimilarity =
    primarySimilarity === "strong"
      ? primarySimilarity
      : compareBusinessTexts(lineNarration, transactionText);
  const similarity = bestEvidence(primarySimilarity, secondarySimilarity);

  const originNote = originStatementNote(transaction);
  const sourceLabel = sourceBadgeLabel(transaction.source);

  let severity: CandidateSeverity;
  let evidenceNote: string;
  if (similarity === "strong") {
    const conflict = conflictNote(clientCorroboration, categoryCorroboration);
    if (conflict) {
      severity = "review";
      evidenceNote = conflict;
    } else {
      severity = "strong";
      evidenceNote = corroborationNote(clientCorroboration, categoryCorroboration);
    }
  } else if (similarity === "moderate") {
    const conflict = conflictNote(clientCorroboration, categoryCorroboration);
    if (conflict) {
      severity = "review";
      evidenceNote = conflict;
    } else if (clientCorroboration === "agree" || categoryCorroboration === "agree") {
      severity = "strong";
      evidenceNote = corroborationNote(clientCorroboration, categoryCorroboration);
    } else {
      severity = "possible";
      evidenceNote =
        "The wording overlaps but a mapping (client or category) is needed to weigh the match. Confirm after saving the row mapping.";
    }
  } else {
    severity = "possible";
    evidenceNote =
      similarity === "unknown"
        ? "Only the amount and date agree; there is no description text to compare."
        : "The wording describes a different activity, so this is not a confirmed duplicate — import only if this is genuinely new money.";
    const agree = clientCorroboration === "agree" || categoryCorroboration === "agree";
    const conflict = clientCorroboration === "conflict" || categoryCorroboration === "conflict";
    if (agree && !conflict) {
      evidenceNote =
        "Only the amount and the date agree; the client/category match alone is not proof of a duplicate.";
    } else if (conflict) {
      evidenceNote =
        "The recorded transaction names a different client/category and different wording, so the two read as separate money, not a duplicate.";
    }
  }

  return {
    severity,
    label: transactionBadgeLabel({
      source: transaction.source,
      when: transaction.txnDate,
      severity,
      originFileName: transaction.originFileName,
    }),
    detail: composeTransactionDetail({
      sourceLabel,
      originNote,
      evidenceNote,
      severity,
    }),
    when: transaction.txnDate,
    amount: null,
  };
}

function corroboration(
  lineValue: string | number | null,
  transactionValue: string | number | null,
): "agree" | "conflict" | "unknown" {
  if (lineValue == null || transactionValue == null) return "unknown";
  if (String(lineValue) === String(transactionValue)) return "agree";
  return "conflict";
}

function lineClientId(input: TransactionCandidateInput): string | null {
  return input.lineClientId;
}

function bestEvidence(a: TextEvidence, b: TextEvidence): TextEvidence {
  const order: TextEvidence[] = ["strong", "moderate", "none", "unknown"];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

function conflictNote(
  client: "agree" | "conflict" | "unknown",
  category: "agree" | "conflict" | "unknown",
): string | null {
  if (client === "conflict") {
    return "The recorded transaction belongs to a different client than this row — a review decision is required.";
  }
  if (category === "conflict") {
    return "The recorded transaction uses a different expense category than this row — a review decision is required.";
  }
  return null;
}

function corroborationNote(
  client: "agree" | "conflict" | "unknown",
  category: "agree" | "conflict" | "unknown",
): string {
  if (client === "agree") {
    return "The selected client matches the recorded transaction's client.";
  }
  if (category === "agree") {
    return "The selected category matches the recorded transaction's category.";
  }
  return "The wording of the Business Description matches the recorded transaction.";
}

function originStatementNote(
  transaction: TransactionCandidateInput["transaction"],
): string | null {
  if (!transaction.originFileName) return null;
  const range = formatPeriodRange(
    transaction.originStatementFrom ?? null,
    transaction.originStatementTo ?? null,
  );
  const period = range ? ` (statement ${range})` : "";
  return `Imported earlier from ${transaction.originFileName}${period}.`;
}

function composeTransactionDetail(parts: {
  sourceLabel: string;
  originNote: string | null;
  evidenceNote: string;
  severity: CandidateSeverity;
}): string {
  const base = `A recorded ${parts.sourceLabel} matches this row's date, amount and direction.`;
  const lead = parts.originNote ? `${parts.originNote} ` : "";
  const closing =
    parts.severity === "review"
      ? " Decide in review before this row imports."
      : parts.severity === "strong"
        ? " EXISTING money is already recorded — do not import again."
        : "";
  return `${lead}${base} ${parts.evidenceNote}${closing}`;
}

// ─── Ambiguity fold ──────────────────────────────────────────────────────────

/**
 * Downgrades evidence when one line matches several recorded transactions
 * with equal strength: the reviewer must choose, so nothing is "strong" until
 * they decide. Candidates passed in must belong to ONE line.
 */
export function resolveAmbiguousCandidates(
  evidenceList: TransactionCandidateEvidence[],
): TransactionCandidateEvidence[] {
  const strongCount = evidenceList.filter((e) => e.severity === "strong").length;
  if (strongCount < 2) return evidenceList;
  return evidenceList.map((e) =>
    e.severity === "strong"
      ? {
          ...e,
          severity: "review",
          label: transactionBadgeLabelRedated(e),
          detail: `${e.detail} More than one recorded transaction matches with equal evidence — a review decision is required.`,
        }
      : e,
  );
}

/** Rebuilds the label with the review severity while keeping the source/date. */
function transactionBadgeLabelRedated(evidence: TransactionCandidateEvidence): string {
  const withSource = evidence.label.replace(/^Duplicate · /, "");
  return `Duplicate? · Needs review · ${withSource}`;
}

// ─── Import gate ─────────────────────────────────────────────────────────────

/**
 * The non-blocking flag a reviewer sets to record "I checked; this is new
 * money". Stored on the staging line; the import gate respects it instead of
 * silently importing or silently rejecting.
 */
export const NOT_A_DUPLICATE_FLAG = "NOT_A_DUPLICATE" as const;

/**
 * Returns the per-line import error when a duplicate blocks the row, or null
 * when the row may import (no confirmed duplicate, or the reviewer explicitly
 * acknowledged this line as new money).
 */
export function importDuplicateBlockError(
  evidenceList: TransactionCandidateEvidence[],
  lineFlags: readonly string[],
): string | null {
  if (lineFlags.includes(NOT_A_DUPLICATE_FLAG)) return null;
  const blocking = evidenceList.filter(
    (e) => e.severity === "strong" || e.severity === "review",
  );
  if (blocking.length === 0) return null;
  const strongest = blocking[0];
  const extra =
    blocking.length > 1
      ? ` ${blocking.length} recorded transactions match this row.`
      : "";
  return `${strongest.label} — this money is already recorded. ${strongest.detail} Mark the row as duplicate, or confirm "Not a duplicate" in the row editor if this is genuinely new money.${extra}`;
}
