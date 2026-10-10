/* Which currencies a consent request fee can be set in, and the smallest
   paid fee in each: about ₹100. A fee can always be free (no fee); a paid
   fee is at least the minimum. The live list and minimums are in the
   Currency table (admin-editable); this list seeds it and is the fallback.
   All have two decimal places. Pure: safe to import anywhere. */

export type CurrencyRule = { code: string; name: string; minConsentFee: number; sortOrder: number };

export const DEFAULT_CURRENCIES: CurrencyRule[] = [
  { code: "INR", name: "Indian rupee", minConsentFee: 100, sortOrder: 0 },
  { code: "USD", name: "US dollar", minConsentFee: 1.2, sortOrder: 1 },
  { code: "EUR", name: "Euro", minConsentFee: 1.1, sortOrder: 2 },
  { code: "GBP", name: "British pound", minConsentFee: 0.95, sortOrder: 3 },
  { code: "AED", name: "UAE dirham", minConsentFee: 4.4, sortOrder: 4 },
  { code: "SGD", name: "Singapore dollar", minConsentFee: 1.55, sortOrder: 5 },
  { code: "CAD", name: "Canadian dollar", minConsentFee: 1.65, sortOrder: 6 },
  { code: "AUD", name: "Australian dollar", minConsentFee: 1.8, sortOrder: 7 },
];

/** The default currency for a country (ISO 3166 code). */
export function currencyForCountry(country: string | null | undefined): string {
  switch ((country ?? "").toUpperCase()) {
    case "US":
      return "USD";
    case "GB":
      return "GBP";
    case "AE":
      return "AED";
    case "SG":
      return "SGD";
    case "CA":
      return "CAD";
    case "AU":
      return "AUD";
    case "DE":
    case "FR":
    case "ES":
    case "IT":
    case "NL":
    case "IE":
    case "PT":
    case "BE":
    case "AT":
    case "FI":
      return "EUR";
    default:
      return "INR";
  }
}

/**
 * Why a consent request fee can't be saved, or null when it can. Empty or 0
 * means free. Otherwise it must be a number with at most two decimals and at
 * least the currency's minimum.
 */
export function consentFeeProblem(
  raw: string | number | null | undefined,
  currency: { code: string; minConsentFee: number | { toString(): string } } | null | undefined,
): string | null {
  const text = raw == null ? "" : String(raw).trim();
  if (text === "" || Number(text) === 0) return null;
  if (!currency) return "Choose a currency we support.";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "Enter the fee as a number, like 100 or 149.50.";
  const min = Number(currency.minConsentFee.toString());
  if (Number(text) < min) return `A paid fee is at least ${currency.code} ${min.toFixed(2)}. Or leave it empty to make asking free.`;
  return null;
}

/** The stored fee: null for free, else the amount. Call after consentFeeProblem passed. */
export function parseConsentFee(raw: string | number | null | undefined): number | null {
  const text = raw == null ? "" : String(raw).trim();
  if (text === "" || Number(text) === 0) return null;
  return Math.round(Number(text) * 100) / 100;
}
