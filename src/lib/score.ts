import { db } from "./db";
import { getSettings } from "./settings";

const clamp = (n: number) => Math.max(0, Math.min(1000, Math.round(n)));

/**
 * Net effect of every admin correction on a profile (the sum of manual
 * score-log deltas). Added on each recalculation, so a correction survives the
 * next grant, report or sweep instead of being silently overwritten.
 */
async function manualOffset(where: { requesterId: string } | { consenterId: string }): Promise<number> {
  const rows = await db.scoreLog.findMany({
    where: { ...where, adjustedById: { not: null } },
    select: { oldScore: true, newScore: true },
  });
  return rows.reduce((sum, r) => sum + (r.newScore - r.oldScore), 0);
}

/**
 * The score before clamping to 0–1000: the formula plus every admin correction.
 * A manual adjustment logs this as its old score, so its delta is exactly the
 * offset that lands the next recalculation on the admin's number, even when the
 * formula sits below 0 or the stored score is stale (account age, new weights).
 */
export async function unclampedScore(kind: "requester" | "consenter", id: string): Promise<number | null> {
  if (kind === "consenter") {
    const c = await db.consenterProfile.findUnique({ where: { id }, select: { id: true } });
    return c ? Math.round(await consenterRawScore(c.id)) : null;
  }
  const r = await db.requesterProfile.findUnique({ where: { id }, select: { id: true, createdAt: true } });
  return r ? Math.round(await requesterRawScore(r)) : null;
}

async function requesterRawScore(r: { id: string; createdAt: Date }): Promise<number> {
  const s = (await getSettings()).score;
  const w = s.requester;
  const requesterId = r.id;

  const [approved, decided, upheld, revoked, ignoredTakedowns, changesReq] = await Promise.all([
    db.consentRequest.count({ where: { requesterId, status: "APPROVED" } }),
    db.consentRequest.count({
      // A request Consent closed itself is nobody's outcome, so it doesn't count.
      where: { requesterId, status: { in: ["APPROVED", "DENIED", "CLOSED"] }, events: { none: { type: "closed_by_consent" } } },
    }),
    db.report.count({
      where: { request: { requesterId }, bySide: "consenter", status: "UPHELD" },
    }),
    db.grant.count({ where: { request: { requesterId }, status: "REVOKED" } }),
    db.takedownRequest.count({
      where: { grant: { request: { requesterId } }, status: { in: ["IGNORED", "DECLINED"] } },
    }),
    db.requestEvent.count({ where: { request: { requesterId }, type: "changes_requested" } }),
  ]);

  const ageDays = (Date.now() - r.createdAt.getTime()) / 86400_000;
  let score = s.base;
  score += Math.min(w.accountAgeMax, ageDays / 10);
  score += Math.min(200, approved * w.perApprovedGrant);
  if (decided > 0) score += (approved / decided) * w.approvalRatioMax;
  score -= upheld * w.upheldReportPenalty;
  score -= revoked * w.revocationPenalty;
  score -= ignoredTakedowns * w.takedownIgnoredPenalty;
  score -= changesReq * w.changesRequestedPenalty;
  score += await manualOffset({ requesterId });
  return score;
}

/** Recalculates a requester's Consent Score from events; logs the change. */
export async function recalcRequesterScore(requesterId: string, reason = "Recalculation") {
  const r = await db.requesterProfile.findUnique({ where: { id: requesterId } });
  if (!r) return;

  const newScore = clamp(await requesterRawScore(r));
  if (newScore !== r.score) {
    await db.$transaction([
      db.requesterProfile.update({ where: { id: requesterId }, data: { score: newScore } }),
      db.scoreLog.create({
        data: { requesterId, oldScore: r.score, newScore, reason },
      }),
    ]);
  }
}

async function consenterRawScore(consenterId: string): Promise<number> {
  const s = (await getSettings()).score;
  const w = s.consenter;

  const [answered, unanswered, pendingTakedowns, upheld, matrixCount, responseTimes] =
    await Promise.all([
      db.consentRequest.count({
        where: { consenterId, decidedAt: { not: null } },
      }),
      // Only the SLA job's expiries count as unanswered. Older admin force-expiries
      // reused this status and are not the owner's silence.
      db.consentRequest.count({
        where: { consenterId, status: "EXPIRED_NO_RESPONSE", events: { none: { type: "admin_force_expired" } } },
      }),
      db.takedownRequest.count({
        where: { grant: { request: { consenterId } }, status: "MARKED_DOWN" },
      }),
      db.report.count({
        where: { request: { consenterId }, bySide: "requester", status: "UPHELD" },
      }),
      db.consentMatrixEntry.count({ where: { consenterId } }),
      db.consentRequest.findMany({
        where: { consenterId, decidedAt: { not: null }, submittedAt: { not: null } },
        select: { submittedAt: true, decidedAt: true },
        take: 200,
        orderBy: { decidedAt: "desc" },
      }),
    ]);

  let score = s.base;
  const total = answered + unanswered;
  if (total > 0) score += (answered / total) * w.responseRateMax;
  score -= unanswered * w.unansweredPenalty;
  score -= pendingTakedowns * w.pendingTakedownPenalty;
  score -= upheld * w.upheldReportPenalty;
  score += Math.min(w.profileCompletenessMax, matrixCount);
  if (responseTimes.length > 0) {
    const hours = responseTimes
      .map((r) => (r.decidedAt!.getTime() - r.submittedAt!.getTime()) / 3600_000)
      .sort((a, b) => a - b);
    const median = hours[Math.floor(hours.length / 2)];
    // full bonus under 12h, fading to 0 at 7 days
    score += Math.max(0, w.fastResponseMax * (1 - Math.min(1, Math.max(0, median - 12) / 156)));
  }
  score += await manualOffset({ consenterId });
  return score;
}

/** Recalculates a consenter's Consent Score from events; logs the change. */
export async function recalcConsenterScore(consenterId: string, reason = "Recalculation") {
  const c = await db.consenterProfile.findUnique({ where: { id: consenterId } });
  if (!c) return;

  const newScore = clamp(await consenterRawScore(consenterId));
  if (newScore !== c.score) {
    await db.$transaction([
      db.consenterProfile.update({ where: { id: consenterId }, data: { score: newScore } }),
      db.scoreLog.create({
        data: { consenterId, oldScore: c.score, newScore, reason },
      }),
    ]);
  }
}
