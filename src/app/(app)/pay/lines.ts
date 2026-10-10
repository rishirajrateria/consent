/* How a payment reads to the person who paid: its name, and the parts of
   its amount (the fee, a coupon, tax). Used by checkout, the payments list
   and invoices so they always agree. Pure: no database (relative imports
   so unit tests can load it). */

import type { PaymentPurpose } from "@prisma/client";
import { PLATFORM_PCT } from "../../../lib/platform-fee";
import { fmtMoney } from "../../../lib/utils";

type Num = { toString(): string };

/** What each kind of payment is called everywhere people see it. */
export const PAYMENT_LABEL: Record<PaymentPurpose, string> = {
  MEMBERSHIP: "Membership",
  PER_REQUEST: `Platform fee (${PLATFORM_PCT})`,
  CONSENT_PRICE: "Consent request fee",
};

export type PaymentLine = {
  id: string;
  purpose: PaymentPurpose;
  amount: Num;
  currency: string;
  discount: Num | null;
  couponCode: string | null;
  tax: Num | null;
  taxLabel: string | null;
};

const num = (v: Num | null | undefined) => (v == null ? 0 : Number(v.toString()));
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The parts of one payment. Its stored amount is what was charged: the fee,
 * less any coupon, plus tax. So the fee itself is amount - tax + discount.
 */
export function paymentParts(p: PaymentLine) {
  const total = num(p.amount);
  const tax = num(p.tax);
  const discount = num(p.discount);
  return {
    label: PAYMENT_LABEL[p.purpose],
    fee: cents(total - tax + discount),
    discount,
    couponCode: p.couponCode,
    tax,
    taxLabel: tax ? (p.taxLabel ?? "Tax") : null,
    total,
    currency: p.currency,
  };
}

export type CheckoutRow = { key: string; label: string; amount: number; currency: string; minus?: boolean };

const ORDER: Record<PaymentPurpose, number> = { CONSENT_PRICE: 0, PER_REQUEST: 1, MEMBERSHIP: 2 };

/**
 * The rows a checkout shows, in order: "Consent request fee", "Platform fee
 * (20%)", any coupon, then tax; or "Membership (1 year)", coupon, tax.
 */
export function checkoutRows(lines: PaymentLine[]): CheckoutRow[] {
  const rows: CheckoutRow[] = [];
  for (const l of [...lines].sort((a, b) => ORDER[a.purpose] - ORDER[b.purpose])) {
    const p = paymentParts(l);
    rows.push({
      key: l.id,
      label: l.purpose === "MEMBERSHIP" ? "Membership (1 year)" : p.label,
      amount: p.fee,
      currency: p.currency,
    });
    if (p.discount) {
      rows.push({
        key: `${l.id}:coupon`,
        label: p.couponCode ? `Coupon ${p.couponCode}` : "Coupon",
        amount: p.discount,
        currency: p.currency,
        minus: true,
      });
    }
    if (p.tax) rows.push({ key: `${l.id}:tax`, label: p.taxLabel ?? "Tax", amount: p.tax, currency: p.currency });
  }
  return rows;
}

/** The total of a checkout, per currency: "₹120.00" (older checkouts could mix: "₹100.00 + $9.00"). */
export function checkoutTotal(lines: Pick<PaymentLine, "amount" | "currency">[]): string {
  const by = new Map<string, number>();
  for (const l of lines) by.set(l.currency, cents((by.get(l.currency) ?? 0) + num(l.amount)));
  return [...by.entries()].map(([cur, amt]) => fmtMoney(amt, cur)).join(" + ");
}
