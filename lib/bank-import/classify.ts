import type { Classification, Direction, LineFlag } from "./types";

export interface ClassificationResult {
  classification: Classification;
  flags: LineFlag[];
}

type Rule = {
  pattern: RegExp;
  classification: Classification;
  flags: LineFlag[];
};

/**
 * Rules only flag uncertainty. They never promote a line to importable income
 * or expense. Ordinary deposits/withdrawals still require a reviewer to choose
 * an existing client or category.
 */
const RULES: Rule[] = [
  {
    pattern: /\b(?:reversal|reversed|chargeback|bounce|bounced|dishonou?r(?:ed)?)\b/i,
    classification: "reversal",
    flags: ["REVERSAL"],
  },
  {
    pattern: /\b(?:refund|refunded|money\s+back)\b/i,
    classification: "refund",
    flags: ["REFUND"],
  },
  {
    pattern:
      /\b(?:self[\s-]?transfer|own\s+account|inter[\s-]?account|internal\s+transfer|transfer(?:red)?\s+(?:to|from)|to\s+a\/c|from\s+a\/c)\b/i,
    classification: "transfer",
    flags: ["TRANSFER"],
  },
  {
    pattern: /\b(?:cash\s+deposit|cash\s+withdrawal|atm\s+withdrawal|cash)\b/i,
    classification: "other",
    flags: ["CASH_MOVEMENT", "AMBIGUOUS_ENTRY"],
  },
  {
    pattern:
      /\b(?:bank\s+charges?|service\s+charges?|annual\s+fee|sms\s+charges?|gst\s+on\s+charges?|interest\s+(?:paid|debit))\b/i,
    classification: "other",
    flags: ["BANK_CHARGE"],
  },
  {
    pattern: /\b(?:adjustment|suspense|misc(?:ellaneous)?|unknown|unidentified|failed|pending|hold)\b/i,
    classification: "other",
    flags: ["AMBIGUOUS_ENTRY"],
  },
];

export function classifyLine(
  direction: Direction | null,
  narration: string | null,
): ClassificationResult {
  const text = narration?.trim() ?? "";

  if (text) {
    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        return { classification: rule.classification, flags: [...rule.flags] };
      }
    }
  }

  if (direction === "deposit") return { classification: "income", flags: [] };
  if (direction === "withdrawal") return { classification: "expense", flags: [] };
  return { classification: "unclassified", flags: [] };
}
