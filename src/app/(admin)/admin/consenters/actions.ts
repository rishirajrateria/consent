"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyConsenterTeam } from "@/lib/notify";
import { ensureAsker, syncPair } from "@/lib/profiles";
import { requireIdCheck, ID_CHECK_MODULE } from "./perm";
import { decidable } from "./statuses";

const back = (id: string, error: string): never =>
  redirect(`/admin/consenters/${id}?error=${encodeURIComponent(error)}`);

/**
 * The one ID-check decision. A profile is a pair (the profile and its
 * sending half), so the decision is written to both in one transaction:
 * approve once, and the profile can send and receive. The verification call
 * is optional; a possible duplicate still blocks approval until it's cleared.
 */
export async function decideProfileAction(formData: FormData) {
  const session = await requireIdCheck("approve");
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // approve | reject | more_info | under_review
  // `note` is the message the applicant sees; `internalNote` stays with the team (audit log only).
  const note = String(formData.get("note") ?? "").trim();
  const internalNote = String(formData.get("internalNote") ?? "").trim();
  const profile = await db.consenterProfile.findUnique({ where: { id } });
  if (!profile) redirect("/admin/consenters");
  if (!decidable(profile.status))
    back(
      id,
      profile.status === "APPROVED"
        ? "This profile is already verified. To send it back to review, use Users."
        : "They haven't sent their application yet.",
    );
  if ((decision === "reject" || decision === "more_info") && !note)
    back(
      id,
      decision === "reject"
        ? "Write a message to the applicant saying why before you reject."
        : "Write a message to the applicant saying what you need.",
    );

  const statusMap = {
    approve: "APPROVED",
    reject: "REJECTED",
    more_info: "MORE_INFO_NEEDED",
    under_review: "UNDER_REVIEW",
  } as const;
  const status = statusMap[decision as keyof typeof statusMap];
  if (!status) redirect(`/admin/consenters/${id}`);
  if (status === "APPROVED" && profile.duplicateFlag)
    back(id, "Clear the duplicate flag before you approve. One person or name, one account.");

  // An older profile may still lack its sending half: create it (team mirrored) first.
  const asker = await ensureAsker(id);
  await db.$transaction(async (tx) => {
    await tx.consenterProfile.update({
      where: { id },
      data: {
        status,
        adminNotes: note || profile.adminNotes,
        verifiedAt: status === "APPROVED" ? new Date() : profile.verifiedAt,
      },
    });
    // Status and approval date go to the sending half too.
    await syncPair(id, tx);
    if (note) await tx.requesterProfile.update({ where: { id: asker.id }, data: { adminNotes: note } });
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: `profile_${decision}`,
    module: ID_CHECK_MODULE,
    targetId: id,
    detail: { requesterId: asker.id, status },
    reason: [internalNote && `Internal: ${internalNote}`, note && `Told applicant: ${note}`].filter(Boolean).join(" · ") || null,
  });
  const onboarding = `/onboarding?profile=${id}`;
  const messages = {
    APPROVED: {
      title: "You're verified ✓",
      body: `${note ? `${note}\n\n` : ""}You can now send and receive consent requests. Your fee, limits and terms are in Profile.`,
      href: "/c-panel",
    },
    REJECTED: { title: "Your ID check wasn't approved", body: note, href: onboarding },
    MORE_INFO_NEEDED: { title: "More information needed", body: note, href: onboarding },
    UNDER_REVIEW: { title: "Your ID check is in review", body: note || "We're reviewing your documents.", href: onboarding },
  } as const;
  // The team sits in both halves, so the profile's team is everyone.
  await notifyConsenterTeam(id, { ...messages[status], critical: status === "APPROVED" });
  if (status === "APPROVED") {
    // Tell everyone who invited this person or name that they're now live.
    const { claimInvitesForConsenter } = await import("@/app/(app)/invites/claim");
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
  redirect(`/admin/consenters/${id}?done=decided`);
}

export async function clearDuplicateFlagAction(formData: FormData) {
  const session = await requireIdCheck("approve");
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) back(id, "A reason is required to clear a duplicate flag");
  await db.consenterProfile.update({ where: { id }, data: { duplicateFlag: false } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "profile_duplicate_cleared",
    module: ID_CHECK_MODULE,
    targetId: id,
    reason,
  });
  redirect(`/admin/consenters/${id}?done=flag`);
}

/** An optional verification call, when the documents need a closer look. */
export async function scheduleMeetingAction(formData: FormData) {
  const session = await requireIdCheck("edit");
  const id = String(formData.get("id"));
  const scheduledAt = new Date(String(formData.get("scheduledAt")));
  const mode = String(formData.get("mode")) === "IN_PERSON" ? "IN_PERSON" : "VIDEO";
  const link = String(formData.get("link") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  if (isNaN(scheduledAt.getTime())) back(id, "Pick a valid date and time");
  await db.verificationMeeting.create({
    data: { consenterId: id, scheduledAt, mode, link, location, officerId: session.userId },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "verification_meeting_scheduled",
    module: ID_CHECK_MODULE,
    targetId: id,
  });
  await notifyConsenterTeam(id, {
    title: "Verification call scheduled",
    body: `${scheduledAt.toUTCString()} · ${mode === "VIDEO" ? "Video call" : "In person"}${link ? ` · ${link}` : ""}${location ? ` · ${location}` : ""}. It helps us confirm your documents.`,
    href: `/onboarding?profile=${id}`,
    critical: true,
  });
  redirect(`/admin/consenters/${id}?done=decided`);
}

export async function recordMeetingOutcomeAction(formData: FormData) {
  const session = await requireIdCheck("edit");
  const meetingId = String(formData.get("meetingId"));
  const outcome = String(formData.get("outcome")) === "failed" ? "failed" : "passed";
  const notes = String(formData.get("notes") ?? "").trim();
  const meeting = await db.verificationMeeting.update({
    where: { id: meetingId },
    data: { outcome, notes: notes || null },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "verification_meeting_outcome",
    module: ID_CHECK_MODULE,
    targetId: meeting.consenterId,
    detail: { outcome },
  });
  redirect(`/admin/consenters/${meeting.consenterId}?done=call`);
}
