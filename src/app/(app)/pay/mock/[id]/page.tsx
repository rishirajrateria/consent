import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, KV, PageHeader, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { settlePayment } from "@/lib/payments";
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
    include: { requester: true },
  });
  if (!payment) notFound();
  const member = await db.requesterMember.findUnique({
    where: { requesterId_userId: { requesterId: payment.requesterId, userId: session.userId } },
  });
  if (!member) notFound();
  const returnTo = typeof sp.return === "string" ? sp.return : "/r-panel";

  if (payment.status === "PAID") redirect(returnTo);

  async function confirmAction() {
    "use server";
    const s = await requireUser();
    const p = await db.payment.findUniqueOrThrow({ where: { id } });
    const m = await db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: p.requesterId, userId: s.userId } },
    });
    if (!m) redirect("/dashboard");
    await settlePayment(id);
    await audit({
      actorId: s.userId,
      actorName: s.user.name,
      action: "payment_settled",
      module: "payments",
      targetId: id,
      detail: { purpose: p.purpose, amount: p.amount.toString(), currency: p.currency },
    });
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
        <KV k="Purpose" v={titleCase(payment.purpose)} />
        <KV k="Amount" v={fmtMoney(payment.amount.toString(), payment.currency)} />
        {payment.tax && <KV k={payment.taxLabel ?? "Tax"} v={`included: ${fmtMoney(payment.tax.toString(), payment.currency)}`} />}
        {payment.discount && <KV k="Coupon discount" v={`−${fmtMoney(payment.discount.toString(), payment.currency)}`} />}
        <form action={confirmAction} className="pt-3">
          <SubmitButton className="w-full">Pay {fmtMoney(payment.amount.toString(), payment.currency)}</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
