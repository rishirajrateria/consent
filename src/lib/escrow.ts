/* The owner's consent request fee is held from the moment a request is paid
   for. When the owner says yes (approval, an automatic yes from their terms,
   or an agreed fee), 80% of it becomes theirs and goes out in the next weekly
   payout. Any other ending (declined, no answer in time, withdrawn, ended by
   either side) refunds 80% to the requester. Consent keeps 20% either way.
   The platform fee is Consent's and is never refunded. */

import type { RequestStatus } from "@prisma/client";
import { db } from "./db";
import { notifyConsenterTeam, notifyRequesterTeam } from "./notify";
import { paymentProviderFor } from "./providers";
import { fmtMoney } from "./utils";

/** Share of a consent request fee that goes to the owner on a yes. */
export const OWNER_SHARE = 0.8;
/** Share of a consent request fee refunded to the requester without a yes. */
export const REFUND_SHARE = 0.8;

const cents = (n: number) => Math.round(n * 100) / 100;

/** How a consent request fee splits: what the owner gets on a yes, what comes back otherwise, and Consent's part. */
export function splitConsentFee(gross: number) {
  const owner = cents(gross * OWNER_SHARE);
  const refund = cents(gross * REFUND_SHARE);
  return { gross: cents(gross), owner, refund, consentOnYes: cents(gross - owner), consentOnNo: cents(gross - refund) };
}

/** The owner has said yes: their share of the held fee is released to them. */
export const YES_STATUSES: RequestStatus[] = [
  "DEAL_AGREED",
  "APPROVED_IN_PRINCIPLE",
  "AGREEMENT_MODE_PENDING",
  "LEGAL_AGREEMENT_PENDING",
  "APPROVED",
];
/** The request ended without a yes: the requester's share of the held fee is refunded. */
export const NO_STATUSES: RequestStatus[] = ["DENIED", "CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"];

export type EscrowOutcome = "release" | "refund" | "hold";

export function escrowOutcome(status: RequestStatus): EscrowOutcome {
  if (YES_STATUSES.includes(status)) return "release";
  if (NO_STATUSES.includes(status)) return "refund";
  return "hold";
}

const ENDING: Partial<Record<RequestStatus, string>> = {
  DENIED: "was declined",
  CLOSED: "ended without a deal",
  EXPIRED_NO_RESPONSE: "wasn't answered in time",
  WITHDRAWN: "was withdrawn",
};

/**
 * Settle a request's held consent request fee according to where the request now
 * stands. Safe to call after every status change and from the sweep: only a
 * HELD entry ever moves, and only once.
 */
export async function syncConsentPrice(requestId: string): Promise<EscrowOutcome | "none"> {
  const entry = await db.earningEntry.findUnique({
    where: { requestId },
    include: { payment: true, request: { include: { consenter: true, requester: true } } },
  });
  if (!entry || entry.status !== "HELD") return "none";
  const { request, payment } = entry;
  const outcome = escrowOutcome(request.status);
  const gross = Number((entry.grossAmount ?? payment.amount).toString());
  const split = splitConsentFee(gross);
  const fee = fmtMoney(gross, entry.currency);

  if (outcome === "release") {
    const moved = await db.earningEntry.updateMany({ where: { id: entry.id, status: "HELD" }, data: { status: "PENDING" } });
    if (moved.count === 0) return "none";
    await notifyConsenterTeam(request.consenterId, {
      title: `${fmtMoney(entry.amount.toString(), entry.currency)} is yours`,
      body: `Your 80% of the ${fee} consent request fee ${request.requester.displayName} paid for request #${request.number}. It goes out in your next Friday payout.`,
      href: "/c-panel/earnings",
    });
    return "release";
  }

  if (outcome === "refund") {
    const reason = `Request ${ENDING[request.status] ?? "ended without a yes"}`;
    const moved = await db.earningEntry.updateMany({
      where: { id: entry.id, status: "HELD" },
      data: { status: "REFUNDED", reversedReason: reason },
    });
    if (moved.count === 0) return "none";
    const { refundRef } = await paymentProviderFor(request.requester.country).refund({
      paymentId: payment.id,
      providerRef: payment.providerRef,
      amount: split.refund.toFixed(2),
      currency: payment.currency,
      reason,
    });
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", refundedAt: new Date(), refundRef, refundedAmount: split.refund.toFixed(2) },
    });
    await db.requestEvent.create({
      data: { requestId, type: "consent_fee_refunded", actorSide: "system", detail: { fee: split.gross.toFixed(2), refunded: split.refund.toFixed(2), currency: entry.currency } },
    });
    await notifyRequesterTeam(request.requesterId, {
      title: `${fmtMoney(split.refund, entry.currency)} refunded`,
      body: `80% of the ${fee} consent request fee for request #${request.number} came back to you because the request ${ENDING[request.status] ?? "ended without a yes"}. Consent keeps 20%, and the platform fee isn't refunded.`,
      href: "/r-panel/billing",
    });
    return "refund";
  }
  return "hold";
}

/** Sweep: settle every held consent request fee whose request already has an outcome. */
export async function escrowSweep(): Promise<number> {
  const held = await db.earningEntry.findMany({
    where: { status: "HELD", request: { status: { in: [...YES_STATUSES, ...NO_STATUSES] } } },
    select: { requestId: true },
  });
  let moved = 0;
  for (const h of held) if ((await syncConsentPrice(h.requestId)) !== "none") moved++;
  return moved;
}
