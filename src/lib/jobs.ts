import type { RequestStatus } from "@prisma/client";
import { db } from "./db";
import { getSettings } from "./settings";
import { notifyConsenterTeam, notifyRequesterTeam, notifySide } from "./notify";
import { recalcConsenterScore, recalcRequesterScore } from "./score";
import { syncConsentPrice, escrowSweep, YES_STATUSES } from "./escrow";
import { fmtUtc, noYesRefundNote, sentences } from "./requests";
import { issueGrant } from "./grants";
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
  // First: a yes whose final file is already there gets its certificate
  // before the window sweep could close it as "no final file".
  out.certificatesIssued = await issueWaitingCertificates();
  const windows = await requestWindowSweep();
  out.windowReminders = windows.reminded;
  out.expiredUnanswered = windows.expired;
  out.closedInactive = windows.closed;
  out.grantExpiryNotices = await grantExpiryNotices();
  out.grantsExpired = await grantExpire();
  out.takedownsIgnored = await takedownIgnored();
  out.membershipReminders = await membershipReminders();
  // Settle held consent request fees first so anything released this run is paid out.
  out.consentFeesSettled = await escrowSweep();
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
// its last action from either side. If it was the owner's move (waiting for
// their answer), it expires unanswered and counts against their Consent Score.
// If it was the asker's move (answering a question, uploading the final
// file), it closes. One "about to expire" reminder per window goes to
// whoever's move it is.

/** The reminder goes out once per window, when less than this is left. */
export const REMIND_BEFORE_MS = 48 * 3600_000;

export type WindowStep =
  /** The owner's move and the window ran out: expired unanswered. */
  | { kind: "expire" }
  /** The asker's move and the window ran out: closed for inactivity. */
  | { kind: "close"; waiting: Side }
  /** Under 48 hours left and no reminder yet in this window. */
  | { kind: "remind"; waiting: Side }
  | { kind: "none" };

/** Pure: what the sweep does with one open request right now. */
export function windowStep(
  r: {
    status: RequestStatus;
    lastActivityAt: Date;
    expiresAt: Date;
    remindedAt: Date | null;
  },
  now = new Date(),
): WindowStep {
  const waiting = waitingOn(r.status);
  if (!waiting) return { kind: "none" };
  if (now.getTime() >= r.expiresAt.getTime()) return waiting === "consenter" ? { kind: "expire" } : { kind: "close", waiting };
  const remindedThisWindow = !!r.remindedAt && r.remindedAt.getTime() >= r.lastActivityAt.getTime();
  if (r.expiresAt.getTime() - now.getTime() <= REMIND_BEFORE_MS && !remindedThisWindow) return { kind: "remind", waiting };
  return { kind: "none" };
}

type OpenRequest = Awaited<ReturnType<typeof openRequests>>[number];

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
      const step = windowStep({ status: r.status, ...w, remindedAt: r.remindedAt }, now);
      if (step.kind === "remind") {
        await remindExpiring(r, w.expiresAt, step.waiting, now);
        done.reminded++;
      } else if (step.kind === "expire" || step.kind === "close") {
        // Someone may have acted since this batch was read: check the window once more.
        const fresh = (await requestWindows([r], slaDays)).get(r.id);
        if (!fresh || fresh.expiresAt.getTime() > Date.now()) continue;
        if (step.kind === "expire" ? await expireUnanswered(r, slaDays) : await closeInactive(r, slaDays)) {
          done[step.kind === "expire" ? "expired" : "closed"]++;
        }
      }
    }
  }
  return done;
}

const titleFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the asker has to do next, for reminders and closing notices. */
function askerMove(status: RequestStatus): string {
  return status === "APPROVED_IN_PRINCIPLE" ? "upload the final content file" : "answer the question";
}

async function remindExpiring(r: OpenRequest, expiresAt: Date, waiting: Side, now: Date) {
  await db.consentRequest.update({ where: { id: r.id }, data: { remindedAt: now } });
  const when = fmtUtc(expiresAt);
  await notifySide(waiting, r, {
    title: `Request #${r.number} expires soon`,
    body:
      waiting === "requester"
        ? `Your request to ${r.consenter.displayName} closes ${when} unless you act. ${titleFirst(askerMove(r.status))} to keep it open.`
        : `The request from ${r.requester.displayName} expires ${when}. Answer it to keep it open. Unanswered requests lower your Consent Score.`,
    critical: true,
  });
}

/** Whether a consent request fee was paid for this request (false for a free request). */
async function consentFeePaid(requestId: string): Promise<boolean> {
  const n = await db.payment.count({
    where: { requestId, purpose: "CONSENT_PRICE", status: { in: ["PAID", "REFUNDED"] } },
  });
  return n > 0;
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
  // No reward for silence: 80% of the held consent request fee goes back to the asker.
  await syncConsentPrice(r.id);
  await notifyRequesterTeam(r.requesterId, {
    title: `Request #${r.number} expired unanswered`,
    body: sentences(
      `${r.consenter.displayName} did not respond within the window.`,
      await noYesRefundNote(r.id, r.consenter.displayName),
      "You can send a new request any time.",
    ),
    href: `/r-panel/requests/${r.id}`,
  });
  await notifyConsenterTeam(r.consenterId, {
    title: `Request #${r.number} expired unanswered`,
    body: `Nobody answered the request from ${r.requester.displayName} for ${days} days, so it expired. Unanswered requests lower your Consent Score.`,
    href: `/c-panel/requests/${r.id}`,
  });
  await recalcConsenterScore(r.consenterId, `Request #${r.number} auto-expired unanswered`);
  return true;
}

/** The asker's move ran out: the request closes. */
async function closeInactive(r: OpenRequest, days: number): Promise<boolean> {
  // A yes whose final file is already uploaded isn't idle: it is owed its
  // certificate, never a "you didn't upload the final file" closing.
  if (r.status === "APPROVED_IN_PRINCIPLE") {
    const hasFinal = await db.storedFile.count({ where: { requestId: r.id, kind: "RAW_CONTENT" } });
    if (hasFinal > 0) {
      try {
        await issueGrant(r.id);
      } catch (e) {
        console.error(`Issuing the certificate for request ${r.id} failed`, e);
      }
      return false;
    }
  }
  const reason = `No action for ${days} days`;
  const moved = await db.$transaction(async (tx) => {
    const res = await tx.consentRequest.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: "CLOSED", closedReason: reason },
    });
    if (res.count === 0) return false;
    await tx.requestEvent.create({
      data: { requestId: r.id, type: "auto_closed", actorSide: "system", detail: { reason, days, waitingOn: "requester" } },
    });
    return true;
  });
  if (!moved) return false;
  // Closed before a yes: 80% of the held consent request fee is refunded (a released share stays with the owner).
  await syncConsentPrice(r.id);
  // After a yes (waiting for the final file) the owner's share was already released.
  const saidYes = YES_STATUSES.includes(r.status);
  const paid = await consentFeePaid(r.id);
  const owner = r.consenter.displayName;
  const asker = r.requester.displayName;
  const move = askerMove(r.status);
  await notifyRequesterTeam(r.requesterId, {
    title: `Request #${r.number} closed`,
    body: sentences(
      `You didn't ${move} within ${days} days, so the request closed.`,
      saidYes
        ? paid && `${owner} had already said yes, so the consent request fee and the platform fee aren't refunded.`
        : await noYesRefundNote(r.id, owner),
      "You can send a new request any time.",
    ),
    href: `/r-panel/requests/${r.id}`,
  });
  await notifyConsenterTeam(r.consenterId, {
    title: `Request #${r.number} closed`,
    body: sentences(
      `${asker} didn't ${move} within ${days} days, so the request closed.`,
      paid &&
        (saidYes
          ? "You had already said yes, so your 80% of the consent request fee stays yours."
          : "80% of the consent request fee they paid goes back to them; Consent keeps 20%."),
    ),
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

/**
 * A yes waiting for the final file whose file is already there gets its
 * certificate. Uploading the file normally issues it at once; this catches
 * anything that missed that (for example requests moved here by a migration).
 */
async function issueWaitingCertificates(): Promise<number> {
  const waiting = await db.consentRequest.findMany({
    where: { status: "APPROVED_IN_PRINCIPLE", grant: { is: null }, files: { some: { kind: "RAW_CONTENT" } } },
    select: { id: true },
    take: 200,
  });
  let issued = 0;
  for (const r of waiting) {
    try {
      await issueGrant(r.id);
      issued++;
    } catch (e) {
      console.error(`Issuing the certificate for request ${r.id} failed`, e);
    }
  }
  return issued;
}

/** How far back a membership reminder counts as already sent for its threshold. */
const REMINDED_WITHIN_MS = 2 * 86400_000;

/**
 * Membership renewal reminders (30, 7 and 1 days ahead), each sent once per
 * profile: the sweep runs every minute and a profile sits in a threshold's
 * window for a day, so a reminder a member of the profile already got in the
 * last 2 days isn't sent again. Only while the admin has the membership fee
 * switched on; it is free for now.
 */
async function membershipReminders(): Promise<number> {
  const { membershipFeeOn } = await getSettings();
  if (!membershipFeeOn) return 0;
  let n = 0;
  const now = Date.now();
  for (const days of [30, 7, 1]) {
    const from = new Date(now + (days - 0.5) * 86400_000);
    const to = new Date(now + (days + 0.5) * 86400_000);
    const expiring = await db.requesterProfile.findMany({
      where: { status: "APPROVED", membershipEndsAt: { gte: from, lte: to } },
      select: { id: true, displayName: true },
    });
    for (const r of expiring) {
      // Named, so someone on two profiles' teams gets each profile's reminder.
      const title = `Membership for ${r.displayName} ends in ${days} day${days > 1 ? "s" : ""}`;
      const sent = await db.notification.findFirst({
        where: {
          title,
          createdAt: { gte: new Date(now - REMINDED_WITHIN_MS) },
          user: { requesterMembers: { some: { requesterId: r.id } } },
        },
        select: { id: true },
      });
      if (sent) continue;
      await notifyRequesterTeam(r.id, {
        title,
        body: "Renew the yearly membership to keep sending consent requests. You can still receive requests and see your certificates without it.",
        href: "/r-panel/billing",
      });
      n++;
    }
  }
  return n;
}
