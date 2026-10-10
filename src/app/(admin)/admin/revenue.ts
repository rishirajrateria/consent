/* What Consent actually keeps from what requesters paid. A consent request fee
   is 80% the owner's once they say yes (held, pending or paid out) and 80%
   refunded without a yes, so only 20% of it is Consent's either way; platform,
   onboarding and subscription fees are Consent's in full. Older rows still add
   up: settled earnings from before the split hold the full fee, and older
   refunds have refundedAmount set to the full fee, so each counts 0. */

type Num = { toString(): string } | null | undefined;

const n = (v: Num) => (v == null ? 0 : Number(v.toString()));

export function consentKeeps(
  payments: { amount: Num; refundedAmount: Num },
  ownersShare: { amount: Num },
) {
  return Math.max(0, n(payments.amount) - n(payments.refundedAmount) - n(ownersShare.amount));
}
