import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { newDoc, pdfToBuffer, heading, sub, sectionTitle, kv, para } from "@/lib/pdf";
import { fmtDateTime } from "@/lib/utils";
import { OWNER_SHARE, REFUND_SHARE } from "@/lib/escrow";
import type { PaymentPurpose } from "@prisma/client";

const LINE: Record<PaymentPurpose, string> = {
  ONBOARDING: "Onboarding fee",
  SUBSCRIPTION: "Subscription fee",
  PER_REQUEST: "Platform fee",
  CONSENT_PRICE: "Consent request fee",
};
const pct = (share: number) => `${Math.round(share * 100)}%`;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payment = await db.payment.findUnique({ where: { id }, include: { requester: true } });
  // A refunded consent request fee still has an invoice: Consent kept part of it.
  // So does a forfeited platform fee (request expired unanswered): it was paid and isn't refunded.
  if (!payment || !["PAID", "REFUNDED", "FORFEITED"].includes(payment.status) || !payment.invoiceNumber)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const member = await db.requesterMember.findUnique({
    where: { requesterId_userId: { requesterId: payment.requesterId, userId: session.userId } },
  });
  const isAdmin = !!session.user.adminRole;
  if (!member && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const doc = newDoc(`Invoice ${payment.invoiceNumber}`);
  heading(doc, "Invoice");
  sub(doc, `consent. — ${payment.purpose === "CONSENT_PRICE" ? "consent request fee" : "platform fees"} invoice`);
  sectionTitle(doc, "Details");
  kv(doc, "Invoice number", payment.invoiceNumber);
  kv(doc, "Date", fmtDateTime(payment.paidAt!));
  kv(doc, "Billed to", `${payment.requester.legalName} (${payment.requester.displayName})`);
  kv(doc, "Country", payment.requester.country);
  sectionTitle(doc, "Line items");
  kv(doc, LINE[payment.purpose], `${payment.currency} ${payment.amount.toString()}`);
  if (payment.discount) kv(doc, `Coupon ${payment.couponCode ?? ""}`, `– ${payment.currency} ${payment.discount.toString()}`);
  if (payment.tax) kv(doc, payment.taxLabel ?? "Tax", `${payment.currency} ${payment.tax.toString()} (included)`);
  kv(doc, "Total paid", `${payment.currency} ${payment.amount.toString()}`);
  if (payment.status === "REFUNDED") {
    // Older refunds returned the whole amount; newer ones the requester's 80%.
    const paid = Number(payment.amount.toString());
    const back = Number((payment.refundedAmount ?? payment.amount).toString());
    const when = payment.refundedAt ? ` · ${fmtDateTime(payment.refundedAt)}` : "";
    kv(doc, `Refunded to you (${paid > 0 ? pct(back / paid) : pct(REFUND_SHARE)})`, `– ${payment.currency} ${back.toFixed(2)}${when}`);
    kv(doc, "Kept by Consent", `${payment.currency} ${(paid - back).toFixed(2)}`);
  }
  sectionTitle(doc, "Notes");
  para(
    doc,
    `Consent collects platform fees and consent request fees from requesters only. The platform fee isn't refunded in any outcome. A consent request fee is held until the owner answers: if they say yes, ${pct(OWNER_SHARE)} goes to them; if not, ${pct(REFUND_SHARE)} is refunded to the requester. Consent keeps ${pct(1 - OWNER_SHARE)} either way. Fees agreed between owners and requesters are paid directly between them, never through Consent.`
  );
  const buf = await pdfToBuffer(doc);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${payment.invoiceNumber}.pdf"`,
    },
  });
}
