"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { storeUpload } from "@/lib/storage";
import { notifyConsenterTeam, notifyRequesterTeam } from "@/lib/notify";
import { Prisma } from "@prisma/client";
import { canSendOffer, COUNTERS_USED_UP, FEE_CHANGED } from "@/lib/negotiation";
import { syncConsentPrice } from "@/lib/escrow";

/** Resolves which side of a request the current user is on (with membership). */
export async function resolveSide(requestId: string) {
  const session = await requireUser();
  const request = await db.consentRequest.findUnique({
    where: { id: requestId },
    include: { consenter: true, requester: true, offers: { orderBy: { version: "desc" } } },
  });
  if (!request) redirect("/dashboard");
  const [cm, rm] = await Promise.all([
    db.consenterMember.findUnique({
      where: { consenterId_userId: { consenterId: request.consenterId, userId: session.userId } },
    }),
    db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: request.requesterId, userId: session.userId } },
    }),
  ]);
  const side: "consenter" | "requester" | null = cm ? "consenter" : rm ? "requester" : null;
  if (!side) redirect("/dashboard");
  return { session, request, side, consenterMember: cm, requesterMember: rm };
}

/** Requester VIEWER seats are read-only. */
export async function assertCanAct(side: "consenter" | "requester", rm: { role: string } | null, path: string) {
  if (side === "requester" && rm?.role === "VIEWER")
    redirect(`${path}?error=${encodeURIComponent("Viewers have read-only access")}`);
}

function panelPath(side: "consenter" | "requester", id: string) {
  return side === "consenter" ? `/c-panel/requests/${id}` : `/r-panel/requests/${id}`;
}

export async function sendMessageAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side, requesterMember } = await resolveSide(id);
  await assertCanAct(side, requesterMember, panelPath(side, id));
  const body = String(formData.get("body") ?? "").trim();
  const path = panelPath(side, id);
  if (!body && !(formData.get("attachment") as File | null)?.size)
    redirect(`${path}?error=${encodeURIComponent("Write a message")}`);

  let attachmentFileId: string | undefined;
  const attachment = formData.get("attachment") as File | null;
  if (attachment && attachment.size > 0) {
    const stored = await storeUpload({
      file: attachment,
      kind: "ATTACHMENT",
      uploadedById: session.userId,
      requestId: id,
    });
    attachmentFileId = stored.id;
  }
  await db.requestMessage.create({
    data: { requestId: id, senderId: session.userId, senderSide: side, body, attachmentFileId },
  });
  const notify = side === "consenter" ? notifyRequesterTeam : notifyConsenterTeam;
  await notify(side === "consenter" ? request.requesterId : request.consenterId, {
    title: `New message on request #${request.number}`,
    body: body.slice(0, 140) || "(attachment)",
    href: panelPath(side === "consenter" ? "requester" : "consenter", id),
  });
  redirect(`${path}`);
}

// ── Negotiation (no money moves through Consent) ──────────────

export async function makeOfferAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side, consenterMember, requesterMember } = await resolveSide(id);
  const path = panelPath(side, id);
  await assertCanAct(side, requesterMember, path);
  if (!["IN_NEGOTIATION", "PENDING"].includes(request.status))
    redirect(`${path}?error=${encodeURIComponent("Negotiation is not open on this request")}`);
  if (side === "consenter" && consenterMember && consenterMember.role !== "OWNER" && !consenterMember.canNegotiate)
    redirect(`${path}?error=${encodeURIComponent("You don't have negotiation permission")}`);

  const amount = parseFloat(String(formData.get("amount") ?? ""));
  const currency = String(formData.get("currency") ?? "USD").toUpperCase().slice(0, 3);
  const scopeNote = String(formData.get("scopeNote") ?? "").trim() || null;
  if (!(amount >= 0)) redirect(`${path}?error=${encodeURIComponent("Enter a valid amount")}`);

  // Each side gets at most 3 counter-offers; after that, accept or end and raise a new request.
  if (!canSendOffer(request.offers, side)) redirect(`${path}?error=${encodeURIComponent(COUNTERS_USED_UP)}`);

  const latest = request.offers[0];
  await db.$transaction([
    db.negotiationOffer.updateMany({
      where: { requestId: id, status: "OPEN" },
      data: { status: "SUPERSEDED" },
    }),
    db.negotiationOffer.create({
      data: {
        requestId: id,
        version: (latest?.version ?? 0) + 1,
        bySide: side,
        byUserId: session.userId,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        currency,
        scopeNote,
      },
    }),
    db.consentRequest.update({
      where: { id },
      data: { status: "IN_NEGOTIATION", isPaid: true, lastOfferAt: new Date() },
    }),
    db.requestEvent.create({
      data: {
        requestId: id,
        type: "offer_made",
        actorName: session.user.name,
        actorSide: side,
        detail: { amount: amount.toFixed(2), currency, scopeNote },
      },
    }),
  ]);
  const notify = side === "consenter" ? notifyRequesterTeam : notifyConsenterTeam;
  await notify(side === "consenter" ? request.requesterId : request.consenterId, {
    title: `Offer on request #${request.number}: ${currency} ${amount.toFixed(2)}`,
    body: scopeNote ?? "Review and accept, counter, or walk away.",
    href: panelPath(side === "consenter" ? "requester" : "consenter", id),
    critical: true,
  });
  redirect(`${path}`);
}

export async function acceptOfferAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side, requesterMember } = await resolveSide(id);
  const path = panelPath(side, id);
  await assertCanAct(side, requesterMember, path);
  // The owner says yes in one place only: "Your answer" at the end of the page,
  // where conditions and the agreement choice sit next to the button.
  if (side === "consenter")
    redirect(`${path}?error=${encodeURIComponent("To accept their offer, approve the deal in Your answer")}`);
  if (request.status !== "IN_NEGOTIATION")
    redirect(`${path}?error=${encodeURIComponent("No open negotiation")}`);
  const latest = request.offers[0];
  if (!latest || latest.status !== "OPEN" || latest.bySide === side)
    redirect(`${path}?error=${encodeURIComponent("You can only accept the other side's latest offer")}`);
  // Accept only the fee that was on screen, never one changed while deciding.
  if (latest.id !== String(formData.get("offerId") ?? ""))
    redirect(`${path}?error=${encodeURIComponent(FEE_CHANGED)}`);

  // The note sent with the fee is part of what was agreed, so it becomes a condition.
  const conditionsNote = latest.scopeNote
    ? [request.conditionsNote, `Agreed with the fee: ${latest.scopeNote}`].filter(Boolean).join(" — ")
    : request.conditionsNote;
  await db.$transaction([
    db.negotiationOffer.update({ where: { id: latest.id }, data: { status: "ACCEPTED" } }),
    db.consentRequest.update({
      where: { id },
      data: {
        status: "DEAL_AGREED",
        agreedAmount: latest.amount,
        agreedCurrency: latest.currency,
        conditionsNote,
        decidedAt: new Date(),
        decidedById: latest.byUserId,
      },
    }),
    db.requestEvent.create({
      data: {
        requestId: id,
        type: "deal_agreed",
        actorName: session.user.name,
        actorSide: side,
        detail: { amount: latest.amount.toString(), currency: latest.currency, scopeNote: latest.scopeNote },
      },
    }),
  ]);

  // The owner's standing preference: propose a legally binding agreement for paid deals.
  const legal = request.consenter.defaultRequireLegalAgreementForPaid;
  if (legal) {
    await db.$transaction([
      db.agreement.upsert({
        where: { requestId: id },
        update: { status: "PROPOSED", proposedBySide: "consenter", kind: null },
        create: { requestId: id, status: "PROPOSED", proposedBySide: "consenter" },
      }),
      db.consentRequest.update({ where: { id }, data: { status: "LEGAL_AGREEMENT_PENDING" } }),
      db.requestEvent.create({
        data: {
          requestId: id,
          type: "legal_agreement_proposed",
          actorName: request.consenter.displayName,
          actorSide: "consenter",
          detail: { reason: "Owner's preference for paid requests" },
        },
      }),
    ]);
  } else {
    await db.consentRequest.update({ where: { id }, data: { status: "AGREEMENT_MODE_PENDING" } });
  }

  const fee = `${latest.currency} ${latest.amount.toString()}`;
  const title = `Deal agreed on request #${request.number}`;
  const owner = request.consenter.displayName;
  await notifyRequesterTeam(request.requesterId, {
    title,
    body: `${fee}. ${
      request.contactsRevealed
        ? `Settle the fee directly with ${owner} using their shared contact details.`
        : `${owner} hasn't shared contact details — use the messages on this request to arrange payment.`
    } Consent does not process this payment. ${
      legal
        ? `Next: accept or decline the legally binding agreement ${owner} asks for.`
        : "Next: choose the agreement mode."
    }`,
    href: `/r-panel/requests/${id}`,
    critical: true,
  });
  await notifyConsenterTeam(request.consenterId, {
    title,
    body: request.contactsRevealed
      ? `${fee}. Your contact details are shared so the fee can be settled directly.`
      : `${fee}. You haven't shared contact details. The requester needs a way to pay you — share them from the request page, or arrange it in messages.`,
    href: `/c-panel/requests/${id}`,
    critical: true,
  });
  // An agreed deal is a yes: the held ask price goes to the owner.
  await syncConsentPrice(id);
  redirect(path);
}

export async function closeNegotiationAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side, consenterMember, requesterMember } = await resolveSide(id);
  const path = panelPath(side, id);
  await assertCanAct(side, requesterMember, path);
  if (
    side === "consenter" &&
    consenterMember &&
    consenterMember.role !== "OWNER" &&
    !consenterMember.canNegotiate &&
    !consenterMember.canApprove
  )
    redirect(`${path}?error=${encodeURIComponent("You don't have permission to end this request")}`);
  if (!["IN_NEGOTIATION", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING"].includes(request.status))
    redirect(`${path}?error=${encodeURIComponent("Nothing to close")}`);
  await db.$transaction([
    db.consentRequest.update({
      where: { id },
      data: { status: "CLOSED", closedReason: `${side} walked away` },
    }),
    db.requestEvent.create({
      data: { requestId: id, type: "closed", actorName: session.user.name, actorSide: side },
    }),
  ]);
  const notify = side === "consenter" ? notifyRequesterTeam : notifyConsenterTeam;
  await notify(side === "consenter" ? request.requesterId : request.consenterId, {
    title: `Request #${request.number} closed`,
    body: "The other side closed the request. The platform fee is not refunded; an ask price still held is refunded to the requester.",
    href: panelPath(side === "consenter" ? "requester" : "consenter", id),
  });
  // Ended before a yes: the held ask price is refunded (released prices stay with the owner).
  await syncConsentPrice(id);
  redirect(path);
}
