"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireConsenter, requireRequester } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { storeUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { notifyConsenterTeam, notifyRequesterTeam } from "@/lib/notify";
import { recalcRequesterScore, recalcConsenterScore } from "@/lib/score";

function fail(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

export async function revokeGrantAction(formData: FormData) {
  const { session, consenter } = await requireConsenter("canApprove");
  const grantId = String(formData.get("grantId"));
  const reason = String(formData.get("reason") ?? "").trim();
  const grant = await db.grant.findUnique({ where: { id: grantId }, include: { request: true } });
  if (!grant || grant.request.consenterId !== consenter.id) redirect("/c-panel/requests");
  const path = `/c-panel/requests/${grant.requestId}`;
  if (grant.status !== "ACTIVE") fail(path, "Only active grants can be revoked");
  if (!reason) fail(path, "A reason is mandatory for revocation");

  await db.$transaction([
    db.grant.update({
      where: { id: grantId },
      data: { status: "REVOKED", revokedAt: new Date(), revokeReason: reason },
    }),
    db.requestEvent.create({
      data: {
        requestId: grant.requestId,
        type: "grant_revoked",
        actorName: session.user.name,
        actorSide: "consenter",
        detail: { reason },
      },
    }),
  ]);
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "grant_revoked",
    module: "grants",
    targetId: grantId,
    reason,
  });
  await notifyRequesterTeam(grant.request.requesterId, {
    title: `Grant ${grant.publicId} revoked`,
    body: `Revocation applies to future use only — content published within scope before today remains covered. Reason: ${reason}`,
    href: `/r-panel/requests/${grant.requestId}`,
    critical: true,
  });
  await recalcRequesterScore(grant.request.requesterId, "Grant revoked by consenter");
  redirect(path);
}

export async function raiseTakedownAction(formData: FormData) {
  const { session, consenter } = await requireConsenter("canApprove");
  const grantId = String(formData.get("grantId"));
  const reason = String(formData.get("reason") ?? "").trim();
  const links = String(formData.get("links") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const grant = await db.grant.findUnique({ where: { id: grantId }, include: { request: true } });
  if (!grant || grant.request.consenterId !== consenter.id) redirect("/c-panel/requests");
  const path = `/c-panel/requests/${grant.requestId}`;
  if (!reason || links.length === 0) fail(path, "A reason and at least one live link are required");

  const settings = await getSettings();
  await db.takedownRequest.create({
    data: {
      grantId,
      reason,
      liveLinks: links,
      respondBy: new Date(Date.now() + settings.takedownResponseDays * 86400_000),
    },
  });
  await db.requestEvent.create({
    data: {
      requestId: grant.requestId,
      type: "takedown_raised",
      actorName: session.user.name,
      actorSide: "consenter",
      detail: { reason, links },
    },
  });
  await notifyRequesterTeam(grant.request.requesterId, {
    title: `Takedown requested on grant ${grant.publicId}`,
    body: `${consenter.displayName} asks you to take the published content down. Respond within ${settings.takedownResponseDays} days: mark it taken down, or decline with a reason. Reason: ${reason}`,
    href: `/r-panel/requests/${grant.requestId}`,
    critical: true,
  });
  redirect(path);
}

export async function respondTakedownAction(formData: FormData) {
  const { session, requester } = await requireRequester();
  const takedownId = String(formData.get("takedownId"));
  const action = String(formData.get("action")); // down | decline
  const takedown = await db.takedownRequest.findUnique({
    where: { id: takedownId },
    include: { grant: { include: { request: true } } },
  });
  if (!takedown || takedown.grant.request.requesterId !== requester.id) redirect("/r-panel/requests");
  const path = `/r-panel/requests/${takedown.grant.requestId}`;
  if (takedown.status !== "RAISED" && takedown.status !== "REJECTED_CLAIM")
    fail(path, "This takedown request is no longer open");

  if (action === "down") {
    const note = String(formData.get("note") ?? "").trim() || null;
    let evidenceFileId: string | undefined;
    const screenshot = formData.get("screenshot") as File | null;
    if (screenshot && screenshot.size > 0) {
      const stored = await storeUpload({
        file: screenshot,
        kind: "EVIDENCE",
        uploadedById: session.userId,
        requestId: takedown.grant.requestId,
      });
      evidenceFileId = stored.id;
    }
    await db.takedownRequest.update({
      where: { id: takedownId },
      data: { status: "MARKED_DOWN", requesterNote: note, requesterEvidenceFileId: evidenceFileId, respondedAt: new Date() },
    });
    await db.requestEvent.create({
      data: {
        requestId: takedown.grant.requestId,
        type: "takedown_marked_down",
        actorName: session.user.name,
        actorSide: "requester",
      },
    });
    await notifyConsenterTeam(takedown.grant.request.consenterId, {
      title: `Content marked as taken down (grant ${takedown.grant.publicId})`,
      body: "Confirm in the app that the content is down, or reject the claim if it's still live.",
      href: `/c-panel/requests/${takedown.grant.requestId}`,
      critical: true,
    });
  } else {
    const declineReason = String(formData.get("declineReason") ?? "").trim();
    if (!declineReason) fail(path, "Give a reason for declining the takedown");
    await db.takedownRequest.update({
      where: { id: takedownId },
      data: { status: "DECLINED", declineReason, respondedAt: new Date() },
    });
    await db.requestEvent.create({
      data: {
        requestId: takedown.grant.requestId,
        type: "takedown_declined",
        actorName: session.user.name,
        actorSide: "requester",
        detail: { declineReason },
      },
    });
    await notifyConsenterTeam(takedown.grant.request.consenterId, {
      title: `Takedown declined (grant ${takedown.grant.publicId})`,
      body: `Reason: ${declineReason}. Consent records this; anything further is a real-world legal matter — you can export the Consent History Dossier.`,
      href: `/c-panel/requests/${takedown.grant.requestId}`,
    });
    await recalcRequesterScore(requester.id, "Takedown request declined");
  }
  redirect(path);
}

export async function confirmTakedownAction(formData: FormData) {
  const { session, consenter } = await requireConsenter("canApprove");
  const takedownId = String(formData.get("takedownId"));
  const action = String(formData.get("action")); // confirm | reject
  const takedown = await db.takedownRequest.findUnique({
    where: { id: takedownId },
    include: { grant: { include: { request: true } } },
  });
  if (!takedown || takedown.grant.request.consenterId !== consenter.id) redirect("/c-panel/requests");
  const path = `/c-panel/requests/${takedown.grant.requestId}`;
  if (takedown.status !== "MARKED_DOWN") fail(path, "Nothing to confirm");

  if (action === "confirm") {
    await db.takedownRequest.update({
      where: { id: takedownId },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    await db.requestEvent.create({
      data: {
        requestId: takedown.grant.requestId,
        type: "takedown_confirmed",
        actorName: session.user.name,
        actorSide: "consenter",
      },
    });
    await notifyRequesterTeam(takedown.grant.request.requesterId, {
      title: `Takedown confirmed (grant ${takedown.grant.publicId})`,
      body: "The consenter confirmed the content is down. This is logged on the certificate.",
      href: `/r-panel/requests/${takedown.grant.requestId}`,
    });
  } else {
    await db.takedownRequest.update({ where: { id: takedownId }, data: { status: "REJECTED_CLAIM" } });
    await db.requestEvent.create({
      data: {
        requestId: takedown.grant.requestId,
        type: "takedown_claim_rejected",
        actorName: session.user.name,
        actorSide: "consenter",
      },
    });
    await notifyRequesterTeam(takedown.grant.request.requesterId, {
      title: `Takedown claim rejected (grant ${takedown.grant.publicId})`,
      body: "The consenter says the content is still live. The takedown request is back with you.",
      href: `/r-panel/requests/${takedown.grant.requestId}`,
      critical: true,
    });
  }
  await recalcConsenterScore(consenter.id, "Takedown workflow updated");
  redirect(path);
}
