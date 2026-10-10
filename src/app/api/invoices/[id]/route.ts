import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { newDoc, pdfToBuffer, heading, sub, sectionTitle, kv, para } from "@/lib/pdf";
import { fmtDateTime } from "@/lib/utils";
import { OWNER_SHARE, REFUND_SHARE } from "@/lib/escrow";
import { PLATFORM_PCT } from "@/lib/platform-fee";
import { payerRole } from "@/lib/payments";
import { paymentParts } from "@/app/(app)/pay/lines";

const pct = (share: number) => `${Math.round(share * 100)}%`;
const money = (currency: string, n: number) => `${currency} ${n.toFixed(2)}`;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payment = await db.payment.findUnique({
    where: { id },
    include: { requester: true, request: { select: { number: true, consenter: { select: { displayName: true } } } } },
  });
  // A refunded consent request fee still has an invoice: Consent kept part of it.
  // So does a forfeited platform fee (request expired unanswered): it was paid and isn't refunded.
  if (!payment || !["PAID", "REFUNDED", "FORFEITED"].includes(payment.status) || !payment.invoiceNumber)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isAdmin = !!session.user.adminRole;
  if (!isAdmin && !(await payerRole(payment.requester, session.userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parts = paymentParts(payment);
  const doc = newDoc(`Invoice ${payment.invoiceNumber}`);
  heading(doc, "Invoice");
  sub(doc, `consent. — ${parts.label.toLowerCase()} invoice`);
  sectionTitle(doc, "Details");
  kv(doc, "Invoice number", payment.invoiceNumber);
  kv(doc, "Date", fmtDateTime(payment.paidAt ?? payment.createdAt));
  kv(doc, "Billed to", `${payment.requester.legalName} (${payment.requester.displayName})`);
  kv(doc, "Country", payment.requester.country);
  if (payment.request) kv(doc, "For", `Request #${payment.request.number} to ${payment.request.consenter.displayName}`);
  sectionTitle(doc, "Line items");
  kv(doc, payment.purpose === "MEMBERSHIP" ? "Membership (1 year)" : parts.label, money(payment.currency, parts.fee));
  if (parts.discount) kv(doc, `Coupon ${payment.couponCode ?? ""}`.trim(), `– ${money(payment.currency, parts.discount)}`);
  if (parts.tax) kv(doc, parts.taxLabel ?? "Tax", money(payment.currency, parts.tax));
  kv(doc, "Total paid", money(payment.currency, parts.total));
  if (payment.status === "REFUNDED") {
    // Older refunds returned the whole amount; newer ones the asker's 80%.
    const back = Number((payment.refundedAmount ?? payment.amount).toString());
    const when = payment.refundedAt ? ` · ${fmtDateTime(payment.refundedAt)}` : "";
    kv(doc, `Refunded to you (${parts.total > 0 ? pct(back / parts.total) : pct(REFUND_SHARE)})`, `– ${money(payment.currency, back)}${when}`);
    kv(doc, "Kept by Consent", money(payment.currency, parts.total - back));
  }
  sectionTitle(doc, "Notes");
  para(
    doc,
    payment.purpose === "MEMBERSHIP"
      ? "The yearly membership lets a profile send requests for one year. Receiving requests never needs it."
      : `A consent request fee is held until the person asked answers: if they say yes, ${pct(OWNER_SHARE)} goes to them; if not, ${pct(REFUND_SHARE)} is refunded to you. Consent keeps ${pct(1 - OWNER_SHARE)} either way. The platform fee is ${PLATFORM_PCT} of the consent request fee, paid on top of it, and isn't refunded in any outcome. Tax applies to the platform fee only.`
  );
  const buf = await pdfToBuffer(doc);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${payment.invoiceNumber}.pdf"`,
    },
  });
}
