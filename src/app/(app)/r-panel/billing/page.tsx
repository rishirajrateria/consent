import Link from "next/link";
import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, SectionTitle, ButtonLink, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { payMembershipAction } from "@/app/(app)/onboarding/actions";
import { membershipPriceFor } from "@/lib/payments";
import { fmtPrice } from "@/lib/currencies";
import { getSettings } from "@/lib/settings";
import { membershipOk, verified } from "@/lib/membership";
import { PLATFORM_PCT } from "@/lib/platform-fee";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/utils";
import { splitConsentFee } from "@/lib/escrow";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT } from "@/app/(app)/c-panel/requests/fee-split";
import { PAYMENT_LABEL, paymentParts } from "@/app/(app)/pay/lines";
import type { Payment } from "@prisma/client";
import { ReceiptText } from "lucide-react";

export const metadata = { title: "Payments & membership" };

export default async function BillingPage({ searchParams }: PageProps<"/r-panel/billing">) {
  const sp = await searchParams;
  const { requester, member } = await requireRequester();
  const [payments, price, settings] = await Promise.all([
    db.payment.findMany({
      // Unpaid lines are checkouts that were left; only real payments show.
      where: { requesterId: requester.id, status: { not: "PENDING" } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { request: { select: { id: true, number: true, consenter: { select: { displayName: true } } } } },
    }),
    membershipPriceFor(requester.country),
    getSettings(),
  ]);
  const feeOn = settings.membershipFeeOn;
  const yearly = fmtPrice(price.fee, price.currency);
  const taxNote =
    price.taxRate && Number(price.taxRate.toString()) > 0 ? ` + ${price.taxLabel ?? "tax"} ${Number(price.taxRate.toString())}%` : "";
  const paidUp = membershipOk(requester, true);

  return (
    <div className="space-y-6">
      <PageHeader kicker={requester.displayName} title="Payments & membership" />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.renewed && <SuccessNote msg="Membership paid. Thank you!" />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <SectionTitle title="Membership" />
          {!feeOn ? (
            <>
              <p className="text-lg font-semibold">
                {yearly} a year · Free for now
              </p>
              <p className="text-sm text-ink-soft">
                Every verified profile can send requests without paying while membership is free. People
                can always ask you, with or without it.
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold">{yearly} a year</p>
                <StatusBadge
                  status={paidUp ? "ACTIVE" : "EXPIRED"}
                  label={
                    paidUp
                      ? `Active until ${fmtDate(requester.membershipEndsAt)}`
                      : requester.membershipEndsAt
                        ? `Ended ${fmtDate(requester.membershipEndsAt)}`
                        : "Not active"
                  }
                />
              </div>
              <p className="text-sm text-ink-soft">
                Sending requests needs a membership. People can always ask you, with or without it.
              </p>
              {!verified(requester) ? (
                <div className="space-y-2">
                  <p className="text-sm text-ink-soft">You can pay once your ID check is approved.</p>
                  <ButtonLink href="/onboarding" variant="secondary">See your ID check</ButtonLink>
                </div>
              ) : member.role === "VIEWER" ? (
                <p className="text-sm text-ink-soft">Viewers can&apos;t pay. Ask the profile owner.</p>
              ) : (
                <form action={payMembershipAction}>
                  <SubmitButton>
                    {paidUp ? `Renew for one year · ${yearly}` : `Pay ${yearly} for one year`}
                    {taxNote}
                  </SubmitButton>
                </form>
              )}
            </>
          )}
        </Card>

        <Card className="space-y-2">
          <SectionTitle
            title="Payments"
            desc={`What you paid to send requests${feeOn ? ", and your membership" : ""}. A consent request fee is held until they answer. If they say yes, ${OWNER_PCT} goes to them. If not, ${REFUND_PCT} comes back to you. Consent keeps ${CONSENT_PCT}. The platform fee (${PLATFORM_PCT} of the consent request fee) isn't refunded.`}
          />
          {payments.length === 0 && (
            <EmptyState icon={ReceiptText} title="No payments yet" desc="Asking someone whose consent request fee is free costs nothing." />
          )}
          {payments.map((p) => {
            const parts = paymentParts(p);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t hairline py-2 text-sm first:border-t-0">
                <div className="min-w-0">
                  <div className="font-medium">
                    {PAYMENT_LABEL[p.purpose]} · {fmtMoney(p.amount.toString(), p.currency)}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {fmtDateTime(p.paidAt ?? p.createdAt)}
                    {p.request && (
                      <>
                        {" · "}
                        <Link href={`/r-panel/requests/${p.request.id}`} className="underline underline-offset-4">
                          Request #{p.request.number} to {p.request.consenter.displayName}
                        </Link>
                      </>
                    )}
                    {parts.tax ? ` · incl. ${parts.taxLabel} ${fmtMoney(parts.tax, p.currency)}` : ""}
                    {parts.discount ? ` · coupon −${fmtMoney(parts.discount, p.currency)}` : ""}
                    {p.refundedAt ? ` · ${refundText(p)} on ${fmtDateTime(p.refundedAt)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={p.status} label={statusLabel(p)} />
                  {p.invoiceNumber && (
                    <a className="text-xs underline underline-offset-4" href={`/api/invoices/${p.id}`} target="_blank" rel="noopener">
                      Invoice PDF
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

/** "Paid", "80% refunded", or "Not refunded" for a platform fee kept when a request expired. */
function statusLabel(p: Pick<Payment, "status" | "purpose" | "amount" | "refundedAmount">) {
  if (p.status === "REFUNDED" && p.purpose === "CONSENT_PRICE") {
    const paid = Number(p.amount.toString());
    const back = Number((p.refundedAmount ?? p.amount).toString());
    return paid > 0 ? `${Math.round((back / paid) * 100)}% refunded` : undefined;
  }
  if (p.status === "FORFEITED") return "Not refunded";
  return undefined;
}

/** "refunded ₹80.00 (80%)": what actually came back, and its share of the fee paid. */
function refundText(p: Pick<Payment, "amount" | "currency" | "refundedAmount">) {
  const paid = Number(p.amount.toString());
  const back = p.refundedAmount != null ? Number(p.refundedAmount.toString()) : splitConsentFee(paid).refund;
  const share = paid > 0 ? ` (${Math.round((back / paid) * 100)}%)` : "";
  return `refunded ${fmtMoney(back, p.currency)}${share}`;
}
