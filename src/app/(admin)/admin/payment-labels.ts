/* How admin pages name a payment and describe a refund. Shared by
   admin/payments and the profile pages that list payments. */

import type { PaymentPurpose, Prisma } from "@prisma/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { PAYMENT_LABEL } from "@/app/(app)/pay/lines";

type Decimal = Prisma.Decimal;

/** "Membership", "Platform fee (20%)", "Consent request fee": the same names people see. */
export const PURPOSE: Record<PaymentPurpose, string> = PAYMENT_LABEL;

/** "Refunded $80.00 (80%) · Oct 10, 2026, 9:00 AM": the part actually returned (older refunds returned it all). */
export function refundLine(p: { amount: Decimal; refundedAmount: Decimal | null; refundedAt: Date | null; currency: string }) {
  const paid = Number(p.amount.toString());
  const back = Number((p.refundedAmount ?? p.amount).toString());
  const share = paid > 0 ? ` (${Math.round((back / paid) * 100)}%)` : "";
  return `Refunded ${fmtMoney(back, p.currency)}${share}${p.refundedAt ? ` · ${fmtDateTime(p.refundedAt)}` : ""}`;
}
