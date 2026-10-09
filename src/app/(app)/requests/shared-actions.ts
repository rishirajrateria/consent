"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { storeUpload } from "@/lib/storage";
import { revealContacts } from "@/lib/requests";
import { notifyConsenterTeam, notifyRequesterTeam } from "@/lib/notify";
import { Prisma } from "@prisma/client";

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
  const { session, request, side, consenterMember, requesterMember } = await resolveSide(id);
  const path = panelPath(side, id);
  await assertCanAct(side, requesterMember, path);
  if (request.status !== "IN_NEGOTIATION")
    redirect(`${path}?error=${encodeURIComponent("No open negotiation")}`);
  const latest = request.offers[0];
  if (!latest || latest.status !== "OPEN" || latest.bySide === side)
    redirect(`${path}?error=${encodeURIComponent("You can only accept the other side's latest offer")}`);
  if (side === "consenter" && consenterMember && consenterMember.role !== "OWNER" && !consenterMember.canNegotiate)
    redirect(`${path}?error=${encodeURIComponent("You don't have negotiation permission")}`);

  await db.$transaction([
    db.negotiationOffer.update({ where: { id: latest.id }, data: { status: "ACCEPTED" } }),
    db.consentRequest.update({
      where: { id },
      data: {
        status: "DEAL_AGREED",
        agreedAmount: latest.amount,
        agreedCurrency: latest.currency,
        decidedAt: new Date(),
        decidedById: side === "consenter" ? session.userId : request.decidedById,
      },
    }),
    db.requestEvent.create({
      data: {
        requestId: id,
        type: "deal_agreed",
        actorName: session.user.name,
        actorSide: side,
        detail: { amount: latest.amount.toString(), currency: latest.currency },
      },
    }),
  ]);
  await revealContacts(id);
  // Move into agreement-mode selection
  await db.consentRequest.update({ where: { id }, data: { status: "AGREEMENT_MODE_PENDING" } });

  const msg = {
    title: `Deal agreed on request #${request.number}`,
    body: `${latest.currency} ${latest.amount.toString()} — contact details are now shared so you can settle directly. Consent does not process or track this payment. Next: choose the agreement mode.`,
    critical: true,
  };
  await notifyRequesterTeam(request.requesterId, { ...msg, href: `/r-panel/requests/${id}` });
  await notifyConsenterTeam(request.consenterId, { ...msg, href: `/c-panel/requests/${id}` });
  redirect(path);
}

export async function closeNegotiationAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side, requesterMember } = await resolveSide(id);
  const path = panelPath(side, id);
  await assertCanAct(side, requesterMember, path);
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
    body: "The other side closed the negotiation. The per-request fee is not refunded.",
    href: panelPath(side === "consenter" ? "requester" : "consenter", id),
  });
  redirect(path);
}
