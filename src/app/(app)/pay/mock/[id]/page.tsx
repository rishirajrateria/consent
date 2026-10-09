import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, KV, PageHeader, Alert, Divider } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { settlePayment, pendingPaymentsForRequest } from "@/lib/payments";
import { audit } from "@/lib/audit";
import { fmtMoney, titleCase } from "@/lib/utils";
import { CreditCard } from "lucide-react";

export const metadata = { title: "Checkout" };

export default async function MockCheckout({
  params,
  searchParams,
}: PageProps<"/pay/mock/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireUser();
  const payment = await db.payment.findUnique({
    where: { id },
    include: { requester: true, request: { include: { consenter: true } } },
  });
  if (!payment) notFound();
  const member = await db.requesterMember.findUnique({
    where: { requesterId_userId: { requesterId: payment.requesterId, userId: session.userId } },
  });
  if (!member) notFound();
  const returnTo = typeof sp.return === "string" ? sp.return : "/r-panel";

  if (payment.status === "PAID") redirect(returnTo);

  // A submission checkout covers every pending payment on the request:
  // the platform fee plus the consenter's consent price, if set.
  const lines = payment.requestId ? await pendingPaymentsForRequest(payment.requestId) : [payment];
  const consentLine = lines.find((l) => l.purpose === "CONSENT_PRICE");

  async function confirmAction() {
    "use server";
    const s = await requireUser();
    const p = await db.payment.findUniqueOrThrow({ where: { id } });
    const m = await db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: p.requesterId, userId: s.userId } },
    });
    if (!m) redirect("/dashboard");
    const toSettle = p.requestId
      ? await db.payment.findMany({ where: { requestId: p.requestId, status: "PENDING" } })
      : [p];
    // Settle the consent price first so the earning exists when the
    // platform-fee settlement flips the request to Submitted.
    for (const row of toSettle.sort((a) => (a.purpose === "CONSENT_PRICE" ? -1 : 1))) {
      await settlePayment(row.id);
      await audit({
        actorId: s.userId,
        actorName: s.user.name,
        action: "payment_settled",
        module: "payments",
        targetId: row.id,
        detail: { purpose: row.purpose, amount: row.amount.toString(), currency: row.currency },
      });
    }
    redirect(returnTo);
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader kicker="Mock checkout" title="Complete payment" />
      <Alert>
        This is the <strong>mock payment provider</strong>. In production this screen is Stripe or
        Razorpay checkout, selected by your country.
      </Alert>
      <Card strong className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CreditCard className="size-4" aria-hidden /> {payment.requester.displayName}
        </div>
        {lines.map((l) => (
          <KV
            key={l.id}
            k={
              l.purpose === "CONSENT_PRICE"
                ? `Consent price → ${payment.request?.consenter.displayName ?? "consenter"}`
                : titleCase(l.purpose)
            }
            v={fmtMoney(l.amount.toString(), l.currency)}
          />
        ))}
        {payment.tax && <KV k={payment.taxLabel ?? "Tax"} v={`included: ${fmtMoney(payment.tax.toString(), payment.currency)}`} />}
        {payment.discount && <KV k="Coupon discount" v={`−${fmtMoney(payment.discount.toString(), payment.currency)}`} />}
        {consentLine && (
          <>
            <Divider />
            <p className="text-xs text-ink-faint">
              The consent price is set by {payment.request?.consenter.displayName} and is credited to
              them — settled weekly by Consent. It buys the ask, not the answer, and is
              non-refundable. Any usage fee agreed after approval is settled directly between you,
              never through Consent.
            </p>
          </>
        )}
        <form action={confirmAction} className="pt-3">
          <SubmitButton className="w-full">
            Pay{" "}
            {lines
              .map((l) => fmtMoney(l.amount.toString(), l.currency))
              .join(" + ")}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
