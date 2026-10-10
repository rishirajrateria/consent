/* What Consent actually keeps from what people paid. A consent request fee
   is 80% the profile's once they say yes (held, pending or paid out) and 80%
   refunded without a yes, so only 20% of it is Consent's either way; the
   platform fee and the membership are Consent's in full. Older rows still
   add up: settled earnings from before the split hold the full fee, and
   older refunds have refundedAmount set to the full fee, so each counts 0.
   Money in different currencies is never added together: totals are per
   currency. */

import { db } from "@/lib/db";

type Num = { toString(): string } | null | undefined;

const n = (v: Num) => (v == null ? 0 : Number(v.toString()));

export function consentKeeps(
  payments: { amount: Num; refundedAmount: Num },
  ownersShare: { amount: Num },
) {
  return Math.max(0, n(payments.amount) - n(payments.refundedAmount) - n(ownersShare.amount));
}

/** Consent's revenue in one currency. */
export type Revenue = { currency: string; amount: number };

/**
 * consentKeeps per currency, from grouped sums: what was paid (less refunds)
 * and the profiles' share, each grouped by currency. Largest first.
 */
export function consentKeepsByCurrency(
  paid: { currency: string; _sum: { amount: Num; refundedAmount: Num } }[],
  owners: { currency: string; _sum: { amount: Num } }[],
): Revenue[] {
  const share = new Map(owners.map((o) => [o.currency, o._sum]));
  return paid
    .map((p) => ({ currency: p.currency, amount: consentKeeps(p._sum, share.get(p.currency) ?? { amount: 0 }) }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
}

/** Consent's revenue per currency: all time, or for payments made in the last `days` days. */
export async function revenueByCurrency(opts: { days?: number } = {}): Promise<Revenue[]> {
  const paidAt = opts.days ? { gte: new Date(Date.now() - opts.days * 86400_000) } : undefined;
  const [paid, owners] = await Promise.all([
    db.payment.groupBy({
      by: ["currency"],
      _sum: { amount: true, refundedAmount: true },
      where: { status: { in: ["PAID", "FORFEITED", "REFUNDED"] }, ...(paidAt ? { paidAt } : {}) },
    }),
    db.earningEntry.groupBy({
      by: ["currency"],
      _sum: { amount: true },
      where: { status: { in: ["HELD", "PENDING", "SETTLED"] }, ...(paidAt ? { payment: { paidAt } } : {}) },
    }),
  ]);
  return consentKeepsByCurrency(paid, owners);
}

/** "₹1,240 · $12": whole amounts per currency, for stat tiles. "—" when nothing yet. */
export function fmtRevenue(rows: Revenue[]): string {
  if (rows.length === 0) return "—";
  return rows
    .map((r) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: r.currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(r.amount),
    )
    .join(" · ");
}
