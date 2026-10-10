import type { RequestStatus } from "@prisma/client";
import { db } from "./db";
import { getSettings } from "./settings";
import { notifyConsenterTeam, notifyRequesterTeam, notifySide } from "./notify";
import { recalcConsenterScore, recalcRequesterScore } from "./score";
import { syncConsentPrice, escrowSweep, YES_STATUSES } from "./escrow";
import { fmtUtc, noYesRefundNote } from "./requests";
import { OPEN_STATUSES, requestWindows, waitingOn, type Side } from "./request-window";

/**
 * Background sweeps (DB-backed scheduler). Run periodically by:
 *  - `npm run jobs` (worker loop), or
 *  - POST /api/jobs/tick (cron-friendly), or
 *  - the admin panel "Run jobs now" button.
 * Each sweep is idempotent.
 */
export async function runSweeps(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const windows = await requestWindowSweep();
  out.windowReminders = windows.reminded;
  out.expiredUnanswered = windows.expired;
  out.closedInactive = windows.closed;
  out.grantExpiryNotices = await grantExpiryNotices();
  out.grantsExpired = await grantExpire();
  out.takedownsIgnored = await takedownIgnored();
  out.subscriptionReminders = await subscriptionReminders();
  // Settle held consent request fees first so anything released this run is paid out.
  out.askPricesSettled = await escrowSweep();
  out.settlements = await settlementSweep();
  return out;
}

/**
 * Weekly settlements, on Fridays: for each consenter with pending earnings
 * (their 80% of consent request fees) who hasn't been paid out yet this week
 * (since last Saturday), batch all pending earnings per currency into one
 * settlement and mark them paid out. This is the day nextPayoutDay() shows
 * owners. Payout itself is the mock provider in dev.
 */
async function settlementSweep(): Promise<number> {
  const now = new Date();
  if (now.getDay() !== 5) return 0; // payouts go out on Fridays
  // Start of this payout week: last Saturday, 00:00. One payout per week.
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);

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
    if (last && last.createdAt >= weekStart) continue; // already paid out this week
    const anchor = last?.createdAt ?? group._min.createdAt!;

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
        periodEnd: now,
        reference: `SETTLE-${group.consenterId.slice(-6).toUpperCase()}-${entries.length}x`,
      },
    });
    await db.earningEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { status: "SETTLED", settlementId: settlement.id },
    });
    await notifyConsenterTeam(group.consenterId, {
      title: `Weekly settlement: ${group.currency} ${amount.toFixed(2)} paid out`,
      body: `Your 80% of ${entries.length} consent request fee${entries.length > 1 ? "s" : ""} (ref ${settlement.reference}). Track details under Earnings.`,
      href: "/c-panel/earnings",
    });
    created++;
  }
  return created;
}

// ── The request window ────────────────────────────────────────
// Every open request expires a fixed number of days (Admin → settings) after
// its last action from either side. If it was the owner's move, it expires
// unanswered and counts against their Consent Score; otherwise it closes.
// One "about to expire" reminder per window goes to whoever's move it is.

/** The reminder goes out once per window, when less than this is left. */
export const REMIND_BEFORE_MS = 48 * 3600_000;

export type WindowStep =
  /** The owner's move and the window ran out: expired unanswered. */
  | { kind: "expire" }
  /** Anyone else's move and the window ran out: closed for inactivity. */
  | { kind: "close"; waiting: Side | "either" }
  /** Under 48 hours left and no reminder yet in this window. */
  | { kind: "remind"; waiting: Side | "either" }
  | { kind: "none" };

/** Pure: what the sweep does with one open request right now. */
export function windowStep(
  r: {
    status: RequestStatus;
    latestOpenOfferBy?: string | null;
    lastActivityAt: Date;
    expiresAt: Date;
    remindedAt: Date | null;
  },
  now = new Date(),
): WindowStep {
  const waiting = waitingOn(r.status, r.latestOpenOfferBy);
  if (now.getTime() >= r.expiresAt.getTime()) return waiting === "consenter" ? { kind: "expire" } : { kind: "close", waiting };
  const remindedThisWindow = !!r.remindedAt && r.remindedAt.getTime() >= r.lastActivityAt.getTime();
  if (r.expiresAt.getTime() - now.getTime() <= REMIND_BEFORE_MS && !remindedThisWindow) return { kind: "remind", waiting };
  return { kind: "none" };
}

/** Who gets told: one side, or both when either can move. */
const sidesFor = (w: Side | "either"): Side[] => (w === "either" ? ["consenter", "requester"] : [w]);

type OpenRequest = Awaited<ReturnType<typeof openRequests>>[number];

/**
 * A meeting still ahead on a request that just ended stays in both calendars:
 * say so, so no one turns up to it without knowing. Empty when there's none.
 */
async function upcomingMeetingNote(requestId: string): Promise<string> {
  const m = await db.requestMeeting.findFirst({
    where: { requestId, status: "SCHEDULED", endsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    select: { startsAt: true },
  });
  return m
    ? ` Your meeting on ${fmtUtc(m.startsAt)} is still in your calendar. Cancel it from the request page if you no longer need it.`
    : "";
}

/** Open requests in id order, a page at a time (requests this sweep ends drop out of the filter). */
function openRequests(take: number, after?: string) {
  return db.consentRequest.findMany({
    where: { status: { in: OPEN_STATUSES }, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" },
    take,
    select: {
      id: true,
      number: true,
      status: true,
      submittedAt: true,
      createdAt: true,
      consenterId: true,
      requesterId: true,
      slaExpiresAt: true,
      remindedAt: true,
      consenter: { select: { displayName: true } },
      requester: { select: { displayName: true } },
      offers: { where: { status: "OPEN" }, orderBy: { version: "desc" }, take: 1, select: { bySide: true } },
    },
  });
}

async function requestWindowSweep() {
  const { slaDays } = await getSettings();
  const now = new Date();
  const done = { reminded: 0, expired: 0, closed: 0 };
  let cursor: string | undefined;
  for (;;) {
    const batch = await openRequests(500, cursor);
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    const windows = await requestWindows(batch, slaDays);
    for (const r of batch) {
      const w = windows.get(r.id);
      if (!w) continue;
      // Keep the stored expiry current so lists can show and sort by it.
      if (r.slaExpiresAt?.getTime() !== w.expiresAt.getTime()) {
        await db.consentRequest.update({ where: { id: r.id }, data: { slaExpiresAt: w.expiresAt } });
      }
      const step = windowStep(
        { status: r.status, latestOpenOfferBy: r.offers[0]?.bySide, ...w, remindedAt: r.remindedAt },
        now,
      );
      if (step.kind === "remind") {
        await remindExpiring(r, w.expiresAt, step.waiting, now);
        done.reminded++;
      } else if (step.kind === "expire" || step.kind === "close") {
        // Someone may have acted since this batch was read: check the window once more.
        const fresh = (await requestWindows([r], slaDays)).get(r.id);
        if (!fresh || fresh.expiresAt.getTime() > Date.now()) continue;
        if (step.kind === "expire" ? await expireUnanswered(r, slaDays) : await closeInactive(r, slaDays, step.waiting)) {
          done[step.kind === "expire" ? "expired" : "closed"]++;
        }
      }
    }
  }
  return done;
}

async function remindExpiring(r: OpenRequest, expiresAt: Date, waiting: Side | "either", now: Date) {
  await db.consentRequest.update({ where: { id: r.id }, data: { remindedAt: now } });
  const when = fmtUtc(expiresAt);
  for (const side of sidesFor(waiting)) {
    await notifySide(side, r, {
      title: `Request #${r.number} expires soon`,
      body:
        side === "requester"
          ? `Your request to ${r.consenter.displayName} expires ${when} unless someone acts. Take your next step to keep it open.`
          : `The request from ${r.requester.displayName} expires ${when} unless someone acts. ${
              waiting === "consenter"
                ? "Answer it to keep it open. Unanswered requests lower your Consent Score."
                : "Take your next step to keep it open."
            }`,
      critical: true,
    });
  }
}

/** The owner's move ran out: expired unanswered. The platform fee is forfeited; 80% of a consent request fee goes back. */
async function expireUnanswered(r: OpenRequest, days: number): Promise<boolean> {
  const moved = await db.$transaction(async (tx) => {
    const res = await tx.consentRequest.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: "EXPIRED_NO_RESPONSE" },
    });
    if (res.count === 0) return false;
    await tx.requestEvent.create({
      data: { requestId: r.id, type: "auto_expired", actorSide: "system", detail: { feeForfeited: true, days } },
    });
    // The platform fee is forfeited — no refund, no credit.
    await tx.payment.updateMany({
      where: { requestId: r.id, status: "PAID", purpose: "PER_REQUEST" },
      data: { status: "FORFEITED" },
    });
    return true;
  });
  if (!moved) return false;
  // No reward for silence: 80% of the held consent request fee goes back to the requester.
  await syncConsentPrice(r.id);
  const meeting = await upcomingMeetingNote(r.id);
  await notifyRequesterTeam(r.requesterId, {
    title: `Request #${r.number} expired unanswered`,
    body: `${r.consenter.displayName} did not respond within the window. ${await noYesRefundNote(r.id, r.consenter.displayName)} You can raise a new request any time.${meeting}`,
    href: `/r-panel/requests/${r.id}`,
  });
  await notifyConsenterTeam(r.consenterId, {
    title: `Request #${r.number} expired unanswered`,
    body: `Nobody answered the request from ${r.requester.displayName} for ${days} days, so it expired. Unanswered requests lower your Consent Score.${meeting}`,
    href: `/c-panel/requests/${r.id}`,
  });
  await recalcConsenterScore(r.consenterId, `Request #${r.number} auto-expired unanswered`);
  return true;
}

/** Anyone else's move ran out: the request closes. */
async function closeInactive(r: OpenRequest, days: number, waiting: Side | "either"): Promise<boolean> {
  const reason = `No action for ${days} days`;
  const moved = await db.$transaction(async (tx) => {
    const res = await tx.consentRequest.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: "CLOSED", closedReason: reason },
    });
    if (res.count === 0) return false;
    await tx.requestEvent.create({
      data: { requestId: r.id, type: "auto_closed", actorSide: "system", detail: { reason, days, waitingOn: waiting } },
    });
    return true;
  });
  if (!moved) return false;
  // Closed before a yes: 80% of the held consent request fee is refunded (a released share stays with the owner).
  await syncConsentPrice(r.id);
  const saidYes = YES_STATUSES.includes(r.status);
  const owner = r.consenter.displayName;
  const meeting = await upcomingMeetingNote(r.id);
  await notifyRequesterTeam(r.requesterId, {
    title: `Request #${r.number} closed`,
    body: `No one acted for ${days} days, so the request closed. ${
      saidYes
        ? `${owner} had already said yes, so neither a consent request fee nor the platform fee is refunded.`
        : await noYesRefundNote(r.id, owner)
    } You can raise a new request any time.${meeting}`,
    href: `/r-panel/requests/${r.id}`,
  });
  await notifyConsenterTeam(r.consenterId, {
    title: `Request #${r.number} closed`,
    body: `No one acted on the request from ${r.requester.displayName} for ${days} days, so it closed. ${
      saidYes
        ? "You had already said yes, so your 80% of any consent request fee stays yours."
        : "80% of any consent request fee they paid goes back to them; Consent keeps 20%."
    }${meeting}`,
    href: `/c-panel/requests/${r.id}`,
  });
  return true;
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
