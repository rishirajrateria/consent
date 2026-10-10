/* The currencies a consent request fee can be set in, with the smallest paid
   fee in each (about ₹100). Admins edit them at /admin/pricing; until they
   save one, the defaults in currency-rules.ts apply. A fee can always be
   free. Server only (reads the database); the rules themselves are pure, in
   currency-rules.ts. */

import { db } from "./db";
import { DEFAULT_CURRENCIES, type CurrencyRule } from "./currency-rules";
import { fmtMoney } from "./utils";

export type { CurrencyRule };

/** An admin's view of a currency: the rule plus whether it can be chosen. */
export type CurrencyRow = CurrencyRule & { active: boolean };

const toRule = (r: { code: string; name: string; minConsentFee: { toString(): string }; sortOrder: number }): CurrencyRule => ({
  code: r.code,
  name: r.name,
  minConsentFee: Number(r.minConsentFee.toString()),
  sortOrder: r.sortOrder,
});

const byOrder = (a: CurrencyRule, b: CurrencyRule) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);

/**
 * Every currency, active or not, for the admin table. The defaults (all
 * active) while nothing has been saved yet.
 */
export async function allCurrencies(): Promise<CurrencyRow[]> {
  const rows = await db.currency.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  if (rows.length === 0) return DEFAULT_CURRENCIES.map((c) => ({ ...c, active: true })).sort(byOrder);
  return rows.map((r) => ({ ...toRule(r), active: r.active }));
}

/**
 * The currencies people can set a consent request fee in, in display order:
 * the active Currency rows, or the defaults while none are saved.
 */
export async function activeCurrencies(): Promise<CurrencyRule[]> {
  const rows = await db.currency.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  if (rows.length === 0) return [...DEFAULT_CURRENCIES].sort(byOrder);
  return rows.filter((r) => r.active).map(toRule);
}

/** One currency's rule, if people can choose it now. */
export async function currencyRule(code: string | null | undefined): Promise<CurrencyRule | null> {
  if (!code) return null;
  const list = await activeCurrencies();
  return list.find((c) => c.code === code.toUpperCase()) ?? null;
}

/** "At least ₹100.00": the smallest paid fee in a currency, for hints. */
export function minimumText(c: Pick<CurrencyRule, "code" | "minConsentFee">): string {
  return `At least ${fmtMoney(c.minConsentFee, c.code)}`;
}

/** "₹1,000" for whole amounts, "₹1,000.50" otherwise. For prices in copy. */
export function fmtPrice(amount: number | { toString(): string }, currency: string): string {
  const n = Number(amount.toString());
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
