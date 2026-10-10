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
  // `note` is the message the applicant sees; `internalNote` stays with the team (audit log only).
  const note = String(formData.get("note") ?? "").trim();
  const internalNote = String(formData.get("internalNote") ?? "").trim();
  const profile = await db.consenterProfile.findUnique({ where: { id } });
  if (!profile) redirect("/admin/consenters");
  // A verified profile is live; sending it back to review goes through Users (reason + notice).
  if (profile.status === "APPROVED")
    redirect(
      `/admin/consenters/${id}?error=` +
        encodeURIComponent("This profile is already verified. To send it back to review, use Users.")
    );
  if ((decision === "reject" || decision === "more_info") && !note)
    redirect(
      `/admin/consenters/${id}?error=` +
        encodeURIComponent(
          decision === "reject"
            ? "Write a message to the applicant saying why before you reject."
            : "Write a message to the applicant saying what you need."
        )
    );

  const statusMap = {
    verify: "APPROVED",
    reject: "REJECTED",
    more_info: "MORE_INFO_NEEDED",
    under_review: "UNDER_REVIEW",
  } as const;
  const status = statusMap[decision as keyof typeof statusMap];
  if (!status) redirect(`/admin/consenters/${id}`);

  if (status === "APPROVED") {
    const passedMeeting = await db.verificationMeeting.findFirst({
      where: { consenterId: id, outcome: "passed" },
    });
    if (!passedMeeting) {
      redirect(
        `/admin/consenters/${id}?error=` +
          encodeURIComponent("The mandatory verification meeting must be held and marked passed before verifying.")
      );
    }
  }
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
    reason: [internalNote && `Internal: ${internalNote}`, note && `Told applicant: ${note}`].filter(Boolean).join(" · ") || null,
  });
  const messages = {
    APPROVED: {
      title: "You're verified ✓",
      body: `${note ? `${note}\n\n` : ""}Your profile is now searchable and can receive consent requests. Set up your consent matrix next.`,
      href: "/c-panel",
    },
    REJECTED: { title: "Verification rejected", body: note, href: "/onboarding/consenter" },
    MORE_INFO_NEEDED: { title: "More information needed", body: note, href: "/onboarding/consenter" },
    UNDER_REVIEW: { title: "Verification in progress", body: note || "Your documents are being reviewed.", href: "/onboarding/consenter" },
  } as const;
  await notifyConsenterTeam(id, { ...messages[status], critical: status === "APPROVED" });
  if (status === "APPROVED") {
    // Tell everyone who invited this entity that they're now live.
    const { claimInvitesForConsenter } = await import("@/app/(app)/invites/actions");
    const owner = await db.consenterMember.findFirst({
      where: { consenterId: id, role: "OWNER" },
      include: { user: true },
    });
    await claimInvitesForConsenter({
      consenterId: id,
      displayName: profile.displayName,
      normalizedLegalName: profile.normalizedLegalName,
      ownerEmail: owner?.user.email ?? "",
      stage: "verified",
    });
  }
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
