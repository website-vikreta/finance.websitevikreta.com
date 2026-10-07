const formatters = {
  INR: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }),
  USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
};

/** Formats integer minor units (paise / cents) for display. */
export function formatMoney(minor: number, currency: keyof typeof formatters = "INR") {
  return formatters[currency].format(minor / 100);
}
