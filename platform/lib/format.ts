const EXPONENT: Record<string, number> = { USD: 2, JPY: 0 };

/** Format integer minor units as a currency string. */
export function formatMoney(minor: number, currencyCode: string = "USD"): string {
  const exponent = EXPONENT[currencyCode] ?? 2;
  const amount = minor / 10 ** exponent;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode || "USD" }).format(amount);
}

/** Parse a dollars-and-cents string into integer minor units; null when invalid. */
export function parseMoneyToMinor(input: string): number | null {
  const trimmed = input.trim().replace(/[$,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const minor = Math.round(parseFloat(trimmed) * 100);
  return Number.isFinite(minor) && minor >= 0 ? minor : null;
}
