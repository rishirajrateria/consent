"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, newTotpSecret, verifyTotp, hashPassword, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function beginTotpSetupAction() {
  const session = await requireUser();
  if (session.user.totpEnabled) redirect("/settings");
  const secret = newTotpSecret();
  await db.user.update({ where: { id: session.userId }, data: { totpSecret: secret, totpEnabled: false } });
  redirect("/settings/security");
}

export async function confirmTotpAction(formData: FormData) {
  const session = await requireUser();
  const code = String(formData.get("code") ?? "").trim();
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user?.totpSecret || !verifyTotp(user.totpSecret, code)) {
    redirect("/settings/security?error=" + encodeURIComponent("Invalid code — try again"));
  }
  await db.user.update({ where: { id: session.userId }, data: { totpEnabled: true } });
  await db.session.update({ where: { id: session.id }, data: { totpPassed: true } });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "totp_enabled", module: "auth" });
  redirect("/settings?totp=on");
}

export async function disableTotpAction(formData: FormData) {
  const session = await requireUser();
  const code = String(formData.get("code") ?? "").trim();
  const user = await db.user.findUnique({ where: { id: session.userId }, include: { adminRole: true } });
  if (user?.adminRole) redirect("/settings?error=" + encodeURIComponent("Admins must keep 2FA enabled"));
  const isConsenterMember = await db.consenterMember.findFirst({ where: { userId: session.userId } });
  if (isConsenterMember) redirect("/settings?error=" + encodeURIComponent("Consenter team members must keep 2FA enabled"));
  if (!user?.totpSecret || !verifyTotp(user.totpSecret, code))
    redirect("/settings?error=" + encodeURIComponent("Invalid authenticator code"));
  await db.user.update({ where: { id: session.userId }, data: { totpEnabled: false, totpSecret: null } });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "totp_disabled", module: "auth" });
  redirect("/settings?totp=off");
}

export async function changePasswordAction(formData: FormData) {
  const session = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (next.length < 8) redirect("/settings?error=" + encodeURIComponent("New password must be at least 8 characters"));
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || !(await verifyPassword(current, user.passwordHash)))
    redirect("/settings?error=" + encodeURIComponent("Current password is incorrect"));
  await db.user.update({ where: { id: session.userId }, data: { passwordHash: await hashPassword(next) } });
  await audit({ actorId: session.userId, actorName: user.name, action: "password_changed", module: "auth" });
  redirect("/settings?pw=changed");
}

export async function savePrefsAction(formData: FormData) {
  const session = await requireUser();
  await db.notificationPref.upsert({
    where: { userId: session.userId },
    update: {
      emailStateChanges: formData.get("emailStateChanges") === "on",
      smsCritical: formData.get("smsCritical") === "on",
    },
    create: {
      userId: session.userId,
      emailStateChanges: formData.get("emailStateChanges") === "on",
      smsCritical: formData.get("smsCritical") === "on",
    },
  });
  redirect("/settings?prefs=saved");
}

export async function requestDeletionAction() {
  const session = await requireUser();
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "account_deletion_requested",
    module: "privacy",
    detail: { note: "Legally required records (certificates, audit logs) are retained." },
  });
  redirect("/settings?deletion=requested");
}
