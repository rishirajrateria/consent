import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, SectionTitle, StatusBadge, EmptyState, Alert } from "@/components/ui";
import { fmtDateTime, fmtDate, fmtMoney } from "@/lib/utils";
import { Wallet, ReceiptText } from "lucide-react";

export const metadata = { title: "Earnings & payouts" };

const WEEK = 7 * 86400_000;

/** Sum amounts per currency, e.g. "$260.00" or "$260.00 + ₹299.00". */
function total(rows: { amount: { toString(): string }; currency: string }[]) {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + Number(r.amount.toString()));
  return by.size === 0 ? "—" : [...by.entries()].map(([cur, amt]) => fmtMoney(amt, cur)).join(" + ");
}

export default async function EarningsPage() {
  const { consenter } = await requireConsenter();
  const [earnings, settlements] = await Promise.all([
    db.earningEntry.findMany({
      where: { consenterId: consenter.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { request: { include: { requester: true } }, settlement: true },
    }),
    db.settlement.findMany({
      where: { consenterId: consenter.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // Payouts run weekly: at most once every 7 days, starting from the last one.
  const last = settlements[0]?.createdAt;
  const nextPayout = new Date(Math.max(Date.now(), last ? last.getTime() + WEEK : Date.now()));
  const held = earnings.filter((e) => e.status === "HELD");
  const yours = earnings.filter((e) => e.status === "PENDING");

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Earnings & payouts"
        desc="When someone asks you, their ask price is held. It becomes yours the moment you say yes and is paid out weekly. If you decline, or the request ends without a yes, it goes back to them. Fees you agree after approval are paid to you directly and never show here."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-2xl font-semibold tabular-nums">{total(held)}</div>
          <div className="mt-0.5 text-xs text-ink-soft">Held until you answer</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold tabular-nums">{total(yours)}</div>
          <div className="mt-0.5 text-xs text-ink-soft">Yours · next payout {fmtDate(nextPayout)}</div>
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
            Your ask price ·{" "}
            <Link href="/c-panel/settings" className="underline underline-offset-4">change</Link>
          </div>
        </Card>
      </div>

      {!consenter.payoutDetails && (
        <Alert tone="warn">
          Add your payout details in{" "}
          <Link href="/c-panel/settings" className="underline underline-offset-4">settings</Link> so
          your weekly payouts know where to go.
        </Alert>
      )}

      <Card className="space-y-2">
        <SectionTitle title="Every ask" desc="One line per paid ask, and where its money stands." />
        {earnings.length === 0 && (
          <p className="text-sm text-ink-faint">No paid asks yet. Set an ask price in settings and people pay it when they ask you.</p>
        )}
        {earnings.map((e) => {
          const status =
            e.status === "HELD"
              ? { s: "HELD", label: "Held until you answer" }
              : e.status === "PENDING"
                ? { s: "OPEN", label: `Yours · paid out ${fmtDate(nextPayout)}` }
                : e.status === "SETTLED"
                  ? { s: "PAID", label: `Paid out ${e.settlement ? fmtDate(e.settlement.createdAt) : ""}`.trim() }
                  : e.status === "REFUNDED"
                    ? { s: "REFUNDED", label: `Refunded to ${e.request.requester.displayName}` }
                    : { s: "REFUNDED", label: "Not paid (expired)" };
          return (
            <div key={e.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2.5 text-sm first:border-t-0">
              <div className="min-w-0 flex-1">
                <Link href={`/c-panel/requests/${e.requestId}`} className="font-medium underline-offset-4 hover:underline">
                  #{e.request.number} · {e.request.requester.displayName}
                </Link>
                <div className="text-xs text-ink-faint">
                  {fmtDateTime(e.createdAt)}
                  {e.reversedReason ? ` · ${e.reversedReason}` : ""}
                </div>
              </div>
              <span className="font-semibold tabular-nums">{fmtMoney(e.amount.toString(), e.currency)}</span>
              <StatusBadge status={status.s} label={status.label} />
            </div>
          );
        })}
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="Payouts" desc="One payout a week while you have money that's yours." />
        {settlements.length === 0 && <EmptyState icon={Wallet} title="No payouts yet" desc="Once you say yes to a paid ask, its price goes out in the next weekly payout." />}
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
