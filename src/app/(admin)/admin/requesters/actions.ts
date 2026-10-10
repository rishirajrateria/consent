"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyRequesterTeam } from "@/lib/notify";
import { DECIDABLE_REQUESTER_STATUSES } from "./statuses";

export async function decideRequesterAction(formData: FormData) {
  const session = await requireAdmin("requesters", "approve");
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")); // approve | reject | more_info | under_review
  const note = String(formData.get("note") ?? "").trim();

  const profile = await db.requesterProfile.findUnique({ where: { id } });
  if (!profile) redirect("/admin/requesters");
  const back = (msg: string) => redirect(`/admin/requesters/${id}?error=${encodeURIComponent(msg)}`);
  if (!(DECIDABLE_REQUESTER_STATUSES as readonly string[]).includes(profile.status))
    back(
      profile.status === "APPROVED"
        ? "This requester is already approved. To pause the account, use Users."
        : "The applicant hasn't sent this application yet."
    );
  // The applicant can't act on a reject or a request for info without knowing why.
  if ((decision === "reject" || decision === "more_info") && !note)
    back(decision === "reject" ? "Write a message saying why before you reject." : "Write a message saying what you need.");

  const statusMap = {
    approve: "APPROVED",
    reject: "REJECTED",
    more_info: "MORE_INFO_NEEDED",
    under_review: "UNDER_REVIEW",
  } as const;
  const status = statusMap[decision as keyof typeof statusMap];
  if (!status) redirect(`/admin/requesters/${id}`);

  await db.requesterProfile.update({
    where: { id },
    data: {
      status,
      adminNotes: note || profile.adminNotes,
      approvedAt: status === "APPROVED" ? new Date() : profile.approvedAt,
    },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: `requester_${decision}`,
    module: "requesters",
    targetId: id,
    reason: note || null,
  });
  const messages = {
    APPROVED: {
      title: "Application approved 🎉",
      body: `${note ? `${note}\n\n` : ""}Pay the onboarding fee + first yearly subscription to activate your account.`,
      href: "/onboarding/requester",
    },
    REJECTED: { title: "Application rejected", body: note, href: "/onboarding/requester" },
    MORE_INFO_NEEDED: { title: "More information needed", body: note, href: "/onboarding/requester" },
    UNDER_REVIEW: { title: "Application under review", body: note || "Your requester application is now being reviewed.", href: "/onboarding/requester" },
  } as const;
  await notifyRequesterTeam(id, messages[status]);
  redirect(`/admin/requesters/${id}?done=1`);
}
