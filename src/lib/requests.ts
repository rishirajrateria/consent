import { db } from "./db";
import { getSettings } from "./settings";
import { evaluateAutoDecision, type Selection } from "./rules";
import { issueGrant } from "./grants";
import { notifyConsenterTeam, notifyRequesterTeam, notifyUser } from "./notify";
import { splitConsentFee } from "./escrow";
import { fmtMoney } from "./utils";
import { windowEnd } from "./request-window";
import { requestCapacity, type Capacity } from "./capacity";
import { MODE_LABEL, requestUrl, type Side } from "./meetings";
import type { CallMode, ConsentRequest, ConsenterProfile, RequesterProfile } from "@prisma/client";

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

/**
 * What a requester is told when a request ends without a yes: 80% of the
 * owner's consent request fee comes back (Consent keeps 20%); the platform fee never does.
 */
export async function noYesRefundNote(requestId: string, owner: string) {
  const fee = await db.payment.findFirst({
    where: { requestId, purpose: "CONSENT_PRICE", status: { in: ["PAID", "REFUNDED"] } },
  });
  if (!fee) return "The platform fee isn't refunded.";
  const back = fee.refundedAmount ?? splitConsentFee(Number(fee.amount.toString())).refund;
  return `80% of ${owner}'s consent request fee (${fmtMoney(back.toString(), fee.currency)}) is refunded to you; Consent keeps 20%. The platform fee isn't refunded.`;
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

/** Called when the platform fee settles: submit + evaluate auto-decision. */
export async function onRequestPaid(requestId: string) {
  const request = await db.consentRequest.findUnique({
    where: { id: requestId },
    include: { requester: true, consenter: true, files: true },
  });
  if (!request || request.status !== "DRAFT") return;
  // Whether the owner's request limits already held new requests back before this one.
  const before = await requestCapacity(request.consenterId).catch(() => null);
  await submitAndDecide(request);
  // This request reached a limit: tell the owner's team once, as it happens.
  if (before && !before.paused) {
    const after = await requestCapacity(request.consenterId).catch(() => null);
    if (after?.paused) {
      await notifyConsenterTeam(request.consenterId, { ...pausedNotice(after, fmtUtc), href: "/c-panel" });
    }
  }
}

async function submitAndDecide(
  request: ConsentRequest & { requester: RequesterProfile; consenter: ConsenterProfile; files: { kind: string }[] },
) {
  const requestId = request.id;
  const settings = await getSettings();
  const now = new Date();
  // The first window: it expires this many days from now unless someone acts.
  const slaExpiresAt = windowEnd(now, settings.slaDays);

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
    thumbnailUsed: request.thumbnailUsed,
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
      body: `${request.consenter.displayName} has a standing rule that declines this kind of request. ${await noYesRefundNote(requestId, request.consenter.displayName)}`,
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
      body: `${request.consenter.displayName} never allows this combination. ${await noYesRefundNote(requestId, request.consenter.displayName)}`,
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
  const routeToUserId =
    decision.kind === "rule" && decision.action === "ROUTE_TO_MEMBER" ? decision.routeToUserId : null;
  const members = routeToUserId
    ? await db.consenterMember.findMany({
        where: { consenterId: request.consenterId },
        include: { user: { select: { name: true } } },
      })
    : [];
  // A rule can still name someone who has since left the team; then it's handled as a plain pending request.
  const routedTo = members.find((m) => m.userId === routeToUserId);
  if (decision.kind === "rule" && routedTo) {
    await db.requestEvent.create({
      data: { requestId, type: "routed", actorSide: "system", detail: { rule: decision.ruleName } },
    });
    const href = `/c-panel/requests/${requestId}`;
    await notifyUser({
      userId: routedTo.userId,
      title: `Request #${request.number} routed to you`,
      body: `Standing rule "${decision.ruleName}" routed the request from ${request.requester.displayName} to you. Respond within ${settings.slaDays} days.`,
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
            body: `${request.requester.displayName} asks to use ${request.assetTypeNames.join(", ")}. Standing rule "${decision.ruleName}" routed it to ${routedTo.user.name}. Respond within ${settings.slaDays} days.`,
            href,
          })
        )
    );
  } else {
    await notifyConsenterTeam(request.consenterId, {
      title: `New consent request #${request.number}`,
      body: `${request.requester.displayName} asks to use ${request.assetTypeNames.join(", ")}. Respond within ${settings.slaDays} days.`,
      href: `/c-panel/requests/${requestId}`,
      critical: true,
    });
  }
}

export type ContactField = "email" | "phone" | "address" | "manager";
export const CONTACT_FIELDS: ContactField[] = ["email", "phone", "address", "manager"];

/** One side's details on a request, as shared. A detail that isn't shared is null. */
export type SharedContact = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  manager: string | null;
};
export type ContactSnapshot = { consenter: SharedContact; requester: SharedContact; revealedAt: string };

type ContactProfile = Pick<
  ConsenterProfile,
  | "displayName"
  | "contactEmail"
  | "contactPhone"
  | "contactAddress"
  | "managerContact"
  | "shareEmail"
  | "sharePhone"
  | "shareAddress"
  | "shareManager"
>;

/** The details a profile shares unless told otherwise: its share switches in settings. */
export function defaultContactFields(p: ContactProfile): ContactField[] {
  const flags: [ContactField, boolean][] = [
    ["email", p.shareEmail],
    ["phone", p.sharePhone],
    ["address", p.shareAddress],
    ["manager", p.shareManager],
  ];
  return flags.filter(([, on]) => on).map(([f]) => f);
}

/**
 * One side's shared details: only the chosen fields (by default the
 * profile's share switches), and only those that have a value.
 */
export function contactCard(p: ContactProfile, fields?: ContactField[]): SharedContact {
  const chosen = new Set(fields ?? defaultContactFields(p));
  const pick = (f: ContactField, v: string | null) => (chosen.has(f) ? v?.trim() || null : null);
  return {
    name: p.displayName,
    email: pick("email", p.contactEmail),
    phone: pick("phone", p.contactPhone),
    address: pick("address", p.contactAddress),
    manager: pick("manager", p.managerContact),
  };
}

/** The fields of a shared card that carry a value. */
export function sharedFields(c: SharedContact): ContactField[] {
  return CONTACT_FIELDS.filter((f) => !!c[f]);
}

/**
 * Shares both sides' contact details on a request. Only ever called because
 * the owner chose to share — at approval, when accepting a fee, or later from
 * the request page. The owner's half has only the details they ticked
 * (`fields`; when left out, their profile's share switches decide) that have
 * a value. The requester's half follows the requester's own share switches.
 * Returns null and shares nothing when none of the owner's chosen details has
 * a value.
 */
export async function revealContacts(
  requestId: string,
  sharedBy: string,
  fields?: ContactField[],
): Promise<ContactSnapshot | null> {
  const request = await db.consentRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { consenter: true, requester: true },
  });
  if (request.contactsRevealed && request.contactsSnapshot) {
    return request.contactsSnapshot as unknown as ContactSnapshot;
  }
  const consenter = contactCard(request.consenter, fields);
  const shared = sharedFields(consenter);
  if (shared.length === 0) return null;
  const snapshot: ContactSnapshot = {
    consenter,
    requester: contactCard(request.requester),
    revealedAt: new Date().toISOString(),
  };
  await db.$transaction([
    db.consentRequest.update({
      where: { id: requestId },
      data: { contactsRevealed: true, contactsSnapshot: snapshot },
    }),
    db.requestEvent.create({
      data: { requestId, type: "contacts_shared", actorName: sharedBy, actorSide: "consenter", detail: { fields: shared } },
    }),
  ]);
  return snapshot;
}

// ── Meetings: what calendars show ─────────────────────────────

/** The event title, the same in emailed invites, downloads and add-to-calendar links. */
export function meetingTitle(r: { number: number; consenter: { displayName: string }; requester: { displayName: string } }) {
  return `Consent: ${r.consenter.displayName} × ${r.requester.displayName} (request #${r.number})`;
}

/** The event description for one side: how to join, the note, and that side's link to the request. */
export function meetingDescription(
  m: { requestId: string; mode: CallMode; link: string | null; location: string | null; note: string | null },
  side: Side,
) {
  const how =
    m.mode === "IN_PERSON" ? `In person at ${m.location}` : m.link ? `${MODE_LABEL[m.mode]}: ${m.link}` : MODE_LABEL[m.mode];
  return [how, m.note, `Request on Consent: ${requestUrl(m.requestId, side)}`].filter(Boolean).join("\n\n");
}
