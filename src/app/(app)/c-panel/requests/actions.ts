"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireConsenter } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyRequesterTeam } from "@/lib/notify";
import { issueGrant } from "@/lib/grants";
import { revealContacts } from "@/lib/requests";
import { recalcConsenterScore } from "@/lib/score";
import type { Selection } from "@/lib/rules";
import { Prisma } from "@prisma/client";

function fail(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

async function decidableRequest(id: string) {
  const { session, member, consenter } = await requireConsenter("canApprove");
  const request = await db.consentRequest.findUnique({
    where: { id },
    include: { files: true, requester: true },
  });
  if (!request || request.consenterId !== consenter.id) redirect("/c-panel/requests");
  return { session, member, consenter, request };
}

export async function approveRequestAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, consenter, request } = await decidableRequest(id);
  const path = `/c-panel/requests/${id}`;
  if (!["PENDING", "IN_NEGOTIATION", "CHANGES_REQUESTED"].includes(request.status))
    fail(path, "This request can no longer be approved from here");

  // Approve with conditions: optionally reduce scope
  const keptFormatIds = formData.getAll("keepFormat").map(String);
  const selections = request.selections as Selection[];
  const approvedSelections = keptFormatIds.length
    ? selections.filter((s) => keptFormatIds.includes(s.formatId))
    : selections;
  if (approvedSelections.length === 0) fail(path, "Keep at least one platform format");

  // Optional duration caps per kept selection
  const cappedSelections = approvedSelections.map((s) => {
    const cap = parseInt(String(formData.get(`cap_${s.formatId}`) ?? ""), 10);
    if (s.durationSec && cap > 0 && cap < s.durationSec) return { ...s, durationSec: cap };
    return s;
  });

  const conditionsNote = String(formData.get("conditionsNote") ?? "").trim() || null;
  const approvedThumbnail =
    formData.get("removeThumbnail") === "on" ? false : request.thumbnailUsed;

  // Optionally shorten validity
  let validUntil = request.validUntil;
  const shortenRaw = String(formData.get("validUntil") ?? "");
  if (shortenRaw) {
    const d = new Date(shortenRaw);
    if (!isNaN(d.getTime())) validUntil = d;
  }

  const scopeChanged =
    cappedSelections.length !== selections.length ||
    JSON.stringify(cappedSelections) !== JSON.stringify(selections) ||
    approvedThumbnail !== request.thumbnailUsed ||
    !!conditionsNote ||
    (validUntil?.getTime() ?? 0) !== (request.validUntil?.getTime() ?? 0);

  const proposeLegal = formData.get("proposeLegal") === "on";
  const requireLegal =
    proposeLegal || (request.isPaid && consenter.defaultRequireLegalAgreementForPaid);

  await db.consentRequest.update({
    where: { id },
    data: {
      approvedSelections: cappedSelections as unknown as object,
      approvedThumbnail,
      conditionsNote,
      validUntil,
      decidedAt: new Date(),
      decidedById: session.userId,
      status: "AGREEMENT_MODE_PENDING",
    },
  });
  await db.requestEvent.create({
    data: {
      requestId: id,
      type: scopeChanged ? "approved_with_conditions" : "approved",
      actorName: session.user.name,
      actorSide: "consenter",
      detail: { conditionsNote, approvedThumbnail, validUntil: validUntil?.toISOString() ?? null },
    },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "request_approved",
    module: "requests",
    targetId: id,
  });

  const shareContacts = formData.get("shareContacts") === "on";
  if (shareContacts) await revealContacts(id, session.user.name);
  const contactLine = shareContacts
    ? ` ${consenter.displayName} also shared their contact details.`
    : "";

  if (requireLegal) {
    await db.agreement.upsert({
      where: { requestId: id },
      update: { status: "PROPOSED", proposedBySide: "consenter" },
      create: { requestId: id, status: "PROPOSED", proposedBySide: "consenter" },
    });
    await db.consentRequest.update({ where: { id }, data: { status: "LEGAL_AGREEMENT_PENDING" } });
    await notifyRequesterTeam(request.requesterId, {
      title: `Request #${request.number} approved — legally binding agreement proposed`,
      body: `${consenter.displayName} approved${scopeChanged ? " with conditions" : ""} and proposes a legally binding agreement. You must accept or decline.${contactLine}`,
      href: `/r-panel/requests/${id}`,
      critical: true,
    });
  } else {
    await notifyRequesterTeam(request.requesterId, {
      title: `Request #${request.number} approved${scopeChanged ? " with conditions" : ""}`,
      body: `Choose the agreement mode to receive your certificate (default: Consent-app record).${contactLine}`,
      href: `/r-panel/requests/${id}`,
      critical: true,
    });
  }
  await recalcConsenterScore(consenter.id, `Responded to request #${request.number}`);
  redirect(path);
}

export async function requestChangesAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request } = await decidableRequest(id);
  const path = `/c-panel/requests/${id}`;
  if (!["PENDING", "IN_NEGOTIATION"].includes(request.status))
    fail(path, "Changes can only be requested on open requests");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) fail(path, "Explain what should change");
  await db.$transaction([
    db.consentRequest.update({ where: { id }, data: { status: "CHANGES_REQUESTED" } }),
    db.requestEvent.create({
      data: {
        requestId: id,
        type: "changes_requested",
        actorName: session.user.name,
        actorSide: "consenter",
        detail: { note },
      },
    }),
  ]);
  await notifyRequesterTeam(request.requesterId, {
    title: `Changes requested on request #${request.number}`,
    body: note,
    href: `/r-panel/requests/${id}`,
    critical: true,
  });
  redirect(path);
}

export async function markPaidAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, member, request } = await decidableRequest(id);
  const path = `/c-panel/requests/${id}`;
  if (member.role !== "OWNER" && !member.canNegotiate) fail(path, "You don't have negotiation permission");
  if (!["PENDING", "CHANGES_REQUESTED"].includes(request.status))
    fail(path, "A fee can only be set on open requests");
  const amount = parseFloat(String(formData.get("amount") ?? ""));
  const currency = String(formData.get("currency") ?? "USD").toUpperCase().slice(0, 3);
  if (!(amount > 0)) fail(path, "Enter a fee amount");

  await db.$transaction([
    db.negotiationOffer.create({
      data: {
        requestId: id,
        version: 1,
        bySide: "consenter",
        byUserId: session.userId,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        currency,
        scopeNote: String(formData.get("scopeNote") ?? "").trim() || null,
      },
    }),
    db.consentRequest.update({
      where: { id },
      data: { status: "IN_NEGOTIATION", isPaid: true, lastOfferAt: new Date() },
    }),
    db.requestEvent.create({
      data: {
        requestId: id,
        type: "marked_paid",
        actorName: session.user.name,
        actorSide: "consenter",
        detail: { amount: amount.toFixed(2), currency },
      },
    }),
  ]);
  await notifyRequesterTeam(request.requesterId, {
    title: `Request #${request.number}: fee requested`,
    body: `${currency} ${amount.toFixed(2)} — accept, counter-offer or walk away. Payment is settled directly between you; Consent never processes it.`,
    href: `/r-panel/requests/${id}`,
    critical: true,
  });
  redirect(`${path}`);
}

export async function denyRequestAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, consenter, request } = await decidableRequest(id);
  const path = `/c-panel/requests/${id}`;
  if (!["PENDING", "IN_NEGOTIATION", "CHANGES_REQUESTED"].includes(request.status))
    fail(path, "This request can no longer be denied");
  const reasonId = String(formData.get("reasonId") ?? "");
  const freeText = String(formData.get("freeText") ?? "").trim();
  const reason = reasonId ? (await db.denialReason.findUnique({ where: { id: reasonId } }))?.label : null;
  const denialReason = [reason, freeText].filter(Boolean).join(" — ") || null;

  await db.$transaction([
    db.consentRequest.update({
      where: { id },
      data: { status: "DENIED", decidedAt: new Date(), decidedById: session.userId, denialReason },
    }),
    db.requestEvent.create({
      data: {
        requestId: id,
        type: "denied",
        actorName: session.user.name,
        actorSide: "consenter",
        detail: { reason: denialReason },
      },
    }),
  ]);
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "request_denied",
    module: "requests",
    targetId: id,
    reason: denialReason,
  });
  await notifyRequesterTeam(request.requesterId, {
    title: `Request #${request.number} denied`,
    body: denialReason ?? "No reason given.",
    href: `/r-panel/requests/${id}`,
  });
  await recalcConsenterScore(consenter.id, `Responded to request #${request.number}`);
  redirect(path);
}

/** Consenter confirms app-record mode on their side (for free approvals they made). */
export async function consenterProceedAppRecordAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request } = await decidableRequest(id);
  if (request.status !== "AGREEMENT_MODE_PENDING") redirect(`/c-panel/requests/${id}`);
  await db.consentRequest.update({ where: { id }, data: { agreementMode: "APP_RECORD" } });
  const hasRaw = request.files.some((f) => f.kind === "RAW_CONTENT");
  if (hasRaw) {
    await issueGrant(id, session.user.name);
  } else {
    await db.consentRequest.update({ where: { id }, data: { status: "APPROVED_IN_PRINCIPLE" } });
  }
  redirect(`/c-panel/requests/${id}`);
}

/** Consenter shares contact details after approving (free or paid). */
export async function shareContactsAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, member, consenter } = await requireConsenter();
  const path = `/c-panel/requests/${id}`;
  if (member.role !== "OWNER" && !member.canApprove && !member.canNegotiate)
    fail(path, "You don't have permission to share contact details");
  const request = await db.consentRequest.findUnique({ where: { id } });
  if (!request || request.consenterId !== consenter.id) redirect("/c-panel/requests");
  const shareable = ["DEAL_AGREED", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING", "APPROVED_IN_PRINCIPLE", "APPROVED"];
  if (!shareable.includes(request.status)) fail(path, "Contact details can be shared once the request is approved");
  await revealContacts(id, session.user.name);
  await notifyRequesterTeam(request.requesterId, {
    title: `${consenter.displayName} shared their contact details`,
    body: `You can now reach them directly about request #${request.number}.`,
    href: `/r-panel/requests/${id}`,
  });
  redirect(path);
}
