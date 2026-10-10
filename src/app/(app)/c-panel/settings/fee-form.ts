/* The consent request fee part of "Profile, fee & limits", as the form sends
   it: the fee (Free, or a fee of at least the currency's minimum), its
   currency, and a fee per kind of consent (the profile's fee, Free, or a fee
   of at least the minimum). Pure, so it can be unit-tested; imports are
   relative for the same reason. */

import { consentFeeProblem, parseConsentFee, type CurrencyRule } from "../../../../lib/currency-rules";
import { fmtMoney } from "../../../../lib/utils";

/** A fee choice: Free, or a fee of some amount. Per kind of consent, also "the profile's fee". */
export type FeeMode = "free" | "paid";
export type TierMode = "base" | FeeMode;

export type FeeForm = {
  /** null = free to ask. */
  consentPrice: number | null;
  currency: string;
  /** Per intent: null = use the profile's fee (no tier), 0 = free, else the fee. */
  tiers: Map<string, number | null>;
};

const MONEY_FORMAT = /^\d+(\.\d{1,2})?$/;

/**
 * Why one fee can't be saved, or null. `what` names it in the message, e.g.
 * "your consent request fee" or "News".
 */
function paidFeeProblem(raw: string, currency: CurrencyRule, what: string): string | null {
  if (raw === "" || (MONEY_FORMAT.test(raw) && Number(raw) === 0)) return `Enter ${what}, or choose Free.`;
  const problem = consentFeeProblem(raw, currency);
  if (!problem) return null;
  // Below the minimum: say so in this form's words (it has a Free choice, not an empty box).
  if (MONEY_FORMAT.test(raw)) {
    return `${what.charAt(0).toUpperCase()}${what.slice(1)} must be at least ${fmtMoney(currency.minConsentFee, currency.code)}, or choose Free.`;
  }
  return problem;
}

/**
 * Reads and checks the fee fields. Returns what to save, or the first
 * problem in plain words (nothing is saved then).
 */
export function readFeeForm(
  fd: FormData,
  currencies: CurrencyRule[],
  intents: { id: string; name: string }[],
): { ok: true; fee: FeeForm } | { ok: false; error: string } {
  const code = String(fd.get("consentPriceCurrency") ?? "").trim().toUpperCase();
  const currency = currencies.find((c) => c.code === code);
  if (!currency) return { ok: false, error: "Choose a currency we support for your consent request fee." };

  const mode = String(fd.get("feeMode") ?? "");
  if (mode !== "free" && mode !== "paid") return { ok: false, error: "Choose Free or a fee for your consent request fee." };
  let consentPrice: number | null = null;
  if (mode === "paid") {
    const raw = String(fd.get("consentPrice") ?? "").trim();
    const problem = paidFeeProblem(raw, currency, "your consent request fee");
    if (problem) return { ok: false, error: problem };
    consentPrice = parseConsentFee(raw);
  }

  const tiers = new Map<string, number | null>();
  for (const intent of intents) {
    const tierMode = String(fd.get(`tierMode_${intent.id}`) ?? "base");
    if (tierMode === "free") {
      tiers.set(intent.id, 0);
    } else if (tierMode === "paid") {
      const raw = String(fd.get(`tier_${intent.id}`) ?? "").trim();
      const problem = paidFeeProblem(raw, currency, `the fee for ${intent.name}`);
      if (problem) return { ok: false, error: problem };
      tiers.set(intent.id, parseConsentFee(raw));
    } else {
      tiers.set(intent.id, null);
    }
  }
  return { ok: true, fee: { consentPrice, currency: currency.code, tiers } };
}

/** How a stored tier shows in the form: the profile's fee, Free, or a fee. */
export function tierMode(amount: { toString(): string } | null | undefined): TierMode {
  if (amount == null) return "base";
  return Number(amount.toString()) > 0 ? "paid" : "free";
}

/** "At least ₹100.00": the smallest paid fee in a currency, for hints. */
export function atLeast(c: Pick<CurrencyRule, "code" | "minConsentFee">): string {
  return `At least ${fmtMoney(c.minConsentFee, c.code)}`;
}
