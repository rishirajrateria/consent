"use server";

import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireConsenter } from "@/lib/auth";
import { removeMember } from "@/lib/profiles";
import { email } from "@/lib/providers";
import { audit } from "@/lib/audit";
import { ROLE_LABEL, canManageTeam, grantProblem, readInvite } from "./roles";

const PATH = "/c-panel/team";

function fail(error: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(error)}`);
}

/** Invites someone to help run the active profile. They join both halves when they accept. */
export async function inviteMemberAction(formData: FormData) {
  const { session, consenter, member } = await requireConsenter("canManageTeam");
  if (!canManageTeam(member)) fail("Only the owner or a manager who can manage the team can invite people.");
  const read = readInvite(formData);
  if (!read.ok) fail(read.error);
  const { to, role, flags } = read.invite;
  // A manager can't give a permission they don't hold.
  const problem = grantProblem(member, flags);
  if (problem) fail(problem);

  const already = await db.consenterMember.findFirst({
    where: { consenterId: consenter.id, user: { email: { equals: to, mode: "insensitive" } } },
  });
  if (already) fail(`${to} is already on the team.`);

  // A new invite to the same address replaces any open one.
  const asker = await db.requesterProfile.findUnique({ where: { consenterId: consenter.id }, select: { id: true } });
  await db.teamInvite.deleteMany({
    where: {
      email: to,
      acceptedAt: null,
      OR: [
        { profileKind: "consenter", profileId: consenter.id },
        ...(asker ? [{ profileKind: "requester", profileId: asker.id }] : []),
      ],
    },
  });
  const token = randomBytes(24).toString("hex");
  await db.teamInvite.create({
    data: {
      profileKind: "consenter",
      profileId: consenter.id,
      email: to,
      role,
      ...flags,
      token,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    },
  });
  await email.send(
    to,
    `You're invited to help run ${consenter.displayName} on Consent`,
    `${session.user.name} invited you to the ${consenter.displayName} team as ${ROLE_LABEL[role]}.\nAccept: ${process.env.APP_URL ?? ""}/invite/${token}\nOpen the link, sign in or create an account with this email, then accept. The invite expires in 7 days.`,
  );
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "team_invite_sent",
    module: "teams",
    targetId: consenter.id,
    detail: { to, role, ...flags },
  });
  redirect(`${PATH}?invited=1`);
}

/** Withdraws an invite that hasn't been accepted yet. */
export async function cancelInviteAction(formData: FormData) {
  const { session, consenter, member } = await requireConsenter("canManageTeam");
  if (!canManageTeam(member)) fail("Only the owner or a manager who can manage the team can withdraw invites.");
  const id = String(formData.get("inviteId") ?? "");
  const asker = await db.requesterProfile.findUnique({ where: { consenterId: consenter.id }, select: { id: true } });
  const invite = id ? await db.teamInvite.findUnique({ where: { id } }) : null;
  const ours =
    !!invite &&
    !invite.acceptedAt &&
    ((invite.profileKind === "consenter" && invite.profileId === consenter.id) ||
      (invite.profileKind === "requester" && !!asker && invite.profileId === asker.id));
  if (!invite || !ours) redirect(PATH);
  await db.teamInvite.delete({ where: { id } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "team_invite_cancelled",
    module: "teams",
    targetId: consenter.id,
    detail: { to: invite.email },
  });
  redirect(`${PATH}?cancelled=1`);
}

/** Removes someone from the profile's team (both halves). */
export async function removeMemberAction(formData: FormData) {
  const { session, consenter, member } = await requireConsenter("canManageTeam");
  if (!canManageTeam(member)) fail("Only the owner or a manager who can manage the team can remove people.");
  const memberId = String(formData.get("memberId") ?? "");
  const target = memberId ? await db.consenterMember.findUnique({ where: { id: memberId } }) : null;
  if (!target || target.consenterId !== consenter.id) redirect(PATH);
  if (target.role === "OWNER") fail("The owner can't be removed.");
  if (target.id === member.id) fail("You can't remove yourself.");
  await db.$transaction((tx) => removeMember(consenter.id, target.userId, tx));
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "team_member_removed",
    module: "teams",
    targetId: consenter.id,
    detail: { removedUserId: target.userId },
  });
  redirect(`${PATH}?removed=1`);
}
