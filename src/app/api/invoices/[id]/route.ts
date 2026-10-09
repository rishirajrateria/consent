import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { newDoc, pdfToBuffer, heading, sub, sectionTitle, kv, para } from "@/lib/pdf";
import { titleCase, fmtDateTime } from "@/lib/utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payment = await db.payment.findUnique({ where: { id }, include: { requester: true } });
  if (!payment || payment.status !== "PAID" || !payment.invoiceNumber)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const member = await db.requesterMember.findUnique({
    where: { requesterId_userId: { requesterId: payment.requesterId, userId: session.userId } },
  });
  const isAdmin = !!session.user.adminRole;
  if (!member && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const doc = newDoc(`Invoice ${payment.invoiceNumber}`);
  heading(doc, "Invoice");
  sub(doc, `consent. — platform fees invoice`);
  sectionTitle(doc, "Details");
  kv(doc, "Invoice number", payment.invoiceNumber);
  kv(doc, "Date", fmtDateTime(payment.paidAt!));
  kv(doc, "Billed to", `${payment.requester.legalName} (${payment.requester.displayName})`);
  kv(doc, "Country", payment.requester.country);
  sectionTitle(doc, "Line items");
  kv(doc, titleCase(payment.purpose) + " fee", `${payment.currency} ${payment.amount.toString()}`);
  if (payment.discount) kv(doc, `Coupon ${payment.couponCode ?? ""}`, `− ${payment.currency} ${payment.discount.toString()}`);
  if (payment.tax) kv(doc, payment.taxLabel ?? "Tax", `${payment.currency} ${payment.tax.toString()} (included)`);
  kv(doc, "Total paid", `${payment.currency} ${payment.amount.toString()}`);
  sectionTitle(doc, "Notes");
  para(
    doc,
    "Consent collects platform fees from requesters only. Consent is not a payment intermediary between consenters and requesters. Per-request fees are non-refundable in any outcome."
  );
  const buf = await pdfToBuffer(doc);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${payment.invoiceNumber}.pdf"`,
    },
  });
}
