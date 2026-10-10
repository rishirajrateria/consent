import type { ConsentRequest, ConsenterProfile, Prisma, RequesterProfile, RequestStatus } from "@prisma/client";
import { db } from "./db";
import { getSettings } from "./settings";
import { evaluateAutoDecision, type Selection } from "./rules";
import { issueGrant } from "./grants";
import { notifyConsenterTeam, notifyRequesterTeam, notifyUser } from "./notify";
import { splitConsentFee, syncConsentPrice } from "./escrow";
import { fmtMoney } from "./utils";
import { windowEnd } from "./request-window";
import { requestCapacity, type Capacity } from "./capacity";
import { recalcConsenterScore } from "./score";
import { isSelfAsk } from "./profiles";
import { profileScore } from "./profiles-pure";

/* The request lifecycle on the server: sending a draft (after its checkout,
   or straight away when asking is free), the automatic decision, and the one
   approval path shared by the owner's Approve and automatic approvals.

   DRAFT → SUBMITTED (passing) → DENIED | APPROVED_IN_PRINCIPLE / APPROVED | PENDING.
   From PENDING: Approve → APPROVED (certificate) or APPROVED_IN_PRINCIPLE (waiting
   for the final file), Ask → CHANGES_REQUESTED → PENDING, Decline → DENIED,
   Withdraw → WITHDRAWN. The 7-day window expires or closes the rest (jobs.ts). */

/** A moment for notifications and emails, which can't know the reader's time zone. */
export function fmtUtc(d: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)} UTC`;
}

/** Joins sentences, skipping empty ones. */
export function sentences(...parts: (string | null | undefined | false)[]): string {
  return parts
    .filter((p): p is string => !!p && !!p.trim())
    .map((p) => p.trim())
    .join(" ");
}

/**
 * What the person who asked is told when a request ends without a yes: 80% of
 * the consent request fee comes back (Consent keeps 20%); the platform fee
 * never does. Empty for a free request: nothing was paid, so nothing to say.
 */
export async function noYesRefundNote(requestId: string, owner: string): Promise<string> {
  const paid = await db.payment.findMany({
    where: {
      requestId,
      purpose: { in: ["CONSENT_PRICE", "PER_REQUEST"] },
      status: { in: ["PAID", "REFUNDED", "FORFEITED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const fee = paid.find((p) => p.purpose === "CONSENT_PRICE");
  if (!fee) return paid.length ? "The platform fee isn't refunded." : "";
  const back = fee.refundedAmount ?? splitConsentFee(Number(fee.amount.toString())).refund;
  return `80% of ${owner}'s consent request fee (${fmtMoney(back.toString(), fee.currency)}) is refunded to you; Consent keeps 20%. The platform fee isn't refunded.`;
}

/** Whether anything was paid to send this request (false for a free request). */
export async function requestFeePaid(requestId: string): Promise<boolean> {
  const n = await db.payment.count({
    where: { requestId, purpose: { in: ["CONSENT_PRICE", "PER_REQUEST"] }, status: { in: ["PAID", "REFUNDED", "FORFEITED"] } },
  });
  return n > 0;
}

/**
 * What the owner's team is told when their request limits pause new
 * requests: why, and what opens them again.
 */
export function pausedNotice(c: Capacity, fmt: (d: Date) => string): { title: string; body: string } {
  const reopen =
    c.untilAnswered && c.opensAt
      ? `They open again once you answer some of the waiting requests, and not before ${fmt(c.opensAt)}.`
      : c.untilAnswered
        ? "They open again when you answer some of the waiting requests."
        : c.opensAt
          ? `They open again ${fmt(c.opensAt)}.`
          : "";
  return {
    title: "New requests are paused",
    body: `New requests are paused: ${c.reasons.join("; ")}. ${reopen} You can change your request limits in settings.`.replace(/\s+/g, " ").trim(),
  };
}

/**
 * The asker's Consent Score as everyone sees it (profileScore of the
 * profile's two halves), for standing rules ("asker's Consent Score ≥ N")
 * and the pre-send check, so a rule compares the same number the owner sees.
 * A sending half with no paired profile has only its own score.
 */
export function askerScore(requester: { score: number; consenter?: { score: number } | null }): number {
  return requester.consenter ? profileScore(requester.consenter.score, requester.score) : requester.score;
}

/** Shown when a profile tries to ask itself. */
export const SELF_ASK_ERROR = "This is your profile. You can't send a request to yourself.";

/**
 * Sends a draft. Called when its checkout is paid, or straight away for a
 * free request (no checkout). Submits it, records whether a fee was paid,
 * and runs the automatic decision. Safe to call more than once: only a DRAFT
 * moves. Returns the status the request ends up in, or null when nothing was
 * sent (not a draft any more, or a profile asking itself).
 */
export async function onRequestPaid(requestId: string): Promise<RequestStatus | null> {
  const request = await db.consentRequest.findUnique({
    where: { id: requestId },
    include: {
      requester: { include: { consenter: { select: { score: true } } } },
      consenter: true,
      files: { select: { kind: true } },
    },
  });
  if (!request || request.status !== "DRAFT") return null;
  // A profile never asks itself. Drafts are checked when they are made and
  // sent; this is the last line, so a self-ask is never submitted.
  if (isSelfAsk(request.consenterId, request.requester)) {
    console.warn(`Request ${requestId}: a profile can't ask itself; left as a draft.`);
    return null;
  }
  // Whether the owner's request limits already held new requests back before this one.
  const before = await requestCapacity(request.consenterId).catch(() => null);
  const status = await submitAndDecide(request);
  // This request reached a limit: tell the owner's team once, as it happens.
  if (status && before && !before.paused) {
    const after = await requestCapacity(request.consenterId).catch(() => null);
    if (after?.paused) {
      await notifyConsenterTeam(request.consenterId, { ...pausedNotice(after, fmtUtc), href: "/c-panel" });
    }
  }
  return status;
}

async function submitAndDecide(
  request: ConsentRequest & {
    requester: RequesterProfile & { consenter: { score: number } | null };
    consenter: ConsenterProfile;
    files: { kind: string }[];
  },
): Promise<RequestStatus | null> {
  const requestId = request.id;
  const settings = await getSettings();
  const now = new Date();
  // The first window: it expires this many days from now unless someone acts.
  const slaExpiresAt = windowEnd(now, settings.slaDays);
  const feePaid = await requestFeePaid(requestId);

  // Only a draft is sent, once, even if two payment confirmations race.
  const sent = await db.$transaction(async (tx) => {
    const res = await tx.consentRequest.updateMany({
      where: { id: requestId, status: "DRAFT" },
      data: { status: "SUBMITTED", submittedAt: now, slaExpiresAt },
    });
    if (res.count === 0) return false;
    await tx.requestEvent.create({
      data: { requestId, type: "submitted", actorSide: "requester", detail: { feePaid } },
    });
    return true;
  });
  if (!sent) return null;

  const decision = await evaluateAutoDecision({
    consenterId: request.consenterId,
    requester: {
      id: request.requesterId,
      type: request.requester.type,
      // The one Consent Score people see, not the sending half's alone.
      score: askerScore(request.requester),
      categories: request.requester.categories,
    },
    selections: request.selections as Selection[],
    assetTypeIds: request.assetTypeIds,
    thumbnailUsed: request.thumbnailUsed,
  });
  const owner = request.consenter.displayName;

  if (
    (decision.kind === "rule" && decision.action === "AUTO_DENY") ||
    (decision.kind === "matrix" && decision.policy === "AUTO_DENY")
  ) {
    const byRule = decision.kind === "rule";
    await db.$transaction([
      db.consentRequest.update({
        where: { id: requestId },
        data: {
          status: "DENIED",
          decidedAt: new Date(),
          decidedByRuleId: byRule ? decision.ruleId : null,
          decidedByRuleName: byRule ? decision.ruleName : "Consent matrix default (Never allowed)",
          denialReason: byRule
            ? `Declined automatically by the standing rule "${decision.ruleName}".`
            : `${owner} never allows this platform, format and asset combination.`,
        },
      }),
      db.requestEvent.create({
        data: { requestId, type: "auto_denied", actorSide: "system", detail: { rule: byRule ? decision.ruleName : "matrix" } },
      }),
    ]);
    // Without a yes, 80% of a held consent request fee goes back (no-op while unpaid or free).
    await syncConsentPrice(requestId);
    await notifyRequesterTeam(request.requesterId, {
      title: `Request #${request.number} declined`,
      body: sentences(
        byRule
          ? `${owner} has a standing rule that declines this kind of request.`
          : `${owner} never allows this combination.`,
        await noYesRefundNote(requestId, owner),
      ),
      href: `/r-panel/requests/${requestId}`,
    });
    return "DENIED";
  }

  if (
    (decision.kind === "rule" && decision.action === "AUTO_APPROVE") ||
    (decision.kind === "matrix" && decision.policy === "AUTO_APPROVE")
  ) {
    const byRule = decision.kind === "rule";
    return approveAndIssue({
      requestId,
      decidedById: null,
      decidedByName: byRule ? "Standing rule (automatic)" : "Consent matrix (automatic)",
      actorSide: "system",
      ruleId: byRule ? decision.ruleId : null,
      ruleName: byRule
        ? `${decision.ruleName} (set by ${decision.createdByName} on ${decision.createdAt.toISOString().slice(0, 10)})`
        : "Consent matrix default (Allowed without asking)",
    });
  }

  // Route or plain pending
  await db.consentRequest.update({ where: { id: requestId }, data: { status: "PENDING" } });
  const routeToUserId =
    decision.kind === "rule" && decision.action === "ROUTE_TO_MEMBER" ? decision.routeToUserId : null;
  const members = routeToUserId
    ? await db.consenterMember.findMany({
        where: { consenterId: request.consenterId },
        include: { user: { select: { name: true } } },
      })
    : [];
  const asker = request.requester.displayName;
  const href = `/c-panel/requests/${requestId}`;
  // A rule can still name someone who has since left the team; then it's handled as a plain pending request.
  const routedTo = members.find((m) => m.userId === routeToUserId);
  if (decision.kind === "rule" && routedTo) {
    await db.requestEvent.create({
      data: { requestId, type: "routed", actorSide: "system", detail: { rule: decision.ruleName } },
    });
    await notifyUser({
      userId: routedTo.userId,
      title: `Request #${request.number} routed to you`,
      body: `Standing rule "${decision.ruleName}" routed the request from ${asker} to you. Answer within ${settings.slaDays} days.`,
      href,
      critical: true,
    });
    // The rest of the team hears about it too, so nobody misses it if the routed member is away.
    // (Same as notifyConsenterTeam, minus the routed member, who was just told directly.)
    await Promise.all(
      members
        .filter((m) => m.userId !== routedTo.userId)
        .map((m) =>
          notifyUser({
            userId: m.userId,
            title: `New consent request #${request.number}`,
            body: `${asker} asks to use ${request.assetTypeNames.join(", ")}. Standing rule "${decision.ruleName}" routed it to ${routedTo.user.name}. Answer within ${settings.slaDays} days.`,
            href,
          })
        )
    );
  } else {
    await notifyConsenterTeam(request.consenterId, {
      title: `New consent request #${request.number}`,
      body: `${asker} asks to use ${request.assetTypeNames.join(", ")}. Answer within ${settings.slaDays} days.`,
      href,
      critical: true,
    });
  }
  return "PENDING";
}

/** Where an approval can come from: a request just sent (automatic yes), or one waiting for the owner. */
export const APPROVABLE_STATUSES: RequestStatus[] = ["SUBMITTED", "PENDING", "CHANGES_REQUESTED"];

/** Thrown when a request is no longer in a state that can be approved. */
export class ApprovalError extends Error {}

/**
 * The one way a request is approved: the owner's Approve and every automatic
 * approval (standing rule or consent matrix) go through here.
 *
 * Records the yes (decidedAt, who or which rule, any scope conditions), writes
 * the approval event, then issues the certificate at once if the final content
 * file (RAW_CONTENT) is uploaded (APPROVED), or leaves the request approved and
 * waiting for that file (APPROVED_IN_PRINCIPLE; the asker's upload issues it).
 * Releases the owner's 80% of a held consent request fee, tells the asker's
 * team and recalculates the owner's score. Returns the status the request
 * ends in. (The owner's action writes its own audit entry.)
 *
 * Conditions only narrow the scope: fewer formats or shorter clips
 * (`approvedSelections`), no thumbnail (`approvedThumbnail: false`), a shorter
 * validity (`validUntil`), and a short written condition (`conditionsNote`).
 * Leave a field out to keep what was asked for.
 *
 * Throws ApprovalError when the request can no longer be approved (it was
 * answered, withdrawn or ended meanwhile). Approving one that is already
 * approved returns its status and changes nothing.
 */
export async function approveAndIssue(opts: {
  requestId: string;
  decidedById: string | null;
  decidedByName: string;
  actorSide: "consenter" | "system";
  conditionsNote?: string | null;
  approvedSelections?: Prisma.InputJsonValue | null;
  approvedThumbnail?: boolean | null;
  ruleId?: string | null;
  ruleName?: string | null;
  /** A shorter validity end; leave out to keep the one asked for. */
  validUntil?: Date | null;
}): Promise<"APPROVED" | "APPROVED_IN_PRINCIPLE"> {
  const id = opts.requestId;
  const request = await db.consentRequest.findUniqueOrThrow({
    where: { id },
    include: { files: { select: { kind: true } }, consenter: { select: { displayName: true } } },
  });

  const conditionsNote = opts.conditionsNote?.trim() || null;
  const validUntil = opts.validUntil === undefined ? request.validUntil : opts.validUntil;
  const narrowed =
    !!conditionsNote ||
    (opts.approvedSelections != null && JSON.stringify(opts.approvedSelections) !== JSON.stringify(request.selections)) ||
    (opts.approvedThumbnail != null && opts.approvedThumbnail !== request.thumbnailUsed) ||
    (validUntil?.getTime() ?? 0) !== (request.validUntil?.getTime() ?? 0);
  const system = opts.actorSide === "system";

  const moved = await db.$transaction(async (tx) => {
    const res = await tx.consentRequest.updateMany({
      where: { id, status: { in: APPROVABLE_STATUSES } },
      data: {
        // A yes waiting for the final file; issuing the certificate below makes it APPROVED.
        status: "APPROVED_IN_PRINCIPLE",
        decidedAt: new Date(),
        decidedById: opts.decidedById,
        decidedByRuleId: opts.ruleId ?? null,
        decidedByRuleName: opts.ruleName ?? null,
        conditionsNote,
        ...(opts.approvedSelections != null ? { approvedSelections: opts.approvedSelections } : {}),
        ...(opts.approvedThumbnail != null ? { approvedThumbnail: opts.approvedThumbnail } : {}),
        ...(opts.validUntil !== undefined ? { validUntil: opts.validUntil } : {}),
      },
    });
    if (res.count === 0) return false;
    await tx.requestEvent.create({
      data: {
        requestId: id,
        type: system ? "auto_approved" : narrowed ? "approved_with_conditions" : "approved",
        actorName: system ? null : opts.decidedByName,
        actorSide: opts.actorSide,
        detail: system
          ? { rule: opts.ruleName ?? null }
          : {
              conditionsNote,
              approvedThumbnail: opts.approvedThumbnail ?? request.thumbnailUsed,
              validUntil: validUntil?.toISOString() ?? null,
            },
      },
    });
    return true;
  });
  if (!moved) {
    const now = await db.consentRequest.findUnique({ where: { id }, select: { status: true } });
    if (now?.status === "APPROVED" || now?.status === "APPROVED_IN_PRINCIPLE") return now.status;
    throw new ApprovalError("This request can no longer be approved.");
  }

  let status: "APPROVED" | "APPROVED_IN_PRINCIPLE" = "APPROVED_IN_PRINCIPLE";
  if (request.files.some((f) => f.kind === "RAW_CONTENT")) {
    // Tells both teams and recalculates both scores.
    await issueGrant(id, opts.decidedByName);
    status = "APPROVED";
  } else {
    await notifyRequesterTeam(request.requesterId, {
      title: `Request #${request.number} approved${narrowed ? " with conditions" : ""}`,
      body: sentences(
        `${request.consenter.displayName} said yes${narrowed ? " with conditions" : ""}.`,
        "Upload the final content file to get your certificate. It is bound to that exact file.",
      ),
      href: `/r-panel/requests/${id}`,
      critical: true,
    });
    await recalcConsenterScore(request.consenterId, `Responded to request #${request.number}`);
  }
  // A yes releases the owner's 80% of the held consent request fee (no-op while unpaid or free).
  await syncConsentPrice(id);
  return status;
}
