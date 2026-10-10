/* How admin pages name a payment and describe a refund. Shared by
   admin/payments and the requester detail page. */

import type { PaymentPurpose, Prisma } from "@prisma/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";

type Decimal = Prisma.Decimal;

export const PURPOSE: Record<PaymentPurpose, string> = {
  ONBOARDING: "Onboarding",
  SUBSCRIPTION: "Subscription",
  PER_REQUEST: "Platform fee",
  CONSENT_PRICE: "Consent request fee",
};

/** "Refunded $80.00 (80%) · Oct 10, 2026, 9:00 AM": the part actually returned (older refunds returned it all). */
export function refundLine(p: { amount: Decimal; refundedAmount: Decimal | null; refundedAt: Date | null; currency: string }) {
  const paid = Number(p.amount.toString());
  const back = Number((p.refundedAmount ?? p.amount).toString());
  const share = paid > 0 ? ` (${Math.round((back / paid) * 100)}%)` : "";
  return `Refunded ${fmtMoney(back, p.currency)}${share}${p.refundedAt ? ` · ${fmtDateTime(p.refundedAt)}` : ""}`;
}
