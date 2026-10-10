import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, SectionTitle } from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtDate } from "@/lib/utils";
import { OWNER_SHARE } from "@/lib/escrow";
import { PLATFORM_PCT } from "@/lib/platform-fee";
import { getSettings } from "@/lib/settings";
import { CreditCard } from "lucide-react";
import { PURPOSE, refundLine } from "../payment-labels";
import { fmtRevenue, revenueByCurrency } from "../revenue";

export const metadata = { title: "Payments & invoices" };

export default async function AdminPayments() {
  await requireAdmin("payments", "view");
  const settings = await getSettings();
  const [payments, settlements, members, revenueAll, revenue30] = await Promise.all([
    db.payment.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { requester: true, request: { select: { number: true } } },
    }),
    db.settlement.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { consenter: true, _count: { select: { entries: true } } },
    }),
    // Memberships only matter while the fee is on.
    settings.membershipFeeOn
      ? db.requesterProfile.findMany({
          where: { status: "APPROVED" },
          orderBy: [{ membershipEndsAt: { sort: "asc", nulls: "first" } }],
          take: 50,
          select: { id: true, displayName: true, membershipEndsAt: true, country: true },
        })
      : Promise.resolve([]),
    revenueByCurrency(),
    revenueByCurrency({ days: 30 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Admin · Finance"
        title="Payments & invoices"
        desc={`Consent request fees, platform fees (${PLATFORM_PCT} of the consent request fee) and memberships, all paid by the profile asking. Totals are per currency.`}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <div className="text-2xl font-semibold tabular-nums">{fmtRevenue(revenueAll)}</div>
          <div className="mt-0.5 text-xs text-ink-soft">What Consent keeps, all time</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold tabular-nums">{fmtRevenue(revenue30)}</div>
          <div className="mt-0.5 text-xs text-ink-soft">What Consent keeps, last 30 days</div>
        </Card>
      </div>

      <Card className="space-y-2">
        <SectionTitle
          title="Memberships"
          desc={settings.membershipFeeOn ? "Verified profiles, the soonest to end first." : undefined}
        />
        {!settings.membershipFeeOn ? (
          <p className="text-sm text-ink-soft">
            Membership is free for now: every verified profile can send requests.{" "}
            <Link href="/admin/pricing" className="underline underline-offset-4">Turn the fee on in Pricing</Link>.
          </p>
        ) : (
          <>
            {members.map((s) => {
              const active = !!s.membershipEndsAt && s.membershipEndsAt > new Date();
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2 text-sm first:border-t-0">
                  <span className="font-medium">{s.displayName}</span>
                  <span className="text-xs text-ink-faint">
                    {s.country} · {s.membershipEndsAt ? `ends ${fmtDate(s.membershipEndsAt)}` : "never paid"}
                  </span>
                  <StatusBadge status={active ? "ACTIVE" : s.membershipEndsAt ? "EXPIRED" : "PENDING"} label={active ? "Active" : s.membershipEndsAt ? "Ended" : "Not paid"} className="ml-auto" />
                </div>
              );
            })}
            {members.length === 0 && <p className="text-sm text-ink-faint">No verified profiles yet.</p>}
          </>
        )}
      </Card>

      <Card className="space-y-2">
        <SectionTitle
          title="Weekly settlements"
          desc={`Each profile's ${Math.round(OWNER_SHARE * 100)}% of the consent request fees they said yes to, batched and paid out on Fridays.`}
        />
        {settlements.length === 0 && <p className="text-sm text-ink-faint">No settlements yet.</p>}
        {settlements.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2 text-sm first:border-t-0">
            <span className="font-medium">{s.consenter.displayName}</span>
            <span>{fmtMoney(s.amount.toString(), s.currency)}</span>
            <span className="text-xs text-ink-faint">
              {s._count.entries} earning{s._count.entries === 1 ? "" : "s"} · ref {s.reference} · {fmtDateTime(s.createdAt)}
            </span>
            <StatusBadge status="PAID" className="ml-auto" />
          </div>
        ))}
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="Payments" />
        {payments.length === 0 && <EmptyState icon={CreditCard} title="No payments yet" />}
        {payments.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2 text-sm first:border-t-0">
            <span className="font-medium">{p.requester.displayName}</span>
            <span>
              {PURPOSE[p.purpose]} · {fmtMoney(p.amount.toString(), p.currency)}
              {p.request ? ` · request #${p.request.number}` : ""}
            </span>
            {p.status === "REFUNDED" && <span className="text-xs text-ink-soft">{refundLine(p)}</span>}
            <span className="text-xs text-ink-faint">
              {p.provider} · {fmtDateTime(p.paidAt ?? p.createdAt)}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}
              {p.couponCode ? ` · coupon ${p.couponCode}` : ""}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {p.invoiceNumber && (
                <a href={`/api/invoices/${p.id}`} target="_blank" rel="noopener" className="text-xs underline underline-offset-4">invoice</a>
              )}
              <StatusBadge
                status={p.status}
                label={
                  p.status === "REFUNDED" && p.purpose === "CONSENT_PRICE"
                    ? `${Math.round((Number((p.refundedAmount ?? p.amount).toString()) / Number(p.amount.toString())) * 100)}% refunded`
                    : p.status === "FORFEITED"
                      ? "Not refunded"
                      : undefined
                }
              />
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
