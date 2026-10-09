import "server-only";
import { db } from "./db";
import { getSettings } from "./settings";

const clamp = (n: number) => Math.max(0, Math.min(1000, Math.round(n)));

/** Recalculates a requester's Consent Score from events; logs the change. */
export async function recalcRequesterScore(requesterId: string, reason = "Recalculation") {
  const s = (await getSettings()).score;
  const w = s.requester;
  const r = await db.requesterProfile.findUnique({ where: { id: requesterId } });
  if (!r) return;

  const [approved, decided, upheld, revoked, ignoredTakedowns, changesReq] = await Promise.all([
    db.consentRequest.count({ where: { requesterId, status: "APPROVED" } }),
    db.consentRequest.count({
      where: { requesterId, status: { in: ["APPROVED", "DENIED", "CLOSED"] } },
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

  const newScore = clamp(score);
  if (newScore !== r.score) {
    await db.$transaction([
      db.requesterProfile.update({ where: { id: requesterId }, data: { score: newScore } }),
      db.scoreLog.create({
        data: { requesterId, oldScore: r.score, newScore, reason },
      }),
    ]);
  }
}

/** Recalculates a consenter's Consent Score from events; logs the change. */
export async function recalcConsenterScore(consenterId: string, reason = "Recalculation") {
  const s = (await getSettings()).score;
  const w = s.consenter;
  const c = await db.consenterProfile.findUnique({ where: { id: consenterId } });
  if (!c) return;

  const [answered, unanswered, pendingTakedowns, upheld, matrixCount, responseTimes] =
    await Promise.all([
      db.consentRequest.count({
        where: { consenterId, decidedAt: { not: null } },
      }),
      db.consentRequest.count({ where: { consenterId, status: "EXPIRED_NO_RESPONSE" } }),
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

  const newScore = clamp(score);
  if (newScore !== c.score) {
    await db.$transaction([
      db.consenterProfile.update({ where: { id: consenterId }, data: { score: newScore } }),
      db.scoreLog.create({
        data: { consenterId, oldScore: c.score, newScore, reason },
      }),
    ]);
  }
}
