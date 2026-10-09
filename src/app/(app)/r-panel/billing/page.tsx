import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, KV, StatusBadge, SectionTitle, Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { SuccessNote } from "@/components/error-note";
import { payRenewalAction } from "@/app/(app)/onboarding/actions";
import { requesterActive } from "@/lib/payments";
import { fmtDate, fmtDateTime, fmtMoney, titleCase } from "@/lib/utils";

export const metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: PageProps<"/r-panel/billing">) {
  const sp = await searchParams;
  const { requester } = await requireRequester();
  const payments = await db.payment.findMany({
    where: { requesterId: requester.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const active = requesterActive(requester);

  return (
    <div className="space-y-6">
      <PageHeader kicker={requester.displayName} title="Billing & subscription" />
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
          <form action={payRenewalAction} className="flex flex-wrap items-end gap-2 pt-2">
            <div className="w-40">
              <Field label="Coupon code" hint="Optional.">
                <Input name="coupon" placeholder="CODE" className="uppercase" />
              </Field>
            </div>
            <SubmitButton variant="secondary">Renew for one year</SubmitButton>
          </form>
        </Card>

        <Card className="space-y-2">
          <SectionTitle title="Payment history" desc="Platform fees only — Consent never handles fees between you and consenters." />
          {payments.length === 0 && <p className="text-sm text-ink-faint">No payments yet.</p>}
          {payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t hairline py-2 text-sm first:border-t-0">
              <div>
                <div className="font-medium">{titleCase(p.purpose)} · {fmtMoney(p.amount.toString(), p.currency)}</div>
                <div className="text-xs text-ink-faint">
                  {fmtDateTime(p.createdAt)}
                  {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}
                  {p.taxLabel && p.tax ? ` · incl. ${p.taxLabel} ${fmtMoney(p.tax.toString(), p.currency)}` : ""}
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
