"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, setActiveProfile } from "@/lib/auth";
import { sentHref } from "./sent-step";

/**
 * Opens a request this person sent from another of their profiles: switch
 * to that profile first, then open it, so the header and profile switcher
 * show the profile it was sent from. (Rows sent from the active profile are
 * plain links.)
 */
export async function openSentRequestAction(formData: FormData) {
  const session = await requireUser();
  const id = String(formData.get("id") ?? "");
  const request = id
    ? await db.consentRequest.findUnique({
        where: { id },
        select: { id: true, status: true, requesterId: true, requester: { select: { consenterId: true } } },
      })
    : null;
  const seat = request
    ? await db.requesterMember.findUnique({
        where: { requesterId_userId: { requesterId: request.requesterId, userId: session.userId } },
        select: { id: true },
      })
    : null;
  if (!request || !seat) redirect("/c-panel/requests?tab=Sent");
  const active = session.activeProfile;
  if (!request.requester.consenterId || active !== `consenter:${request.requester.consenterId}`)
    await setActiveProfile({ kind: "requester", id: request.requesterId });
  redirect(sentHref(request));
}
