"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireConsenter } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyRequesterTeam } from "@/lib/notify";
import { ApprovalError, approveAndIssue } from "@/lib/requests";
import { recalcConsenterScore } from "@/lib/score";
import type { Selection } from "@/lib/rules";
import type { Prisma, RequestStatus } from "@prisma/client";
import { syncConsentPrice } from "@/lib/escrow";
import { conditionProblem } from "./conditions";

function fail(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

/** Waiting for the owner's answer: sent to them, or asked about and not yet answered. */
const DECIDABLE: RequestStatus[] = ["PENDING", "CHANGES_REQUESTED"];

async function decidableRequest(id: string) {
  const { session, consenter } = await requireConsenter("canApprove");
  const request = await db.consentRequest.findUnique({
    where: { id },
    include: { requester: { select: { displayName: true } } },
  });
  if (!request || request.consenterId !== consenter.id || !request.submittedAt) redirect("/c-panel/requests");
  return { session, consenter, request };
}

/** Why a request can't be answered any more, when it was withdrawn or has ended; null otherwise. */
function endedReason(status: RequestStatus, asker: string): string | null {
  if (status === "WITHDRAWN") return `${asker} withdrew this request.`;
  if (status === "EXPIRED_NO_RESPONSE" || status === "CLOSED") return "This request has ended.";
  return null;
}

/** Why an answer didn't go through when the request moved meanwhile: they withdrew, it ended, or a teammate answered first. */
async function movedReason(id: string, asker: string): Promise<string> {
  const now = await db.consentRequest.findUnique({ where: { id }, select: { status: true } });
  return (now && endedReason(now.status, asker)) ?? "Someone on your team already answered this request.";
}

/** "2026-11-30" from a date input, stored like the dates they asked for (midnight UTC); null when not a date. */
function dateOnly(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Approve. Conditions can only narrow the request: fewer formats, shorter
 * clips, no thumbnail, an earlier end date, and a short written condition
 * that can't ask for money. The certificate is issued at once when the final
 * content file is in; otherwise the request is approved in principle and the
 * certificate follows the upload.
 */
export async function approveRequestAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request } = await decidableRequest(id);
  const path = `/c-panel/requests/${id}`;
  const asker = request.requester.displayName;
  if (!DECIDABLE.includes(request.status))
    fail(path, endedReason(request.status, asker) ?? "This request can no longer be approved.");

  // Fewer formats: the ticked ones stay (the form says it sent its ticks, so
  // none ticked means none kept). None kept would approve nothing.
  const selections = request.selections as Selection[];
  const kept = formData.getAll("keepFormat").map(String);
  const keptSelections =
    formData.get("formatsShown") === "1" ? selections.filter((s) => kept.includes(s.formatId)) : selections;
  if (keptSelections.length === 0) fail(path, "Keep at least one format, or decline.");

  // Shorter clips: a cap below what was asked.
  const approvedSelections = keptSelections.map((s) => {
    const cap = parseInt(String(formData.get(`cap_${s.formatId}`) ?? ""), 10);
    return s.durationSec && cap > 0 && cap < s.durationSec ? { ...s, durationSec: cap } : s;
  });

  // Browsers send textarea line breaks as CRLF: count them once, as the form's limit does.
  const conditionsNote = String(formData.get("conditionsNote") ?? "").replace(/\r\n?/g, "\n").trim() || null;
  const problem = conditionProblem(conditionsNote ?? "");
  if (problem) fail(path, problem);

  const approvedThumbnail = request.thumbnailUsed && formData.get("removeThumbnail") === "on" ? false : request.thumbnailUsed;

  // Shorter validity: only for a time window, an end date after today and before theirs.
  // (Single publication and perpetual have no end date to move, and the
  // certificate would still call them that.)
  const shortenRaw = String(formData.get("validUntil") ?? "").trim();
  let validUntil: Date | null = null;
  if (shortenRaw && request.validityKind !== "DATE_RANGE")
    fail(path, "Only a request for a time window can get an earlier end date.");
  if (shortenRaw) {
    validUntil = dateOnly(shortenRaw);
    if (!validUntil) fail(path, "Enter the end date as a date.");
    if (validUntil.getTime() <= Date.now()) fail(path, "Pick an end date after today.");
    if (request.validFrom && validUntil <= request.validFrom) fail(path, "Pick an end date after the start of the time window.");
    if (request.validUntil && validUntil >= request.validUntil)
      fail(path, "The end date can only make the time shorter. Pick a date before the one they asked for.");
  }

  // Answered, withdrawn or ended meanwhile (by a teammate, or them): say so, change nothing.
  let refused = false;
  try {
    await approveAndIssue({
      requestId: id,
      decidedById: session.userId,
      decidedByName: session.user.name,
      actorSide: "consenter",
      conditionsNote,
      approvedSelections: approvedSelections as unknown as Prisma.InputJsonValue,
      approvedThumbnail,
      ...(validUntil ? { validUntil } : {}),
    });
  } catch (e) {
    if (!(e instanceof ApprovalError)) throw e;
    refused = true;
  }
  if (refused) fail(path, await movedReason(id, asker));
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "request_approved",
    module: "requests",
    targetId: id,
  });
  redirect(path);
}

const NOTE_MAX = 2000;

/**
 * Ask: the owner asks a question or asks for a change. The asker answers in
 * writing (and may update their plan or upload a new file), which sends the
 * request back to the owner.
 */
export async function requestChangesAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, consenter, request } = await decidableRequest(id);
  const path = `/c-panel/requests/${id}`;
  if (request.status === "CHANGES_REQUESTED")
    fail(path, `You already asked. Wait for ${request.requester.displayName} to answer.`);
  if (request.status !== "PENDING") fail(path, "You can ask only while the request is waiting for your answer.");
  const note = String(formData.get("note") ?? "").replace(/\r\n?/g, "\n").trim();
  if (!note) fail(path, "Write what you want to ask or change.");
  if (note.length > NOTE_MAX) fail(path, `Keep your question under ${NOTE_MAX.toLocaleString("en-US")} characters.`);
  // Only one answer at a time, even if two teammates press at once.
  const asked = await db.$transaction(async (tx) => {
    const moved = await tx.consentRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "CHANGES_REQUESTED" },
    });
    if (moved.count === 0) return false;
    await tx.requestEvent.create({
      data: {
        requestId: id,
        type: "changes_requested",
        actorName: session.user.name,
        actorSide: "consenter",
        detail: { note },
      },
    });
    return true;
  });
  if (!asked) fail(path, await movedReason(id, request.requester.displayName));
  await notifyRequesterTeam(request.requesterId, {
    title: `${consenter.displayName} asked about request #${request.number}`,
    body: `"${note.length > 280 ? `${note.slice(0, 277)}…` : note}" Answer it on the request page. You can also update your plan or upload a new file.`,
    href: `/r-panel/requests/${id}`,
    critical: true,
  });
  redirect(path);
}

/** Decline. A no needs no reason; 80% of a paid consent request fee goes back to them. */
export async function denyRequestAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, consenter, request } = await decidableRequest(id);
  const path = `/c-panel/requests/${id}`;
  if (!DECIDABLE.includes(request.status))
    fail(path, endedReason(request.status, request.requester.displayName) ?? "This request can no longer be declined.");
  const reasonId = String(formData.get("reasonId") ?? "");
  const freeText = String(formData.get("freeText") ?? "").trim().slice(0, 500);
  const reason = reasonId ? (await db.denialReason.findUnique({ where: { id: reasonId } }))?.label : null;
  const denialReason = [reason, freeText].filter(Boolean).join(" — ") || null;

  const declined = await db.$transaction(async (tx) => {
    const moved = await tx.consentRequest.updateMany({
      where: { id, status: { in: DECIDABLE } },
      data: { status: "DENIED", decidedAt: new Date(), decidedById: session.userId, denialReason },
    });
    if (moved.count === 0) return false;
    await tx.requestEvent.create({
      data: {
        requestId: id,
        type: "denied",
        actorName: session.user.name,
        actorSide: "consenter",
        detail: { reason: denialReason },
      },
    });
    return true;
  });
  if (!declined) fail(path, await movedReason(id, request.requester.displayName));
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "request_denied",
    module: "requests",
    targetId: id,
    reason: denialReason,
  });
  // A no refunds 80% of a held consent request fee (and says so to them).
  await syncConsentPrice(id);
  await notifyRequesterTeam(request.requesterId, {
    title: `${consenter.displayName} declined request #${request.number}`,
    body: denialReason ? `Their reason: ${denialReason}` : "They didn't give a reason.",
    href: `/r-panel/requests/${id}`,
  });
  await recalcConsenterScore(consenter.id, `Responded to request #${request.number}`);
  redirect(path);
}
