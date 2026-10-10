"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, setActiveProfile } from "@/lib/auth";
import { requesterActive } from "@/lib/payments";
import { getSettings } from "@/lib/settings";
import { createDraftAction } from "../r-panel/requests/actions";

/** Back to Find with an error, keeping the search. Nothing has switched yet. */
function backToFind(formData: FormData, error: string): never {
  const q = String(formData.get("q") ?? "").trim();
  redirect(`/find?${new URLSearchParams(q ? { q, error } : { error })}`);
}

/**
 * "Ask for permission" on Find. Opening Find never switches profiles; asking
 * does, because the draft lives in the requester workspace. Every check that
 * can fail here runs before the switch, so a failed ask leaves the person on
 * Find in the workspace they were in. Then switch to the asking profile Find
 * showed, so createDraftAction uses that one even when the person is in their
 * owner workspace or has more than one profile.
 */
export async function askFromFindAction(formData: FormData) {
  const session = await requireUser();
  const requesterId = String(formData.get("requester") ?? "");
  const slug = String(formData.get("consenter") ?? "");
  const [member, ownSeat] = await Promise.all([
    requesterId
      ? db.requesterMember.findUnique({
          where: { requesterId_userId: { requesterId, userId: session.userId } },
          include: { requester: true },
        })
      : null,
    slug
      ? db.consenterMember.findFirst({
          where: { userId: session.userId, consenter: { slug } },
          select: { id: true },
        })
      : null,
  ]);
  if (ownSeat) backToFind(formData, "You can't ask your own profile.");
  if (!member || member.role === "VIEWER" || !requesterActive(member.requester))
    backToFind(formData, "Your asking profile can't send requests right now.");

  // The same checks createDraftAction makes, run here first: if one failed
  // there, it would happen after the switch and land on New request instead.
  const owner = slug
    ? await db.consenterProfile.findUnique({ where: { slug }, select: { id: true, displayName: true, status: true } })
    : null;
  if (!owner || owner.status !== "APPROVED") backToFind(formData, "We couldn't find that profile.");
  const [blocked, settings] = await Promise.all([
    db.listEntry.findUnique({
      where: {
        kind_consenterId_requesterId: { kind: "BLACKLIST", consenterId: owner.id, requesterId: member.requesterId },
      },
      select: { id: true },
    }),
    getSettings(),
  ]);
  if (blocked) backToFind(formData, `${owner.displayName} isn't taking requests from you.`);
  if (member.requester.score < settings.requesterMinScoreGate)
    backToFind(
      formData,
      `Your Consent Score (${member.requester.score}) is below the ${settings.requesterMinScoreGate} needed to send requests.`,
    );

  await setActiveProfile({ kind: "requester", id: member.requesterId });
  // The session is read once per request, so keep that copy in step too.
  session.activeProfile = `requester:${member.requesterId}`;
  // createDraftAction checks again (nothing changes in between) and opens the draft.
  return createDraftAction(formData);
}

/**
 * "Renew your plan" on Find. Billing shows the active asking profile, so
 * switch to the one whose plan ended first; otherwise a person with more than
 * one asking profile could land on billing for a different one.
 */
export async function renewFromFindAction(formData: FormData) {
  const session = await requireUser();
  const requesterId = String(formData.get("requester") ?? "");
  const member = requesterId
    ? await db.requesterMember.findUnique({
        where: { requesterId_userId: { requesterId, userId: session.userId } },
        select: { requesterId: true },
      })
    : null;
  if (!member) backToFind(formData, "We couldn't find that asking profile.");
  await setActiveProfile({ kind: "requester", id: member.requesterId });
  redirect("/r-panel/billing");
}
