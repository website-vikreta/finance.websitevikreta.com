/**
 * Deterministic narration-to-business-description rules.
 *
 * Pure functions, no external dependencies. No AI, no network calls.
 * Each rule returns a structured result with confidence and optional mapping hints.
 */

import type { Classification, LineFlag } from "./types";
import { collapseWhitespace } from "./normalize";

export interface BusinessDescriptionResult {
  description: string;
  ruleId: string;
  confident: boolean;
  /** Optional hints for the reviewer — never auto-applied. */
  suggestedCategory?: string;
  suggestedClientMatch?: string;
  requiresReview: boolean;
  reviewReason?: string;
}

/** Rule identifier constants for traceability. */
export const BUSINESS_DESCRIPTION_RULES = {
  GITHUB: "github-card",
  ELEVENLABS: "elevenlabs-card",
  CLAUDE_AI_SUBSCRIPTION: "claude-ai-subscription",
  ANTHROPIC_CARD: "anthropic-card",
  GOOGLE_WORKSPACE: "google-workspace-card",
  MAKE_COM: "make-com-card",
  GODADDY: "godaddy-card",
  DEBIT_CARD_PRORATA_FEE: "debit-card-prorata-fee",
  INSTAALERTCHG: "instaalert-charge",
  MARKUP_ST: "markup-st",
  DCC_ST: "dcc-st",
  IMPS_P2P_CHARGE: "imps-p2p-charge",
  NEFT_CR_PAYMENT_ESCROW: "neft-cr-payment-escrow",
  NEFT_CR_SENDER: "neft-cr-sender",
  RDA_FIR_INW: "rda-fir-inw",
  NEFT_DR_STIPEND: "neft-dr-stipend",
  IMPS_STIPEND: "imps-stipend",
  SELF_CHQ_PAID: "self-chq-paid",
  OUTGOING_TRANSFER_UNKNOWN: "outgoing-transfer-unknown",
  REVERSAL_VERIFIED: "reversal-verified",
  NEGATIVE_WITHDRAWAL: "negative-withdrawal",
  CARD_PAYMENT_UNCLEAR: "card-payment-unclear",
  FALLBACK: "fallback",
} as const;

export type BusinessDescriptionRuleId = (typeof BUSINESS_DESCRIPTION_RULES)[keyof typeof BUSINESS_DESCRIPTION_RULES];

interface RuleContext {
  narration: string;
  reference: string | null;
  withdrawalAmount: string | null;
  depositAmount: string | null;
  direction: "deposit" | "withdrawal" | null;
  classification: Classification;
  flags: LineFlag[];
}

/**
 * Normalizes text for matching: uppercase, collapse whitespace, remove punctuation noise.
 */
function normalizeForMatch(text: string): string {
  return collapseWhitespace(text).toUpperCase().replace(/[^A-Z0-9\s]/g, " ");
}

/**
 * Checks if a normalized narration contains all given keywords (order-independent).
 */
function hasAllKeywords(normalized: string, keywords: string[]): boolean {
  return keywords.every((kw) => normalized.includes(kw.toUpperCase()));
}

/**
 * Checks if a normalized narration contains any of the given keywords.
 */
function hasAnyKeyword(normalized: string, keywords: string[]): boolean {
  return keywords.some((kw) => normalized.includes(kw.toUpperCase()));
}

/**
 * Extracts a potential counterparty name from narration for transfer descriptions.
 * Returns the cleaned text after common transfer prefixes.
 */
function extractCounterparty(narration: string): string | null {
  const normalized = normalizeForMatch(narration);
  // Common prefixes to strip
  const prefixes = [
    "NEFT CR",
    "NEFT DR",
    "IMPS",
    "RTGS",
    "UPI",
    "RDA FIR INW",
    "RDA FIR OUT",
    "PAYMENT ESCROW",
    "WEBSITE VIKRETA",
  ];
  let text = normalized;
  for (const prefix of prefixes) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
    }
  }
  // Remove common separators and noise
  text = text.replace(/^[-:\s]+/, "").trim();
  return text || null;
}

/**
 * Main entry point: generates a business description from a parsed line.
 */
export function generateBusinessDescription(context: RuleContext): BusinessDescriptionResult {
  const normalized = normalizeForMatch(context.narration);

  // 1) Software and card payments
  if (hasAllKeywords(normalized, ["GITHUB"])) {
    return {
      description: "Payment to GitHub by card",
      ruleId: BUSINESS_DESCRIPTION_RULES.GITHUB,
      confident: true,
      suggestedCategory: "Software & subscriptions",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["ELEVENLABS", "IO"])) {
    return {
      description: "Payment to ElevenLabs by card",
      ruleId: BUSINESS_DESCRIPTION_RULES.ELEVENLABS,
      confident: true,
      suggestedCategory: "Software & subscriptions",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["CLAUDE", "AI", "SUBSCRIPTION"])) {
    return {
      description: "Claude AI subscription payment",
      ruleId: BUSINESS_DESCRIPTION_RULES.CLAUDE_AI_SUBSCRIPTION,
      confident: true,
      suggestedCategory: "Software & subscriptions",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["ANTHROPIC", "CLAUDE"]) || hasAllKeywords(normalized, ["ANTHROPIC", "SUBSCRIPTION"])) {
    return {
      description: "Claude AI subscription payment by card",
      ruleId: BUSINESS_DESCRIPTION_RULES.CLAUDE_AI_SUBSCRIPTION,
      confident: true,
      suggestedCategory: "Software & subscriptions",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["ANTHROPIC"])) {
    return {
      description: "Payment to Anthropic by card",
      ruleId: BUSINESS_DESCRIPTION_RULES.ANTHROPIC_CARD,
      confident: true,
      suggestedCategory: "Software & subscriptions",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["GOOGLEWORKSPACE"])) {
    return {
      description: "Google Workspace payment by card",
      ruleId: BUSINESS_DESCRIPTION_RULES.GOOGLE_WORKSPACE,
      confident: true,
      suggestedCategory: "Software & subscriptions",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["MAKE", "COM"])) {
    return {
      description: "Make.com payment by card",
      ruleId: BUSINESS_DESCRIPTION_RULES.MAKE_COM,
      confident: true,
      suggestedCategory: "Software & subscriptions",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["GODADDY"])) {
    return {
      description: "GoDaddy payment by card",
      ruleId: BUSINESS_DESCRIPTION_RULES.GODADDY,
      confident: true,
      suggestedCategory: "Cloud & hosting",
      requiresReview: false,
    };
  }

  // 2) Bank charges
  if (hasAllKeywords(normalized, ["DEBIT", "CARD", "PRORATA", "FEE"])) {
    return {
      description: "Debit card fee",
      ruleId: BUSINESS_DESCRIPTION_RULES.DEBIT_CARD_PRORATA_FEE,
      confident: true,
      suggestedCategory: "Other",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["INSTAALERTCHG"])) {
    return {
      description: "Bank SMS alert service charge",
      ruleId: BUSINESS_DESCRIPTION_RULES.INSTAALERTCHG,
      confident: true,
      suggestedCategory: "Other",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["MARKUP", "ST"])) {
    return {
      description: "International card markup and associated charge",
      ruleId: BUSINESS_DESCRIPTION_RULES.MARKUP_ST,
      confident: true,
      suggestedCategory: "Other",
      requiresReview: false,
    };
  }

  if (hasAllKeywords(normalized, ["DCC", "ST"])) {
    return {
      description: "International card currency-conversion-related charge",
      ruleId: BUSINESS_DESCRIPTION_RULES.DCC_ST,
      confident: true,
      suggestedCategory: "Other",
      requiresReview: false,
    };
  }

  // IMPS P2P that appears to be a charge (no clear counterparty, small amount)
  if (
    hasAllKeywords(normalized, ["IMPS", "P2P"]) &&
    context.direction === "withdrawal" &&
    context.withdrawalAmount &&
    Number(context.withdrawalAmount) < 100
  ) {
    return {
      description: "IMPS transfer charge — review required",
      ruleId: BUSINESS_DESCRIPTION_RULES.IMPS_P2P_CHARGE,
      confident: false,
      suggestedCategory: "Other",
      requiresReview: true,
      reviewReason: "Cannot confirm this is a charge vs. a transfer without counterparty details",
    };
  }

  // 3) Incoming and outgoing transfers
  if (
    hasAllKeywords(normalized, ["NEFT", "CR"]) &&
    hasAllKeywords(normalized, ["PAYMENT", "ESCROW", "WEBSITE", "VIKRETA"])
  ) {
    return {
      description: "Money received via NEFT through Payment Escrow — client and payment purpose to confirm",
      ruleId: BUSINESS_DESCRIPTION_RULES.NEFT_CR_PAYMENT_ESCROW,
      confident: false,
      requiresReview: true,
      reviewReason: "Client identity and invoice linkage must be confirmed by reviewer",
    };
  }

  if (hasAllKeywords(normalized, ["NEFT", "CR"])) {
    const counterparty = extractCounterparty(context.narration);
    if (counterparty) {
      return {
        description: `Money received from ${counterparty} — payment purpose to confirm`,
        ruleId: BUSINESS_DESCRIPTION_RULES.NEFT_CR_SENDER,
        confident: false,
        requiresReview: true,
        reviewReason: "Incoming transfer — purpose and client linkage must be confirmed",
      };
    }
    return {
      description: "Money received via NEFT — sender and purpose to confirm",
      ruleId: BUSINESS_DESCRIPTION_RULES.NEFT_CR_SENDER,
      confident: false,
      requiresReview: true,
      reviewReason: "Incoming transfer — sender and purpose must be confirmed",
    };
  }

  if (hasAllKeywords(normalized, ["RDA", "FIR", "INW"])) {
    const counterparty = extractCounterparty(context.narration);
    if (counterparty) {
      return {
        description: `Money received from ${counterparty} — payment purpose to confirm`,
        ruleId: BUSINESS_DESCRIPTION_RULES.RDA_FIR_INW,
        confident: false,
        requiresReview: true,
        reviewReason: "Incoming transfer — purpose and client linkage must be confirmed",
      };
    }
    return {
      description: "Money received via RDA — sender and purpose to confirm",
      ruleId: BUSINESS_DESCRIPTION_RULES.RDA_FIR_INW,
      confident: false,
      requiresReview: true,
      reviewReason: "Incoming transfer — sender and purpose must be confirmed",
    };
  }

  if (
    (hasAllKeywords(normalized, ["NEFT", "DR"]) || hasAllKeywords(normalized, ["IMPS"])) &&
    hasAllKeywords(normalized, ["STIPEND"])
  ) {
    const counterparty = extractCounterparty(context.narration);
    const method = hasAllKeywords(normalized, ["NEFT", "DR"]) ? "NEFT" : "IMPS";
    if (counterparty) {
      return {
        description: `Stipend payment to ${counterparty} via ${method}`,
        ruleId: hasAllKeywords(normalized, ["NEFT", "DR"]) ? BUSINESS_DESCRIPTION_RULES.NEFT_DR_STIPEND : BUSINESS_DESCRIPTION_RULES.IMPS_STIPEND,
        confident: true,
        suggestedCategory: "Salaries",
        requiresReview: true,
        reviewReason: "Stipend classification subject to company accounting policy",
      };
    }
  }

  if (hasAllKeywords(normalized, ["SELF", "CHQ", "PAID"])) {
    return {
      description: "Self-cheque payment — purpose to confirm",
      ruleId: BUSINESS_DESCRIPTION_RULES.SELF_CHQ_PAID,
      confident: false,
      requiresReview: true,
      reviewReason: "Purpose of self-cheque withdrawal must be confirmed",
    };
  }

  // Outgoing transfer with unidentified/ambiguous recipient
  if (
    context.direction === "withdrawal" &&
    (hasAnyKeyword(normalized, ["NEFT", "DR", "IMPS", "RTGS", "UPI", "TRANSFER"])) &&
    !hasAllKeywords(normalized, ["STIPEND"])
  ) {
    const counterparty = extractCounterparty(context.narration);
    if (counterparty) {
      return {
        description: `Transfer to ${counterparty} — purpose to confirm`,
        ruleId: BUSINESS_DESCRIPTION_RULES.OUTGOING_TRANSFER_UNKNOWN,
        confident: false,
        requiresReview: true,
        reviewReason: "Outgoing transfer — purpose and category must be confirmed",
      };
    }
    return {
      description: "Outgoing transfer — recipient and purpose to confirm",
      ruleId: BUSINESS_DESCRIPTION_RULES.OUTGOING_TRANSFER_UNKNOWN,
      confident: false,
      requiresReview: true,
      reviewReason: "Outgoing transfer — recipient and purpose must be confirmed",
    };
  }

  // 4) Reversals, negative amounts, unknown merchants
  // Verified reversal: negative withdrawal amount with REVERSAL flag
  if (
    context.flags.includes("REVERSAL") &&
    context.direction === "withdrawal" &&
    context.withdrawalAmount &&
    context.withdrawalAmount.startsWith("-")
  ) {
    // Try to extract merchant from narration
    const merchantMatch = normalized.match(/(GITHUB|ELEVENLABS|ANTHROPIC|GOOGLEWORKSPACE|MAKE\.COM|GODADDY|CLAUDE)/);
    const merchant = merchantMatch ? merchantMatch[1].replace(".", " ") : "merchant";
    return {
      description: `Reversal of an earlier ${merchant} card charge`,
      ruleId: BUSINESS_DESCRIPTION_RULES.REVERSAL_VERIFIED,
      confident: true,
      requiresReview: false,
    };
  }

  // Negative withdrawal (potential reversal without explicit flag)
  if (
    context.direction === "withdrawal" &&
    context.withdrawalAmount &&
    context.withdrawalAmount.startsWith("-")
  ) {
    return {
      description: "Negative withdrawal — review for reversal classification",
      ruleId: BUSINESS_DESCRIPTION_RULES.NEGATIVE_WITHDRAWAL,
      confident: false,
      requiresReview: true,
      reviewReason: "Negative withdrawal may indicate a reversal; classify explicitly",
    };
  }

  // Card payment with unclear merchant
  if (
    context.direction === "withdrawal" &&
    !context.flags.includes("BANK_CHARGE") &&
    !context.flags.includes("TRANSFER") &&
    !hasAnyKeyword(normalized, ["NEFT", "IMPS", "RTGS", "UPI", "CHQ", "CHEQUE", "SELF"])
  ) {
    return {
      description: "Card payment — merchant and purpose require review",
      ruleId: BUSINESS_DESCRIPTION_RULES.CARD_PAYMENT_UNCLEAR,
      confident: false,
      requiresReview: true,
      reviewReason: "Merchant not recognized; reviewer must identify and categorize",
    };
  }

  // 5) Fallback
  return {
    description: context.narration || "Transaction — review required",
    ruleId: BUSINESS_DESCRIPTION_RULES.FALLBACK,
    confident: false,
    requiresReview: true,
    reviewReason: "No matching rule; manual description required",
  };
}

/**
 * Generates a business description during parsing (Phase 1).
 * This is called from parse.ts when creating ParsedLine objects.
 */
export function generateBusinessDescriptionForParsedLine(
  narration: string | null,
  reference: string | null,
  withdrawalAmount: string | null,
  depositAmount: string | null,
  direction: "deposit" | "withdrawal" | null,
  classification: Classification,
  flags: LineFlag[]
): string {
  if (!narration) return "Transaction — review required";
  const result = generateBusinessDescription({
    narration,
    reference,
    withdrawalAmount,
    depositAmount,
    direction,
    classification,
    flags,
  });
  return result.description;
}