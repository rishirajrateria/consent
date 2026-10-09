import "server-only";
import { db } from "./db";
import { getSettings } from "./settings";
import { evaluateAutoDecision, type Selection } from "./rules";
import { issueGrant } from "./grants";
import { notifyConsenterTeam, notifyRequesterTeam, notifyUser } from "./notify";

/** Called when the per-request fee settles: submit + evaluate auto-decision. */
export async function onRequestPaid(requestId: string) {
  const request = await db.consentRequest.findUnique({
    where: { id: requestId },
    include: { requester: true, consenter: true, files: true },
  });
  if (!request || request.status !== "DRAFT") return;
  const settings = await getSettings();
  const now = new Date();
  const slaExpiresAt = new Date(now.getTime() + settings.slaDays * 86400_000);

  await db.consentRequest.update({
    where: { id: requestId },
    data: { status: "SUBMITTED", submittedAt: now, slaExpiresAt },
  });
  await db.requestEvent.create({
    data: { requestId, type: "submitted", actorSide: "requester", detail: { feePaid: true } },
  });

  const decision = await evaluateAutoDecision({
    consenterId: request.consenterId,
    requester: {
      id: request.requesterId,
      type: request.requester.type,
      score: request.requester.score,
      categories: request.requester.categories,
    },
    selections: request.selections as Selection[],
    assetTypeIds: request.assetTypeIds,
  });

  if (decision.kind === "rule" && decision.action === "AUTO_DENY") {
    await db.consentRequest.update({
      where: { id: requestId },
      data: {
        status: "DENIED",
        decidedAt: new Date(),
        decidedByRuleId: decision.ruleId,
        decidedByRuleName: decision.ruleName,
        denialReason: `Auto-denied by standing rule "${decision.ruleName}"`,
      },
    });
    await db.requestEvent.create({
      data: { requestId, type: "auto_denied", actorSide: "system", detail: { rule: decision.ruleName } },
    });
    await notifyRequesterTeam(request.requesterId, {
      title: `Request #${request.number} denied`,
      body: `${request.consenter.displayName} has a standing rule that declines this kind of request. The per-request fee is not refunded.`,
      href: `/r-panel/requests/${requestId}`,
    });
    return;
  }

  if (decision.kind === "matrix" && decision.policy === "AUTO_DENY") {
    await db.consentRequest.update({
      where: { id: requestId },
      data: {
        status: "DENIED",
        decidedAt: new Date(),
        decidedByRuleName: "Consent matrix default (Never allowed)",
        denialReason: "The consenter never allows this platform/format/asset combination.",
      },
    });
    await db.requestEvent.create({
      data: { requestId, type: "auto_denied", actorSide: "system", detail: { rule: "matrix" } },
    });
    await notifyRequesterTeam(request.requesterId, {
      title: `Request #${request.number} denied`,
      body: `${request.consenter.displayName} never allows this combination. The per-request fee is not refunded.`,
      href: `/r-panel/requests/${requestId}`,
    });
    return;
  }

  const autoApprove =
    (decision.kind === "rule" && decision.action === "AUTO_APPROVE") ||
    (decision.kind === "matrix" && decision.policy === "AUTO_APPROVE");

  if (autoApprove) {
    const ruleName =
      decision.kind === "rule"
        ? `${decision.ruleName} (set by ${decision.createdByName} on ${decision.createdAt.toISOString().slice(0, 10)})`
        : "Consent matrix default (Allowed without asking)";
    await db.consentRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED_IN_PRINCIPLE",
        decidedAt: new Date(),
        decidedByRuleId: decision.kind === "rule" ? decision.ruleId : null,
        decidedByRuleName: ruleName,
      },
    });
    await db.requestEvent.create({
      data: { requestId, type: "auto_approved", actorSide: "system", detail: { rule: ruleName } },
    });
    const hasRaw = request.files.some((f) => f.kind === "RAW_CONTENT");
    if (hasRaw) {
      await issueGrant(requestId, "Standing rule (automatic)");
    } else {
      await notifyRequesterTeam(request.requesterId, {
        title: `Request #${request.number} approved in principle`,
        body: "Upload the final content file to receive your certificate — approval is bound to the exact file hash.",
        href: `/r-panel/requests/${requestId}`,
      });
    }
    return;
  }

  // Route or plain pending
  await db.consentRequest.update({ where: { id: requestId }, data: { status: "PENDING" } });
  if (decision.kind === "rule" && decision.action === "ROUTE_TO_MEMBER" && decision.routeToUserId) {
    await db.requestEvent.create({
      data: { requestId, type: "routed", actorSide: "system", detail: { rule: decision.ruleName } },
    });
    await notifyUser({
      userId: decision.routeToUserId,
      title: `Request #${request.number} routed to you`,
      body: `Standing rule "${decision.ruleName}" routed the request from ${request.requester.displayName} to you.`,
      href: `/c-panel/requests/${requestId}`,
      critical: true,
    });
  } else {
    await notifyConsenterTeam(request.consenterId, {
      title: `New consent request #${request.number}`,
      body: `${request.requester.displayName} asks to use ${request.assetTypeNames.join(", ")}. Respond within ${settings.slaDays} days.`,
      href: `/c-panel/requests/${requestId}`,
      critical: true,
    });
  }
}

/** Contact details snapshot revealed when a deal is agreed. */
export async function revealContacts(requestId: string) {
  const request = await db.consentRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { consenter: true, requester: true },
  });
  const c = request.consenter;
  const r = request.requester;
  const snapshot = {
    consenter: {
      name: c.displayName,
      email: c.shareEmail ? c.contactEmail : null,
      phone: c.sharePhone ? c.contactPhone : null,
      manager: c.shareManager ? c.managerContact : null,
    },
    requester: {
      name: r.displayName,
      email: r.shareEmail ? r.contactEmail : null,
      phone: r.sharePhone ? r.contactPhone : null,
      manager: r.shareManager ? r.managerContact : null,
    },
    revealedAt: new Date().toISOString(),
  };
  await db.consentRequest.update({
    where: { id: requestId },
    data: { contactsRevealed: true, contactsSnapshot: snapshot },
  });
  return snapshot;
}
