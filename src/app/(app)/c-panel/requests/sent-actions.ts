"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, setActiveProfile } from "@/lib/auth";
import { sentHref } from "./sent-step";

/**
 * Opens a request this person made, in the requester workspace of the
 * profile it was sent from. Every sent row in the owner workspace opens
 * through here: the requester pages show the active profile's requests, and
 * switching before the redirect renders the requester nav and switcher too.
 */
export async function openSentRequestAction(formData: FormData) {
  const session = await requireUser();
  const id = String(formData.get("id") ?? "");
  const request = id
    ? await db.consentRequest.findUnique({ where: { id }, select: { id: true, status: true, requesterId: true } })
    : null;
  const member = request
    ? await db.requesterMember.findUnique({
        where: { requesterId_userId: { requesterId: request.requesterId, userId: session.userId } },
      })
    : null;
  if (!request || !member) redirect("/c-panel/requests?tab=Sent");
  await setActiveProfile({ kind: "requester", id: request.requesterId });
  redirect(sentHref(request));
}
