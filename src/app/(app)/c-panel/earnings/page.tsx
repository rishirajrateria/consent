import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, SectionTitle, StatusBadge, EmptyState, Alert } from "@/components/ui";
import { fmtDateTime, fmtDate, fmtMoney } from "@/lib/utils";
import {
  OWNER_PCT, REFUND_PCT, CONSENT_PCT, grossOf, refundedOf, shareOf, nextPayoutDay, fmtPayoutDay,
} from "../requests/fee-split";
import { Wallet, ReceiptText } from "lucide-react";

export const metadata = { title: "Earnings & payouts" };

/** Sum amounts per currency, e.g. "$260.00" or "$260.00 + ₹299.00". */
function total(rows: { amount: { toString(): string }; currency: string }[]) {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + Number(r.amount.toString()));
  return by.size === 0 ? "—" : [...by.entries()].map(([cur, amt]) => fmtMoney(amt, cur)).join(" + ");
}

export default async function EarningsPage() {
  const { consenter, member } = await requireConsenter();
  const [earnings, settlements] = await Promise.all([
    db.earningEntry.findMany({
      where: { consenterId: consenter.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { request: { include: { requester: true } }, settlement: true, payment: true },
    }),
    db.settlement.findMany({
      where: { consenterId: consenter.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const nextPayout = fmtPayoutDay(nextPayoutDay(settlements[0]?.createdAt));
  const held = earnings.filter((e) => e.status === "HELD");
  const yours = earnings.filter((e) => e.status === "PENDING");

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Earnings & payouts"
        desc={`The consent request fee is held until you answer. If you say yes, ${OWNER_PCT} is yours, paid out on Fridays. If you decline, or the request ends without a yes, ${REFUND_PCT} goes back to them. Consent keeps ${CONSENT_PCT}. Fees you agree after approval are paid to you directly and never show here.`}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-2xl font-semibold tabular-nums">{total(held)}</div>
          <div className="mt-0.5 text-xs text-ink-soft">Held · yours ({OWNER_PCT}) if you say yes</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold tabular-nums">{total(yours)}</div>
          <div className="mt-0.5 text-xs text-ink-soft">Yours · next payout {nextPayout}</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold tabular-nums">{total(settlements)}</div>
          <div className="mt-0.5 text-xs text-ink-soft">Paid out so far</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold tabular-nums">
            {consenter.consentPrice
              ? fmtMoney(consenter.consentPrice.toString(), consenter.consentPriceCurrency)
              : "Free"}
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">
            Your consent request fee ·{" "}
            <Link href="/c-panel/settings" className="underline underline-offset-4">change</Link>
          </div>
        </Card>
      </div>

      {!consenter.payoutDetails &&
        (member.role === "OWNER" ? (
          <Alert tone="warn">
            Add your payout details in{" "}
            <Link href="/c-panel/settings" className="underline underline-offset-4">settings</Link> so
            your weekly payouts know where to go.
          </Alert>
        ) : (
          <Alert tone="warn">No payout details yet. Ask the profile owner to add them.</Alert>
        ))}

      <Card className="space-y-2">
        <SectionTitle title="Every ask" desc="One line per paid ask: the consent request fee they paid and where it stands." />
        {earnings.length === 0 && (
          <p className="text-sm text-ink-faint">No paid asks yet. Set a consent request fee in settings and people pay it when they ask you.</p>
        )}
        {earnings.map((e) => {
          const gross = grossOf(e);
          const share = Number(e.amount.toString());
          const refunded = e.status === "REFUNDED" ? refundedOf(e) : 0;
          const money =
            e.status === "HELD"
              ? { s: "HELD", label: "Held until you answer", line: `You'd get (${shareOf(share, gross)}) if you say yes`, amount: share }
              : e.status === "PENDING"
                ? { s: "OPEN", label: `Yours · paid out ${nextPayout}`, line: `Your share (${shareOf(share, gross)})`, amount: share }
                : e.status === "SETTLED"
                  ? {
                      s: "PAID",
                      label: `Paid out ${e.settlement ? fmtDate(e.settlement.createdAt) : ""}`.trim(),
                      line: `Your share (${shareOf(share, gross)})`,
                      amount: share,
                    }
                  : e.status === "REFUNDED"
                    ? {
                        s: "REFUNDED",
                        label: "Refunded",
                        line: `Refunded to ${e.request.requester.displayName} (${shareOf(refunded, gross)})`,
                        amount: refunded,
                      }
                    : { s: "REFUNDED", label: "Not paid (expired)", line: "Not paid to you", amount: share };
          return (
            <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t hairline py-2.5 text-sm first:border-t-0">
              <div className="min-w-0 flex-1">
                <Link href={`/c-panel/requests/${e.requestId}`} className="font-medium underline-offset-4 hover:underline">
                  #{e.request.number} · {e.request.requester.displayName}
                </Link>
                <div className="text-xs text-ink-faint">
                  {fmtDateTime(e.createdAt)}
                  {e.reversedReason ? ` · ${e.reversedReason}` : ""}
                </div>
              </div>
              <dl className="text-right text-xs text-ink-soft">
                <div className="flex justify-end gap-2">
                  <dt>Consent request fee</dt>
                  <dd className="tabular-nums">{fmtMoney(gross, e.currency)}</dd>
                </div>
                <div className="flex justify-end gap-2 text-ink">
                  <dt>{money.line}</dt>
                  <dd className="font-semibold tabular-nums">{fmtMoney(money.amount, e.currency)}</dd>
                </div>
              </dl>
              <StatusBadge status={money.s} label={money.label} />
            </div>
          );
        })}
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="Payouts" desc="One payout a week, on Fridays, while you have money that's yours." />
        {settlements.length === 0 && (
          <EmptyState
            icon={Wallet}
            title="No payouts yet"
            desc={`Once you say yes to a paid ask, your ${OWNER_PCT} of its consent request fee goes out in the next Friday payout.`}
          />
        )}
        {settlements.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2.5 text-sm first:border-t-0">
            <ReceiptText className="size-4 text-ink-soft" aria-hidden />
            <span className="font-semibold">{fmtMoney(s.amount.toString(), s.currency)}</span>
            <span className="text-xs text-ink-faint">
              {fmtDate(s.periodStart)} → {fmtDate(s.periodEnd)} · ref {s.reference}
            </span>
            <StatusBadge status="PAID" label={`Paid out ${fmtDate(s.createdAt)}`} className="ml-auto" />
          </div>
        ))}
      </Card>
    </div>
  );
}
