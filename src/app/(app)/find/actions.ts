"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, setActiveProfile } from "@/lib/auth";
import { ensureAsker, profilesOf } from "@/lib/profiles";
import { canSend } from "@/lib/membership";
import { getSettings } from "@/lib/settings";
import { createDraftAction } from "../r-panel/requests/actions";

/** Back to Find with an error, keeping the search. Nothing has switched yet. */
function backToFind(formData: FormData, error: string): never {
  const q = String(formData.get("q") ?? "").trim();
  redirect(`/find?${new URLSearchParams(q ? { q, error } : { error })}`);
}

/**
 * "Ask for permission" on Find. Opening Find never switches profiles; asking
 * does when the person asks as a profile other than the active one, because
 * the draft belongs to the profile that asks. Every check that can fail runs
 * here first, so a failed ask leaves the person on Find with the profile they
 * were using.
 */
export async function askFromFindAction(formData: FormData) {
  const session = await requireUser();
  const profileId = String(formData.get("profile") ?? "");
  const slug = String(formData.get("consenter") ?? "");
  const [profiles, settings] = await Promise.all([profilesOf(session.userId), getSettings()]);

  if (slug && profiles.some((m) => m.consenter.slug === slug))
    backToFind(formData, "This is your profile. You can't ask yourself.");
  const seat = profiles.find((m) => m.consenterId === profileId);
  if (!seat) backToFind(formData, "We couldn't find the profile you ask as.");
  if (seat.role === "VIEWER")
    backToFind(formData, `You have view-only access to ${seat.consenter.displayName}, so you can't send requests for it.`);
  const asker = seat.consenter.asker ?? (await ensureAsker(seat.consenterId));
  if (!canSend({ status: seat.consenter.status, membershipEndsAt: asker.membershipEndsAt }, settings.membershipFeeOn))
    backToFind(
      formData,
      seat.consenter.status !== "APPROVED"
        ? "You can ask once your ID check is approved."
        : "Sending requests needs a membership. Get one in Payments & membership.",
    );

  // The same checks createDraftAction makes, run here first: if one failed
  // there, it would happen after the switch.
  const owner = slug
    ? await db.consenterProfile.findUnique({ where: { slug }, select: { id: true, displayName: true, status: true } })
    : null;
  if (!owner || owner.status !== "APPROVED") backToFind(formData, "We couldn't find that profile.");
  const blocked = await db.listEntry.findUnique({
    where: { kind_consenterId_requesterId: { kind: "BLACKLIST", consenterId: owner.id, requesterId: asker.id } },
    select: { id: true },
  });
  if (blocked) backToFind(formData, `${owner.displayName} isn't taking requests from you.`);
  if (asker.score < settings.requesterMinScoreGate)
    backToFind(
      formData,
      `Your Consent Score is too low to send requests right now (the minimum is ${settings.requesterMinScoreGate}).`,
    );

  // Switch only when asking as a different profile. setActiveProfile keeps
  // this request's copy of the session in step, so createDraftAction sees it.
  if (session.activeProfile !== `consenter:${seat.consenterId}`) {
    await setActiveProfile({ kind: "consenter", id: seat.consenterId });
  }
  // createDraftAction checks again (nothing changes in between) and opens the draft.
  return createDraftAction(formData);
}

/**
 * "Get a membership" on Find (only while the membership fee is on). Payments
 * & membership shows the active profile, so switch to the one that needs it
 * first; otherwise a person with more than one profile could land on another.
 */
export async function membershipFromFindAction(formData: FormData) {
  const session = await requireUser();
  const profileId = String(formData.get("profile") ?? "");
  const member = profileId
    ? await db.consenterMember.findUnique({
        where: { consenterId_userId: { consenterId: profileId, userId: session.userId } },
        select: { consenterId: true },
      })
    : null;
  if (!member) backToFind(formData, "We couldn't find that profile.");
  if (session.activeProfile !== `consenter:${member.consenterId}`) {
    await setActiveProfile({ kind: "consenter", id: member.consenterId });
  }
  redirect("/r-panel/billing");
}
