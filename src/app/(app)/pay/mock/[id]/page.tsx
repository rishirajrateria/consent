import { notFound, redirect } from "next/navigation";
import { requireUser, safeNext } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Alert, Divider, ButtonLink } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { settleCheckout, checkoutLines, checkoutIsStale, couponOpen, payerRole } from "@/lib/payments";
import { audit } from "@/lib/audit";
import { blockedCombinations, blockedPayNote } from "@/lib/precheck";
import type { Selection } from "@/lib/rules";
import type { Payment } from "@prisma/client";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { splitConsentFee } from "@/lib/escrow";
import { requestCapacity } from "@/lib/capacity";
import { getSettings } from "@/lib/settings";
import { canSend } from "@/lib/membership";
import { isSelfAsk } from "@/lib/profiles";
import { checkoutRows, checkoutTotal } from "../../lines";
import { OWNER_PCT, REFUND_PCT, CONSENT_PCT } from "@/app/(app)/c-panel/requests/fee-split";
import { CreditCard } from "lucide-react";

export const metadata = { title: "Checkout" };

const MEMBERSHIP_FREE = "Membership is free for now. There's nothing to pay.";

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
  const role = await payerRole(payment.requester, session.userId);
  if (!role) notFound();
  const [backHref, backLabel] = backLink(payment);
  const returnTo = safeNext(sp.return) ?? backHref;

  if (payment.status === "PAID") redirect(returnTo);
  if (role === "VIEWER") redirect(`${backHref}?error=${encodeURIComponent("Viewers can't pay. Ask the profile owner.")}`);
  if (payment.purpose === "MEMBERSHIP" && !(await getSettings()).membershipFeeOn)
    redirect(`/r-panel/billing?error=${encodeURIComponent(MEMBERSHIP_FREE)}`);
  const staleHref = await staleRequestHref(payment.requestId);
  if (staleHref) redirect(staleHref);

  // One checkout: for a request, its consent request fee and platform fee together.
  const lines = await checkoutLines(payment);
  if (lines.length === 0) redirect(returnTo);
  // Never show a discount that can no longer be paid at.
  if (await spentCoupon(lines)) redirect(`${backHref}?error=${encodeURIComponent(COUPON_GONE)}`);
  const rows = checkoutRows(lines);
  const consentLine = lines.find((l) => l.purpose === "CONSENT_PRICE");
  const owner = payment.request?.consenter.displayName ?? "The person you asked";
  // What comes back without a yes: 80% of the consent request fee (Consent keeps 20%).
  const consentRefund = consentLine
    ? fmtMoney(splitConsentFee(Number(consentLine.amount.toString())).refund, consentLine.currency)
    : null;
  const membershipUntil =
    payment.purpose === "MEMBERSHIP" ? nextYear(payment.requester.membershipEndsAt) : null;

  async function confirmAction(formData: FormData) {
    "use server";
    const s = await requireUser();
    const p = await db.payment.findUniqueOrThrow({ where: { id }, include: { requester: true } });
    const r = await payerRole(p.requester, s.userId);
    if (!r) redirect("/c-panel");
    const [back] = backLink(p);
    if (p.status === "PAID") redirect(returnTo);
    if (r === "VIEWER") redirect(`${back}?error=${encodeURIComponent("Viewers can't pay. Ask the profile owner.")}`);
    if (p.purpose === "MEMBERSHIP" && !(await getSettings()).membershipFeeOn)
      redirect(`/r-panel/billing?error=${encodeURIComponent(MEMBERSHIP_FREE)}`);
    const stale = await staleRequestHref(p.requestId);
    if (stale) redirect(stale);
    // Charge only what this page showed: an old checkout page (browser back)
    // can still be open after the lines were rewritten for a new total.
    if (checkoutTotal(await checkoutLines(p)) !== String(formData.get("total") ?? ""))
      redirect(`/pay/mock/${id}?return=${encodeURIComponent(returnTo)}&changed=1`);
    // The coupon may have run out, expired or been switched off since checkout
    // opened: drop the discounted line so it can't be paid, and start again.
    const spent = await spentCoupon(await checkoutLines(p));
    if (spent) {
      await db.payment.deleteMany({ where: { id: spent.id, status: "PENDING" } });
      redirect(`${back}?error=${encodeURIComponent(COUPON_GONE)}`);
    }
    // Settles the consent request fee first, so the held earning exists when
    // the platform fee's settlement sends the request.
    const settled = await settleCheckout(p.id);
    for (const row of settled) {
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
      {sp.changed === "1" && <Alert tone="warn">The amount changed. Check it and pay again.</Alert>}
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
        {/* Like KV, but a long label wraps instead of pushing the amount off screen. */}
        {rows.map((r) => (
          <div key={r.key} className="flex items-start justify-between gap-4 py-2">
            <span className="min-w-0 text-xs font-medium uppercase tracking-wider text-ink-faint">{r.label}</span>
            <span className="shrink-0 text-right text-sm tabular-nums text-ink">
              {r.minus ? "−" : ""}
              {fmtMoney(r.amount, r.currency)}
            </span>
          </div>
        ))}
        <Divider />
        <div className="flex items-start justify-between gap-4 py-1">
          <span className="text-sm font-semibold">Total</span>
          <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{checkoutTotal(lines)}</span>
        </div>
        {consentLine && (
          <p className="text-xs text-ink-faint">
            {owner}&apos;s consent request fee is held until they answer. If they say yes, {OWNER_PCT} goes
            to them. If not, {REFUND_PCT} ({consentRefund}) comes back to you. Consent keeps {CONSENT_PCT}.
            The platform fee isn&apos;t refunded.
          </p>
        )}
        {membershipUntil && (
          <p className="text-xs text-ink-faint">
            One year of membership. You can send requests until {fmtDate(membershipUntil)}. People can
            always ask you, with or without it.
          </p>
        )}
        <div className="flex flex-col gap-2 pt-3">
          <ButtonLink href={backHref} variant="ghost" className="min-h-10 w-full">
            {backLabel}
          </ButtonLink>
          <form action={confirmAction}>
            <input type="hidden" name="total" value={checkoutTotal(lines)} />
            <SubmitButton className="w-full">Pay {checkoutTotal(lines)}</SubmitButton>
          </form>
        </div>
      </Card>
    </div>
  );
}

const COUPON_GONE = "This coupon can no longer be used. Start again to pay the full price.";

/** Where "Back" goes: the draft being paid for, or the payments page. */
function backLink(p: Pick<Payment, "requestId">): [string, string] {
  return p.requestId
    ? [`/r-panel/requests/${p.requestId}/edit`, "Back to request"]
    : ["/r-panel/billing", "Back to payments"];
}

/** A year on from today, or from the current end of the membership if it is still ahead. */
function nextYear(endsAt: Date | null) {
  const now = new Date();
  const next = new Date(endsAt && endsAt > now ? endsAt : now);
  next.setFullYear(next.getFullYear() + 1);
  return next;
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
 * money for anything but what the draft now says. A request that is no longer
 * a draft (sent, or discarded) is never charged: its unpaid lines are dropped.
 * Sending is checked again as on Send (ID check, membership, the person asked
 * still taking requests, not their own profile). Send the asker back when the
 * public terms of the person asked would decline it once paid, or when the
 * unpaid lines no longer match what sending it costs (the intent, the fee, its
 * currency or the tax changed, or asking became free). Sending it again
 * rebuilds the lines. Also sends them back while the request limits of the
 * person asked pause new requests, so nothing is charged; the draft is kept.
 */
async function staleRequestHref(requestId: string | null) {
  if (!requestId) return null;
  const request = await db.consentRequest.findUnique({
    where: { id: requestId },
    include: { requester: true, consenter: true },
  });
  if (!request) return null;
  if (request.status !== "DRAFT") {
    await db.payment.deleteMany({ where: { requestId: request.id, status: "PENDING" } });
    return `/r-panel/requests/${request.id}`;
  }
  const edit = `/r-panel/requests/${request.id}/edit`;
  const back = (error: string) => `${edit}?error=${encodeURIComponent(error)}`;
  // The same checks and words as Send: any of these may have changed since checkout opened.
  if (!canSend(request.requester, (await getSettings()).membershipFeeOn))
    return back(
      request.requester.status !== "APPROVED"
        ? "You can send requests once your ID check is approved."
        : "Sending requests needs a membership. Get one in Payments & membership.",
    );
  if (isSelfAsk(request.consenterId, request.requester)) return back("This is your profile. You can't ask yourself.");
  if (request.consenter.status !== "APPROVED") return back(`${request.consenter.displayName} isn't taking requests right now.`);
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
  return (await checkoutIsStale(requestId)) ? `${edit}?changed=1#review` : null;
}
