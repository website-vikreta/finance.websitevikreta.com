/**
 * Finance Chat Bot — answer questions about recorded money ("How much did we spend this month?").
 *
 * Gemini only turns the question into a date range, a metric and an optional search term.
 * Every number in the reply comes from the database (rangeSummary), never from the model.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { getModelHierarchy } from "./extract";
import { formatINR } from "@/lib/format";
import { rangeSummary, type RangeSummary } from "@/lib/transactions/queries";

export interface ParsedQuestion {
  metric: "income" | "expense" | "net";
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  label: string; // "in October 2026", "this financial year"
  search: string | null;
}

const QUESTION_WORDS =
  /\b(how much|how many|what (is|was|were|are)|total|show( me)?|list|who paid|which client|did we (spend|earn|receive|get)|kitna|kitne|kitni|kya hai|batao|summary|net|profit)\b/i;

/** Cheap gate so ordinary entries ("Paid ₹500 for rent") never pay for a second Gemini call. */
export function looksLikeQuestion(message: string): boolean {
  return message.trim().endsWith("?") || QUESTION_WORDS.test(message);
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_question: { type: Type.BOOLEAN, description: "true only if the manager is asking about money already recorded, not recording a new transaction." },
    metric: { type: Type.STRING, enum: ["income", "expense", "net"], description: "income = money in / received / earned, expense = spent / money out, net = profit or both." },
    from: { type: Type.STRING, description: "Start date YYYY-MM-DD (inclusive)." },
    to: { type: Type.STRING, description: "End date YYYY-MM-DD (inclusive)." },
    label: { type: Type.STRING, description: "Short human phrase for the range, e.g. 'this month', 'in September 2026', 'this financial year', 'all time'." },
    search: { type: Type.STRING, nullable: true, description: "A client name or expense keyword the question narrows to (e.g. 'Acme', 'rent'). null if none." },
  },
  required: ["is_question", "metric", "from", "to", "label", "search"],
};

function prompt(today: string): string {
  return `You turn a finance manager's question into a query. Today is ${today} (India).
The Indian financial year runs 1 April to 31 March.
Resolve relative ranges: "this month" = first of this month to today; "last month" = the whole previous month;
"this year"/"this FY" = current financial year start to today; "today", "yesterday", "this week" (Monday to today), "last 7 days".
No range mentioned → this month. "ever"/"all time"/"so far" → 1900-01-01 to today.
English and Hinglish ("kitna kharcha hua", "kitne paise aaye") are both common.
If the message records a new transaction instead of asking ("Paid ₹500 for rent"), set is_question to false.`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "October 2026" reads wrong after "You spent ₹X"; add "in" unless the phrase already leads with one. */
export function readableLabel(label: unknown): string {
  const l = String(label ?? "").trim();
  if (!l) return "in that period";
  return /^(this|last|in|on|today|yesterday|since|all|so|over|during|from|between|past)\b/i.test(l) ? l : `in ${l}`;
}

/** Returns null when Gemini says it is not a question or is unreachable; the caller falls back to recording. */
export async function parseQuestion(message: string, today: string): Promise<ParsedQuestion | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey });

  for (const model of getModelHierarchy()) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: message,
        config: { systemInstruction: prompt(today), responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0, httpOptions: { timeout: 10_000 } },
      });
      const q = JSON.parse(res.text ?? "null");
      if (!q?.is_question) return null;
      if (!DATE.test(q.from) || !DATE.test(q.to) || !["income", "expense", "net"].includes(q.metric)) return null;
      const to = q.to > today ? today : q.to;
      return { metric: q.metric, from: q.from <= to ? q.from : to, to, label: readableLabel(q.label), search: q.search?.trim() || null };
    } catch (err) {
      console.warn(`[Chatbot Ask] Model "${model}" failed: ${String((err as Error)?.message ?? err).slice(0, 150)}`);
    }
  }
  return null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Pure: builds the reply from database totals. Exported for tests. */
export function formatAnswer(q: ParsedQuestion, s: RangeSummary): string {
  const scope = q.search ? ` for “${q.search}”` : "";
  const top = (type: "income" | "expense") =>
    s.top
      .filter((t) => t.type === type)
      .slice(0, 3)
      .map((t) => `${t.name} ${formatINR(t.amount)}`)
      .join(", ");

  if (q.metric === "net") {
    if (!s.incomeCount && !s.expenseCount) return `Nothing recorded${scope} ${q.label}.`;
    const net = s.income - s.expense;
    return `${q.label[0].toUpperCase()}${q.label.slice(1)}${scope}: money in ${formatINR(s.income)}, money out ${formatINR(s.expense)}, net ${net < 0 ? "-" : ""}${formatINR(Math.abs(net))}.`;
  }

  const total = s[q.metric];
  const count = q.metric === "income" ? s.incomeCount : s.expenseCount;
  if (!count) return `No ${q.metric === "income" ? "income" : "expenses"} recorded${scope} ${q.label}.`;
  const verb = q.metric === "income" ? "You received" : "You spent";
  const groups = s.top.filter((t) => t.type === q.metric).length;
  const biggest = groups > 1 ? ` Biggest: ${top(q.metric)}.` : "";
  return `${verb} ${formatINR(total)}${scope} ${q.label}, across ${plural(count, "transaction")}.${biggest}`;
}

export async function answerQuestion(q: ParsedQuestion): Promise<string> {
  return formatAnswer(q, await rangeSummary(q.from, q.to, q.search));
}
