import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, KV, StatusBadge, SectionTitle, Alert, Field, Input, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { payRenewalAction } from "@/app/(app)/onboarding/actions";
import { requesterActive, priceFor } from "@/lib/payments";
import { fmtDate, fmtDateTime, fmtMoney, titleCase } from "@/lib/utils";
import { splitConsentFee } from "@/lib/escrow";
import type { Payment } from "@prisma/client";

export const metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: PageProps<"/r-panel/billing">) {
  const sp = await searchParams;
  const { requester, member } = await requireRequester();
  const [payments, price] = await Promise.all([
    db.payment.findMany({
      where: { requesterId: requester.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    priceFor(requester.country),
  ]);
  const active = requesterActive(requester);

  return (
    <div className="space-y-6">
      <PageHeader kicker={requester.displayName} title="Billing & subscription" />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.renewed && <SuccessNote msg="Subscription renewed. Thank you!" />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <SectionTitle title="Subscription" />
          <KV k="Status" v={<StatusBadge status={active ? "ACTIVE" : "EXPIRED"} />} />
          <KV k="Onboarding fee" v={requester.onboardingFeePaidAt ? `Paid ${fmtDate(requester.onboardingFeePaidAt)}` : "Unpaid"} />
          <KV k="Subscription ends" v={fmtDate(requester.subscriptionEndsAt)} />
          {!active && requester.onboardingFeePaidAt && (
            <Alert tone="warn">
              Your subscription has lapsed. You keep read access to past grants and certificates, but
              cannot send new requests until you renew.
            </Alert>
          )}
          {/* Renewal only extends an active account; until then the onboarding payment covers the first year. */}
          {requester.status !== "APPROVED" ? (
            <div className="space-y-2 pt-2">
              <p className="text-sm text-ink-soft">You can pay once your application is approved.</p>
              <ButtonLink href="/onboarding/requester" variant="secondary">See application status</ButtonLink>
            </div>
          ) : member.role === "VIEWER" ? (
            // Viewer seats are read-only, so they never see a pay button.
            <p className="pt-2 text-sm text-ink-soft">
              {requester.onboardingFeePaidAt
                ? "Viewers can't renew. Ask the account owner."
                : "Viewers can't pay. Ask the account owner to activate the account."}
            </p>
          ) : !requester.onboardingFeePaidAt ? (
            <div className="space-y-2 pt-2">
              <p className="text-sm text-ink-soft">
                You&apos;re approved. Pay the onboarding fee to start sending requests; it includes your first year.
              </p>
              <ButtonLink href="/onboarding/requester">Activate your account</ButtonLink>
            </div>
          ) : (
            <form action={payRenewalAction} className="flex flex-wrap items-end gap-2 pt-2">
              <div className="w-40">
                <Field label="Coupon code" hint="Optional.">
                  <Input name="coupon" placeholder="CODE" className="uppercase" />
                </Field>
              </div>
              <SubmitButton variant="secondary">
                Renew for one year — {fmtMoney(price.yearlyFee.toString(), price.currency)}
                {price.taxRate && Number(price.taxRate) > 0 ? ` + ${price.taxLabel ?? "tax"} ${price.taxRate}%` : ""}
              </SubmitButton>
            </form>
          )}
        </Card>

        <Card className="space-y-2">
          <SectionTitle
            title="Payment history"
            desc="Platform fees and owners' consent request fees. A consent request fee is held until the owner answers. If they say yes, 80% goes to them; if not, 80% is refunded to you. Consent keeps 20%. The platform fee isn't refunded. Consent never handles fees agreed between you and owners."
          />
          {payments.length === 0 && <p className="text-sm text-ink-faint">No payments yet.</p>}
          {payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t hairline py-2 text-sm first:border-t-0">
              <div>
                <div className="font-medium">
                  {PURPOSE_LABEL[p.purpose] ?? titleCase(p.purpose)} · {fmtMoney(p.amount.toString(), p.currency)}
                </div>
                <div className="text-xs text-ink-faint">
                  {fmtDateTime(p.createdAt)}
                  {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}
                  {p.taxLabel && p.tax ? ` · incl. ${p.taxLabel} ${fmtMoney(p.tax.toString(), p.currency)}` : ""}
                  {p.refundedAt ? ` · ${refundText(p)} on ${fmtDateTime(p.refundedAt)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={p.status} />
                {p.invoiceNumber && (
                  <a className="text-xs underline underline-offset-4" href={`/api/invoices/${p.id}`} target="_blank">
                    Invoice PDF
                  </a>
                )}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

const PURPOSE_LABEL: Partial<Record<Payment["purpose"], string>> = {
  PER_REQUEST: "Platform fee",
  CONSENT_PRICE: "Consent request fee",
};

/** "refunded $8.00 (80%)": what actually came back, and its share of the fee paid. */
function refundText(p: Pick<Payment, "amount" | "currency" | "refundedAmount">) {
  const paid = Number(p.amount.toString());
  const back = p.refundedAmount != null ? Number(p.refundedAmount.toString()) : splitConsentFee(paid).refund;
  const share = paid > 0 ? ` (${Math.round((back / paid) * 100)}%)` : "";
  return `refunded ${fmtMoney(back, p.currency)}${share}`;
}
