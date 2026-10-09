"use server";

import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireConsenter, requireRequester } from "@/lib/auth";
import { email } from "@/lib/providers";
import { audit } from "@/lib/audit";
import type { TeamRole } from "@prisma/client";

export async function inviteConsenterMemberAction(formData: FormData) {
  const { session, consenter } = await requireConsenter("canManageTeam");
  const to = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role")) as TeamRole;
  if (!to || !["MANAGER", "LEGAL", "VIEWER"].includes(role))
    redirect("/c-panel/team?error=" + encodeURIComponent("Enter an email and pick a role"));
  const token = randomBytes(24).toString("hex");
  await db.teamInvite.create({
    data: {
      profileKind: "consenter",
      profileId: consenter.id,
      email: to,
      role,
      canApprove: formData.get("canApprove") === "on",
      canNegotiate: formData.get("canNegotiate") === "on",
      canEditRules: formData.get("canEditRules") === "on",
      canExport: formData.get("canExport") === "on",
      canManageTeam: formData.get("canManageTeam") === "on",
      token,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    },
  });
  await email.send(
    to,
    `You're invited to the ${consenter.displayName} team on Consent`,
    `${session.user.name} invited you as ${role}. Accept: ${process.env.APP_URL}/invite/${token}\n(Sign up with this email first if you don't have an account.)`
  );
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "team_invite_sent",
    module: "teams",
    targetId: consenter.id,
    detail: { to, role },
  });
  redirect("/c-panel/team?invited=1");
}

export async function removeConsenterMemberAction(formData: FormData) {
  const { session, consenter, member } = await requireConsenter("canManageTeam");
  const memberId = String(formData.get("memberId"));
  const target = await db.consenterMember.findUnique({ where: { id: memberId } });
  if (!target || target.consenterId !== consenter.id) redirect("/c-panel/team");
  if (target.role === "OWNER") redirect("/c-panel/team?error=" + encodeURIComponent("The owner cannot be removed"));
  if (target.id === member.id) redirect("/c-panel/team?error=" + encodeURIComponent("You cannot remove yourself"));
  await db.consenterMember.delete({ where: { id: memberId } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "team_member_removed",
    module: "teams",
    targetId: consenter.id,
    detail: { removedUserId: target.userId },
  });
  redirect("/c-panel/team?removed=1");
}

export async function inviteRequesterMemberAction(formData: FormData) {
  const { session, member, requester } = await requireRequester();
  if (member.role !== "OWNER")
    redirect("/r-panel/team?error=" + encodeURIComponent("Only the owner can invite members"));
  const to = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role")) as TeamRole;
  if (!to || !["EDITOR", "VIEWER"].includes(role))
    redirect("/r-panel/team?error=" + encodeURIComponent("Enter an email and pick a role"));
  const token = randomBytes(24).toString("hex");
  await db.teamInvite.create({
    data: {
      profileKind: "requester",
      profileId: requester.id,
      email: to,
      role,
      token,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    },
  });
  await email.send(
    to,
    `You're invited to the ${requester.displayName} team on Consent`,
    `${session.user.name} invited you as ${role}. Accept: ${process.env.APP_URL}/invite/${token}`
  );
  redirect("/r-panel/team?invited=1");
}

export async function removeRequesterMemberAction(formData: FormData) {
  const { session, member, requester } = await requireRequester();
  if (member.role !== "OWNER") redirect("/r-panel/team");
  const memberId = String(formData.get("memberId"));
  const target = await db.requesterMember.findUnique({ where: { id: memberId } });
  if (!target || target.requesterId !== requester.id || target.role === "OWNER") redirect("/r-panel/team");
  await db.requesterMember.delete({ where: { id: memberId } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "team_member_removed",
    module: "teams",
    targetId: requester.id,
  });
  redirect("/r-panel/team?removed=1");
}
