import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, KV, PageHeader, Alert, Divider, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { settlePayment, pendingPaymentsForRequest, consentPriceFor, couponOpen } from "@/lib/payments";
import { audit } from "@/lib/audit";
import { blockedCombinations, blockedPayNote } from "@/lib/precheck";
import type { Selection } from "@/lib/rules";
import type { Payment } from "@prisma/client";
import { fmtMoney, titleCase } from "@/lib/utils";
import { splitConsentFee } from "@/lib/escrow";
import { requestCapacity } from "@/lib/capacity";
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
  const staleHref = await staleRequestHref(payment.requestId);
  if (staleHref) redirect(staleHref);

  // A submission checkout covers every pending payment on the request:
  // the platform fee plus the consenter's consent request fee, if set.
  const lines = payment.requestId ? await pendingPaymentsForRequest(payment.requestId) : [payment];
  const consentLine = lines.find((l) => l.purpose === "CONSENT_PRICE");
  const owner = payment.request?.consenter.displayName ?? "The owner";
  // What comes back without a yes: 80% of the consent request fee (Consent keeps 20%).
  const consentRefund = consentLine
    ? fmtMoney(splitConsentFee(Number(consentLine.amount.toString())).refund, consentLine.currency)
    : null;
  // A way back that doesn't pay. Unpaid lines are reused when the request is
  // submitted again, so leaving never adds a second charge.
  const [backHref, backLabel] = backLink(payment);
  // Never show a discount that can no longer be paid at.
  if (await spentCoupon(lines)) redirect(`${backHref}?error=${encodeURIComponent(COUPON_GONE)}`);

  async function confirmAction() {
    "use server";
    const s = await requireUser();
    const p = await db.payment.findUniqueOrThrow({ where: { id } });
    const m = await db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: p.requesterId, userId: s.userId } },
    });
    if (!m) redirect("/dashboard");
    if (p.status === "PAID") redirect(returnTo);
    const stale = await staleRequestHref(p.requestId);
    if (stale) redirect(stale);
    const toSettle = p.requestId
      ? await db.payment.findMany({ where: { requestId: p.requestId, status: "PENDING" } })
      : [p];
    // The coupon may have run out, expired or been switched off since checkout
    // opened: drop the discounted line so it can't be paid, and start again.
    const spent = await spentCoupon(toSettle);
    if (spent) {
      await db.payment.deleteMany({ where: { id: spent.id, status: "PENDING" } });
      redirect(`${backLink(p)[0]}?error=${encodeURIComponent(COUPON_GONE)}`);
    }
    // Settle the consent request fee first so the earning exists when the
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
        {payment.request && (
          <p className="text-sm text-ink-soft">
            Request #{payment.request.number} to {payment.request.consenter.displayName}
          </p>
        )}
        {/* Like KV, but a long owner name wraps instead of pushing the amount off screen. */}
        {lines.map((l) => (
          <div key={l.id} className="flex items-start justify-between gap-4 py-2">
            <span className="min-w-0 text-xs font-medium uppercase tracking-wider text-ink-faint">
              {l.purpose === "CONSENT_PRICE"
                ? `${owner}'s consent request fee`
                : l.purpose === "PER_REQUEST"
                  ? "Platform fee"
                  : titleCase(l.purpose)}
            </span>
            <span className="shrink-0 text-right text-sm text-ink">{fmtMoney(l.amount.toString(), l.currency)}</span>
          </div>
        ))}
        {payment.tax && <KV k={payment.taxLabel ?? "Tax"} v={`included: ${fmtMoney(payment.tax.toString(), payment.currency)}`} />}
        {payment.discount && <KV k="Coupon discount" v={`−${fmtMoney(payment.discount.toString(), payment.currency)}`} />}
        {consentLine && (
          <>
            <Divider />
            <p className="text-xs text-ink-faint">
              {owner}&apos;s consent request fee is held until they answer. If they say yes, 80% goes
              to them; if not, 80% ({consentRefund}) is refunded to you. Consent keeps 20%. The platform
              fee isn&apos;t refunded. Any usage fee agreed after approval is settled directly between
              you, never through Consent.
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
        <ButtonLink href={backHref} variant="ghost" className="min-h-10 w-full">
          {backLabel}
        </ButtonLink>
      </Card>
    </div>
  );
}

const COUPON_GONE = "This coupon can no longer be used. Start again to pay the full price.";

/** Where "Back" goes: the draft being paid for, or the page that opened this checkout. */
function backLink(p: Pick<Payment, "requestId" | "purpose">): [string, string] {
  return p.requestId
    ? [`/r-panel/requests/${p.requestId}/edit`, "Back to request"]
    : p.purpose === "ONBOARDING"
      ? ["/onboarding/requester", "Back"]
      : ["/r-panel/billing", "Back to billing"];
}

/** The first line whose coupon can no longer be redeemed, if any. */
async function spentCoupon(rows: Pick<Payment, "id" | "couponCode">[]) {
  for (const row of rows) {
    if (!row.couponCode) continue;
    const coupon = await db.coupon.findUnique({ where: { code: row.couponCode } });
    if (!couponOpen(coupon)) return row;
  }
  return null;
}

/**
 * An old checkout link can be reopened after the draft was changed. Never take
 * money for anything but what the draft now says: send the requester back when
 * the owner's public matrix would deny it once paid, or when the consent request
 * fee line no longer matches the price for its intent (or the owner's price moved).
 * Pressing "Pay & submit" again rebuilds the lines. Also sends them back while
 * the owner's request limits pause new requests, so nothing is charged; the
 * draft is kept.
 */
async function staleRequestHref(requestId: string | null) {
  if (!requestId) return null;
  const request = await db.consentRequest.findUnique({
    where: { id: requestId },
    include: { requester: true, consenter: { include: { priceTiers: true } } },
  });
  if (!request || request.status !== "DRAFT") return null;
  const edit = `/r-panel/requests/${request.id}/edit`;
  const blocked = await blockedCombinations({
    consenterId: request.consenterId,
    requester: request.requester,
    selections: request.selections as Selection[],
    assetTypeIds: request.assetTypeIds,
  });
  if (blocked.length) return `${edit}?error=${encodeURIComponent(blockedPayNote(request.consenter.displayName))}#scope`;
  const capacity = await requestCapacity(request.consenterId);
  // Step 4 says why and when they open again, in the viewer's own time zone.
  if (capacity.paused) return `${edit}?paused=1#review`;

  const ask = consentPriceFor(request.consenter, request.intentCategoryId);
  const asks = await db.payment.findMany({
    where: { requestId, purpose: "CONSENT_PRICE", status: "PENDING" },
  });
  const stale = ask
    ? asks.length !== 1 ||
      !asks[0].amount.eq(ask) ||
      asks[0].currency !== request.consenter.consentPriceCurrency
    : asks.length > 0;
  return stale ? `${edit}?changed=1#review` : null;
}
