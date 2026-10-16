/**
 * Deterministic intent checks for short chat replies (no Gemini).
 * English + common Hinglish. Exact-phrase matches only, so "no, make it 500" stays a correction.
 */

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .replace(/(\w)\1{2,}/g, "$1$1"); // "hiiii" -> "hii", "heyyyy" -> "heyy"
}

const GREETINGS = [
  /^h+i+$/, /^he+y+$/, /^hel+o+$/, /^hey there$/, /^hello there$/, /^hi there$/,
  /^good (morning|afternoon|evening|day|night)$/, /^how are you( doing)?$/, /^chat$/, /^howdy$/,
  /^greetings$/, /^whats up$/, /^sup$/, /^hola$/, /^namaste$/, /^namaskar$/,
  /^thanks?$/, /^thank you( so much)?$/, /^thanks a lot$/, /^thx$/, /^ty$/, /^shukriya$/, /^dhanyavad$/,
];

/** Only a greeting or thanks, nothing actionable ("Hello, change the amount" is not). */
export function isCasualGreeting(text: string): boolean {
  const n = normalize(text);
  return GREETINGS.some((p) => p.test(n));
}

const HELP = /^(help|what can you do|what do you do|how does this work|how (do|can) i use (this|you)|kya kar sakte ho|madad)$/;

export function isHelpRequest(text: string): boolean {
  return HELP.test(normalize(text));
}

const CANCEL = /^(no|nope|nah|cancel|cancel it|discard|discard it|drop it|never ?mind|nahi|nahin|na|mat karo|rehne do|chhodo|cancel karo|cancel kar do)$/;

export function isCancel(text: string): boolean {
  return CANCEL.test(normalize(text));
}

// Saving is irreversible-ish, so keep this list tight; the card's Confirm button is the main path.
const CONFIRM = /^(confirm|confirm it|yes|yes please|yep|yeah|save|save it|haan|haan save karo|ha|ji haan)$/;

export function isConfirm(text: string): boolean {
  return CONFIRM.test(normalize(text));
}

const START = /^(i (want|would like|need) to |i'?d like to |let'?s |please )?(add|record|log|enter|new)( a| an| new| one)? (expense|income)( please)?$|^(new|naya|nayi|ek) (expense|income)( add karna hai| add karo| daalna hai)?$|^(expense|income) (add karna hai|add karo|daalna hai|record karna hai)$/;

/** "I want to add an expense" (the quick buttons) starts a fresh entry of that type. */
export function startIntent(text: string): "expense" | "income" | null {
  const m = normalize(text).match(START);
  if (!m) return null;
  return m[0].includes("income") ? "income" : "expense";
}

export const HELP_TEXT =
  "I record income and expenses. Try “Paid ₹5,000 for office rent today” or “Acme paid $500 for design work yesterday”. You can also ask “How much did we spend this month?”";
