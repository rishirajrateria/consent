/* How an owner sees a consent request fee: the full fee the requester paid,
   the owner's share on a yes, and what went back to the requester otherwise.
   Every number comes from the stored rows; the percentages from escrow. */

import { OWNER_SHARE, REFUND_SHARE, splitConsentFee } from "@/lib/escrow";

type Num = { toString(): string };

const pct = (share: number) => `${Math.round(share * 100)}%`;
/** "80%": the owner's share on a yes. */
export const OWNER_PCT = pct(OWNER_SHARE);
/** "80%": the share refunded to the requester without a yes. */
export const REFUND_PCT = pct(REFUND_SHARE);
/** "20%": what Consent keeps either way. */
export const CONSENT_PCT = pct(1 - OWNER_SHARE);

/** A part of the fee as a percentage of it, e.g. "80%" (older rows may show "100%"). */
export function shareOf(part: number, gross: number) {
  return gross > 0 ? `${Math.round((part / gross) * 100)}%` : OWNER_PCT;
}

/** The full consent request fee paid. Very old rows have no grossAmount. */
export function grossOf(entry: { amount: Num; grossAmount: Num | null; payment?: { amount: Num } | null }) {
  if (entry.grossAmount != null) return Number(entry.grossAmount.toString());
  if (entry.payment) return Number(entry.payment.amount.toString());
  return Number(entry.amount.toString()) / OWNER_SHARE;
}

/** What actually went back to the requester for a refunded fee. */
export function refundedOf(entry: { amount: Num; grossAmount: Num | null; payment: { amount: Num; refundedAmount: Num | null } }) {
  const r = entry.payment.refundedAmount;
  return r != null ? Number(r.toString()) : splitConsentFee(grossOf(entry)).refund;
}

const DAY = 86400_000;

/** Payouts go out weekly on Fridays: the first Friday at least a week after the last payout. */
export function nextPayoutDay(last: Date | undefined) {
  const day = new Date(Math.max(Date.now(), last ? last.getTime() + 7 * DAY : 0));
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + ((5 - day.getDay() + 7) % 7));
  return day;
}

/** "Fri 16 Oct" */
export function fmtPayoutDay(d: Date) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
