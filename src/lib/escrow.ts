/* The owner's ask price ("consent price") is held from the moment a request
   is paid for. It becomes the owner's the moment they say yes (approval, an
   automatic yes from their terms, or an agreed fee) and goes out in the next
   weekly payout. Any other ending (declined, no answer in time, withdrawn,
   ended by either side) refunds it to the requester. The platform fee is
   Consent's and is never refunded. */

import type { RequestStatus } from "@prisma/client";
import { db } from "./db";
import { notifyConsenterTeam, notifyRequesterTeam } from "./notify";
import { paymentProviderFor } from "./providers";
import { fmtMoney } from "./utils";

/** The owner has said yes: the held ask price is released to them. */
export const YES_STATUSES: RequestStatus[] = [
  "DEAL_AGREED",
  "APPROVED_IN_PRINCIPLE",
  "AGREEMENT_MODE_PENDING",
  "LEGAL_AGREEMENT_PENDING",
  "APPROVED",
];
/** The request ended without a yes: the held ask price is refunded. */
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
 * Settle a request's held ask price according to where the request now
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
  const amount = fmtMoney(entry.amount.toString(), entry.currency);

  if (outcome === "release") {
    const moved = await db.earningEntry.updateMany({ where: { id: entry.id, status: "HELD" }, data: { status: "PENDING" } });
    if (moved.count === 0) return "none";
    await notifyConsenterTeam(request.consenterId, {
      title: `${amount} is yours`,
      body: `${request.requester.displayName}'s ask price for request #${request.number}. It goes out in your next Friday payout.`,
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
      amount: payment.amount.toString(),
      currency: payment.currency,
      reason,
    });
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", refundedAt: new Date(), refundRef },
    });
    await db.requestEvent.create({
      data: { requestId, type: "consent_price_refunded", actorSide: "system", detail: { amount: entry.amount.toString(), currency: entry.currency } },
    });
    await notifyRequesterTeam(request.requesterId, {
      title: `${amount} refunded`,
      body: `${request.consenter.displayName}'s ask price for request #${request.number} came back to you because the request ${ENDING[request.status] ?? "ended without a yes"}. The platform fee isn't refunded.`,
      href: "/r-panel/billing",
    });
    return "refund";
  }
  return "hold";
}

/** Sweep: settle every held ask price whose request already has an outcome. */
export async function escrowSweep(): Promise<number> {
  const held = await db.earningEntry.findMany({
    where: { status: "HELD", request: { status: { in: [...YES_STATUSES, ...NO_STATUSES] } } },
    select: { requestId: true },
  });
  let moved = 0;
  for (const h of held) if ((await syncConsentPrice(h.requestId)) !== "none") moved++;
  return moved;
}
