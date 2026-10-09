import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, SectionTitle, StatusBadge, EmptyState, Alert } from "@/components/ui";
import { fmtDateTime, fmtDate, fmtMoney } from "@/lib/utils";
import { Wallet, ReceiptText } from "lucide-react";

export const metadata = { title: "Earnings & settlements" };

export default async function EarningsPage() {
  const { consenter } = await requireConsenter();
  const [earnings, settlements] = await Promise.all([
    db.earningEntry.findMany({
      where: { consenterId: consenter.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { request: { include: { requester: true } } },
    }),
    db.settlement.findMany({
      where: { consenterId: consenter.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // Pending balance per currency
  const pending = new Map<string, number>();
  for (const e of earnings) {
    if (e.status === "PENDING") pending.set(e.currency, (pending.get(e.currency) ?? 0) + Number(e.amount));
  }
  const settledTotal = new Map<string, number>();
  for (const s of settlements) settledTotal.set(s.currency, (settledTotal.get(s.currency) ?? 0) + Number(s.amount));

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Earnings & settlements"
        desc="Your consent price, collected in-app every time someone asks. Settled to you weekly. Usage fees agreed after approval are settled directly between the parties — they never appear here."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-2xl font-semibold tabular-nums">
            {pending.size === 0
              ? "—"
              : [...pending.entries()].map(([cur, amt]) => fmtMoney(amt, cur)).join(" + ")}
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">Pending balance (next weekly settlement)</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold tabular-nums">
            {settledTotal.size === 0
              ? "—"
              : [...settledTotal.entries()].map(([cur, amt]) => fmtMoney(amt, cur)).join(" + ")}
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">Settled to date</div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold tabular-nums">
            {consenter.consentPrice
              ? fmtMoney(consenter.consentPrice.toString(), consenter.consentPriceCurrency)
              : "Free"}
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">
            Your consent price ·{" "}
            <Link href="/c-panel/settings" className="underline underline-offset-4">change</Link>
          </div>
        </Card>
        <Card>
          <div className="text-2xl font-semibold tabular-nums">{earnings.filter((e) => e.status !== "REVERSED").length}</div>
          <div className="mt-0.5 text-xs text-ink-soft">Paid asks received</div>
        </Card>
      </div>

      {!consenter.payoutDetails && (
        <Alert tone="warn">
          Add your payout details in{" "}
          <Link href="/c-panel/settings" className="underline underline-offset-4">settings</Link> so
          weekly settlements know where to go.
        </Alert>
      )}

      <Card className="space-y-2">
        <SectionTitle title="Settlements" desc="One batch per week while you have a pending balance." />
        {settlements.length === 0 && <EmptyState icon={Wallet} title="No settlements yet" desc="Pending earnings are batched and paid out weekly." />}
        {settlements.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2.5 text-sm first:border-t-0">
            <ReceiptText className="size-4 text-ink-soft" aria-hidden />
            <span className="font-semibold">{fmtMoney(s.amount.toString(), s.currency)}</span>
            <span className="text-xs text-ink-faint">
              {fmtDate(s.periodStart)} → {fmtDate(s.periodEnd)} · ref {s.reference}
            </span>
            <StatusBadge status="PAID" className="ml-auto" />
          </div>
        ))}
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="Earnings" desc="One entry per paid ask. Unanswered requests that auto-expire are reversed — silence never pays." />
        {earnings.length === 0 && <p className="text-sm text-ink-faint">No paid asks yet. Set a consent price in settings and every submission pays it up front.</p>}
        {earnings.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2.5 text-sm first:border-t-0">
            <div className="min-w-0 flex-1">
              <Link href={`/c-panel/requests/${e.requestId}`} className="font-medium hover:underline underline-offset-4">
                #{e.request.number} · {e.request.requester.displayName}
              </Link>
              <div className="text-xs text-ink-faint">
                {fmtDateTime(e.createdAt)}
                {e.reversedReason ? ` · ${e.reversedReason}` : ""}
              </div>
            </div>
            <span className="font-semibold tabular-nums">{fmtMoney(e.amount.toString(), e.currency)}</span>
            <StatusBadge status={e.status === "SETTLED" ? "PAID" : e.status === "REVERSED" ? "REVOKED" : "PENDING"} />
          </div>
        ))}
      </Card>
    </div>
  );
}
