import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, SectionTitle } from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtDate } from "@/lib/utils";
import { OWNER_SHARE } from "@/lib/escrow";
import { CreditCard } from "lucide-react";
import { PURPOSE, refundLine } from "../payment-labels";

export const metadata = { title: "Payments & invoices" };

export default async function AdminPayments() {
  await requireAdmin("payments", "view");
  const [payments, settlements, subs] = await Promise.all([
    db.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { requester: true },
    }),
    db.settlement.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { consenter: true, _count: { select: { entries: true } } },
    }),
    db.requesterProfile.findMany({
      where: { status: "APPROVED" },
      orderBy: { subscriptionEndsAt: "asc" },
      take: 50,
      select: { id: true, displayName: true, subscriptionEndsAt: true, onboardingFeePaidAt: true, country: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin · Finance" title="Payments & invoices" desc="Platform fees and consent request fees, paid by requesters only. Fees agreed between the parties never move through Consent." />

      <Card className="space-y-2">
        <SectionTitle title="Subscription status" />
        {subs.map((s) => {
          const active = s.subscriptionEndsAt && s.subscriptionEndsAt > new Date();
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2 text-sm first:border-t-0">
              <span className="font-medium">{s.displayName}</span>
              <span className="text-xs text-ink-faint">{s.country} · ends {fmtDate(s.subscriptionEndsAt)}</span>
              <StatusBadge status={active ? "ACTIVE" : s.onboardingFeePaidAt ? "EXPIRED" : "PENDING"} className="ml-auto" />
            </div>
          );
        })}
        {subs.length === 0 && <p className="text-sm text-ink-faint">No approved requesters yet.</p>}
      </Card>

      <Card className="space-y-2">
        <SectionTitle
          title="Weekly settlements"
          desc={`Owners' ${Math.round(OWNER_SHARE * 100)}% of consent request fees they said yes to, batched and paid out weekly on Fridays. Usage fees between parties never move through Consent.`}
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
            <span>{PURPOSE[p.purpose]} · {fmtMoney(p.amount.toString(), p.currency)}</span>
            {p.status === "REFUNDED" && <span className="text-xs text-ink-soft">{refundLine(p)}</span>}
            <span className="text-xs text-ink-faint">
              {p.provider} · {fmtDateTime(p.createdAt)}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}
              {p.couponCode ? ` · coupon ${p.couponCode}` : ""}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {p.invoiceNumber && (
                <a href={`/api/invoices/${p.id}`} target="_blank" className="text-xs underline underline-offset-4">invoice</a>
              )}
              <StatusBadge status={p.status} />
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
