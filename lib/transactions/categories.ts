/** Expense categories, seeded by migration 0007. The bot and the form choose from this list. */
export const CATEGORIES = [
  "Rent",
  "Salaries",
  "Software & subscriptions",
  "Cloud & hosting",
  "Office supplies",
  "Marketing",
  "Travel",
  "Utilities",
  "Food & refreshments",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Case-insensitive match to a known category, else null. */
export function toCategory(value: unknown): Category | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return CATEGORIES.find((c) => c.toLowerCase() === v) ?? null;
}
