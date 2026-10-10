import { db } from "./db";
import { getSettings } from "./settings";
import { notifyConsenterTeam, notifyRequesterTeam } from "./notify";
import { recalcConsenterScore, recalcRequesterScore } from "./score";
import { syncConsentPrice, escrowSweep } from "./escrow";

/**
 * Background sweeps (DB-backed scheduler). Run periodically by:
 *  - `npm run jobs` (worker loop), or
 *  - POST /api/jobs/tick (cron-friendly), or
 *  - the admin panel "Run jobs now" button.
 * Each sweep is idempotent.
 */
export async function runSweeps(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.slaReminders = await slaReminders();
  out.slaExpired = await slaExpire();
  out.negotiationIdle = await negotiationIdleClose();
  out.grantExpiryNotices = await grantExpiryNotices();
  out.grantsExpired = await grantExpire();
  out.takedownsIgnored = await takedownIgnored();
  out.subscriptionReminders = await subscriptionReminders();
  // Settle held ask prices first so anything released this run is paid out.
  out.askPricesSettled = await escrowSweep();
  out.settlements = await settlementSweep();
  return out;
}

/**
 * Weekly settlements: for each consenter with pending consent-price earnings
 * whose last settlement is at least 7 days old (or who has never been
 * settled), batch all pending earnings per currency into one settlement and
 * mark them paid out. Payout itself is the mock provider in dev.
 */
async function settlementSweep(): Promise<number> {
  const pending = await db.earningEntry.groupBy({
    by: ["consenterId", "currency"],
    where: { status: "PENDING" },
    _sum: { amount: true },
    _min: { createdAt: true },
  });
  let created = 0;
  for (const group of pending) {
    const last = await db.settlement.findFirst({
      where: { consenterId: group.consenterId },
      orderBy: { createdAt: "desc" },
    });
    const weekMs = 7 * 86400_000;
    const anchor = last?.createdAt ?? group._min.createdAt!;
    if (Date.now() - anchor.getTime() < weekMs) continue;

    const entries = await db.earningEntry.findMany({
      where: { consenterId: group.consenterId, currency: group.currency, status: "PENDING" },
    });
    if (entries.length === 0) continue;
    const amount = entries.reduce((a, e) => a + Number(e.amount), 0);
    const settlement = await db.settlement.create({
      data: {
        consenterId: group.consenterId,
        amount: amount.toFixed(2),
        currency: group.currency,
        periodStart: anchor,
        periodEnd: new Date(),
        reference: `SETTLE-${group.consenterId.slice(-6).toUpperCase()}-${entries.length}x`,
      },
    });
    await db.earningEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { status: "SETTLED", settlementId: settlement.id },
    });
    await notifyConsenterTeam(group.consenterId, {
      title: `Weekly settlement: ${group.currency} ${amount.toFixed(2)} paid out`,
      body: `${entries.length} consent-price earning${entries.length > 1 ? "s" : ""} settled (ref ${settlement.reference}). Track details under Earnings.`,
      href: "/c-panel/earnings",
    });
    created++;
  }
  return created;
}

async function slaReminders(): Promise<number> {
  const settings = await getSettings();
  const windowMs = settings.slaDays * 86400_000;
  const pending = await db.consentRequest.findMany({
    where: { status: "PENDING", slaExpiresAt: { not: null } },
    include: { requester: true },
  });
  let n = 0;
  for (const r of pending) {
    const elapsed = Date.now() - (r.slaExpiresAt!.getTime() - windowMs);
    const frac = elapsed / windowMs;
    if (frac >= 0.9 && !r.reminder90Sent) {
      await db.consentRequest.update({ where: { id: r.id }, data: { reminder90Sent: true, reminder50Sent: true } });
      await notifyConsenterTeam(r.consenterId, {
        title: `Request #${r.number} about to expire`,
        body: `The request from ${r.requester.displayName} expires very soon. Unanswered requests lower your Consent Score.`,
        href: `/c-panel/requests/${r.id}`,
        critical: true,
      });
      n++;
    } else if (frac >= 0.5 && !r.reminder50Sent) {
      await db.consentRequest.update({ where: { id: r.id }, data: { reminder50Sent: true } });
      await notifyConsenterTeam(r.consenterId, {
        title: `Request #${r.number} awaiting your response`,
        body: `Half of the response window for the request from ${r.requester.displayName} has passed.`,
        href: `/c-panel/requests/${r.id}`,
      });
      n++;
    }
  }
  return n;
}

async function slaExpire(): Promise<number> {
  const expired = await db.consentRequest.findMany({
    where: { status: "PENDING", slaExpiresAt: { lt: new Date() } },
    include: { requester: true, consenter: true },
  });
  for (const r of expired) {
    await db.$transaction([
      db.consentRequest.update({
        where: { id: r.id },
        data: { status: "EXPIRED_NO_RESPONSE" },
      }),
      db.requestEvent.create({
        data: {
          requestId: r.id,
          type: "auto_expired",
          actorSide: "system",
          detail: { feeForfeited: true },
        },
      }),
      // Per-request fee is forfeited — no refund, no credit.
      db.payment.updateMany({
        where: { requestId: r.id, status: "PAID", purpose: "PER_REQUEST" },
        data: { status: "FORFEITED" },
      }),
    ]);
    // No reward for silence: the held ask price goes back to the requester.
    await syncConsentPrice(r.id);
    await notifyRequesterTeam(r.requesterId, {
      title: `Request #${r.number} expired unanswered`,
      body: `${r.consenter.displayName} did not respond within the window. Their ask price is refunded to you; the platform fee is not. You can raise a new request any time.`,
      href: `/r-panel/requests/${r.id}`,
    });
    await recalcConsenterScore(r.consenterId, `Request #${r.number} auto-expired unanswered`);
  }
  return expired.length;
}

async function negotiationIdleClose(): Promise<number> {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - settings.negotiationIdleDays * 86400_000);
  const idle = await db.consentRequest.findMany({
    where: { status: "IN_NEGOTIATION", lastOfferAt: { lt: cutoff } },
    include: { offers: { orderBy: { version: "desc" }, take: 1 } },
  });
  for (const r of idle) {
    const lastSide = r.offers[0]?.bySide ?? "consenter";
    const idleSide = lastSide === "consenter" ? "requester" : "consenter";
    await db.$transaction([
      db.consentRequest.update({
        where: { id: r.id },
        data: { status: "CLOSED", closedReason: `Negotiation idle; ${idleSide} failed to respond` },
      }),
      db.requestEvent.create({
        data: { requestId: r.id, type: "negotiation_auto_closed", actorSide: "system", detail: { idleSide } },
      }),
    ]);
    await syncConsentPrice(r.id);
  }
  return idle.length;
}

async function grantExpiryNotices(): Promise<number> {
  const soon = new Date(Date.now() + 7 * 86400_000);
  const grants = await db.grant.findMany({
    where: { status: "ACTIVE", expiryNotified: false, validUntil: { not: null, lte: soon, gt: new Date() } },
    include: { request: { include: { consenter: true, requester: true } } },
  });
  for (const g of grants) {
    await db.grant.update({ where: { id: g.id }, data: { expiryNotified: true } });
    const msg = {
      title: `Grant ${g.publicId} expires in under 7 days`,
      body: `Consent between ${g.request.consenter.displayName} and ${g.request.requester.displayName} expires on ${g.validUntil!.toDateString()}.`,
    };
    await notifyConsenterTeam(g.request.consenterId, { ...msg, href: `/c-panel/requests/${g.requestId}` });
    await notifyRequesterTeam(g.request.requesterId, { ...msg, href: `/r-panel/requests/${g.requestId}` });
  }
  return grants.length;
}

async function grantExpire(): Promise<number> {
  const res = await db.grant.updateMany({
    where: { status: "ACTIVE", validUntil: { not: null, lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return res.count;
}

async function takedownIgnored(): Promise<number> {
  const overdue = await db.takedownRequest.findMany({
    where: { status: "RAISED", respondBy: { lt: new Date() } },
    include: { grant: { include: { request: true } } },
  });
  for (const t of overdue) {
    await db.takedownRequest.update({ where: { id: t.id }, data: { status: "IGNORED" } });
    await db.requestEvent.create({
      data: { requestId: t.grant.requestId, type: "takedown_ignored", actorSide: "system" },
    });
    await recalcRequesterScore(t.grant.request.requesterId, "Takedown request ignored");
  }
  return overdue.length;
}

async function subscriptionReminders(): Promise<number> {
  let n = 0;
  for (const days of [30, 7, 1]) {
    const from = new Date(Date.now() + (days - 0.5) * 86400_000);
    const to = new Date(Date.now() + (days + 0.5) * 86400_000);
    const expiring = await db.requesterProfile.findMany({
      where: { status: "APPROVED", subscriptionEndsAt: { gte: from, lte: to } },
    });
    for (const r of expiring) {
      await notifyRequesterTeam(r.id, {
        title: `Subscription renews in ${days} day${days > 1 ? "s" : ""}`,
        body: "Renew your yearly subscription to keep sending consent requests. Lapsed accounts keep read access to past grants and certificates.",
        href: "/r-panel/billing",
      });
      n++;
    }
  }
  return n;
}
