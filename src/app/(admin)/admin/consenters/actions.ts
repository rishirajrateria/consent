"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyConsenterTeam } from "@/lib/notify";

export async function decideConsenterAction(formData: FormData) {
  const session = await requireAdmin("consenters", "approve");
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const note = String(formData.get("note") ?? "").trim();
  const profile = await db.consenterProfile.findUnique({ where: { id } });
  if (!profile) redirect("/admin/consenters");

  const statusMap = {
    verify: "APPROVED",
    reject: "REJECTED",
    more_info: "MORE_INFO_NEEDED",
    under_review: "UNDER_REVIEW",
  } as const;
  const status = statusMap[decision as keyof typeof statusMap];
  if (!status) redirect(`/admin/consenters/${id}`);

  if (status === "APPROVED" && profile.duplicateFlag) {
    redirect(
      `/admin/consenters/${id}?error=` +
        encodeURIComponent("Duplicate flag must be cleared before verification (one entity = one account).")
    );
  }

  await db.consenterProfile.update({
    where: { id },
    data: {
      status,
      adminNotes: note || profile.adminNotes,
      verifiedAt: status === "APPROVED" ? new Date() : profile.verifiedAt,
    },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: `consenter_${decision}`,
    module: "consenters",
    targetId: id,
    reason: note || null,
  });
  const messages = {
    APPROVED: {
      title: "You're verified ✓",
      body: "Your profile is now searchable and can receive consent requests. Set up your consent matrix next.",
      href: "/c-panel",
    },
    REJECTED: { title: "Verification rejected", body: note || "See your onboarding page.", href: "/onboarding/consenter" },
    MORE_INFO_NEEDED: { title: "More information needed", body: note || "The verification team needs more information.", href: "/onboarding/consenter" },
    UNDER_REVIEW: { title: "Verification in progress", body: "Your documents are being reviewed.", href: "/onboarding/consenter" },
  } as const;
  await notifyConsenterTeam(id, { ...messages[status], critical: status === "APPROVED" });
  redirect(`/admin/consenters/${id}?done=1`);
}

export async function clearDuplicateFlagAction(formData: FormData) {
  const session = await requireAdmin("consenters", "approve");
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) redirect(`/admin/consenters/${id}?error=${encodeURIComponent("A reason is required to clear a duplicate flag")}`);
  await db.consenterProfile.update({ where: { id }, data: { duplicateFlag: false } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "consenter_duplicate_cleared",
    module: "consenters",
    targetId: id,
    reason,
  });
  redirect(`/admin/consenters/${id}?done=1`);
}

export async function scheduleMeetingAction(formData: FormData) {
  const session = await requireAdmin("consenters", "edit");
  const id = String(formData.get("id"));
  const scheduledAt = new Date(String(formData.get("scheduledAt")));
  const mode = String(formData.get("mode")) === "IN_PERSON" ? "IN_PERSON" : "VIDEO";
  const link = String(formData.get("link") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  if (isNaN(scheduledAt.getTime()))
    redirect(`/admin/consenters/${id}?error=${encodeURIComponent("Pick a valid date and time")}`);
  await db.verificationMeeting.create({
    data: { consenterId: id, scheduledAt, mode, link, location, officerId: session.userId },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "verification_meeting_scheduled",
    module: "consenters",
    targetId: id,
  });
  await notifyConsenterTeam(id, {
    title: "Verification meeting scheduled",
    body: `${scheduledAt.toUTCString()} · ${mode === "VIDEO" ? "Video call" : "In person"}`,
    href: "/onboarding/consenter",
    critical: true,
  });
  redirect(`/admin/consenters/${id}?done=1`);
}

export async function recordMeetingOutcomeAction(formData: FormData) {
  const session = await requireAdmin("consenters", "edit");
  const meetingId = String(formData.get("meetingId"));
  const outcome = String(formData.get("outcome"));
  const notes = String(formData.get("notes") ?? "").trim();
  const meeting = await db.verificationMeeting.update({
    where: { id: meetingId },
    data: { outcome, notes: notes || null },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "verification_meeting_outcome",
    module: "consenters",
    targetId: meeting.consenterId,
    detail: { outcome },
  });
  redirect(`/admin/consenters/${meeting.consenterId}?done=1`);
}
