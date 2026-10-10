"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, verifyTotp, hashPassword, verifyPassword, safeNext } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function confirmTotpAction(formData: FormData) {
  const session = await requireUser();
  // Where the person was headed when 2FA was asked for (onboarding, a team invite).
  const next = safeNext(formData.get("next"));
  const code = String(formData.get("code") ?? "").trim();
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user?.totpSecret || !verifyTotp(user.totpSecret, code)) {
    const q = new URLSearchParams({ error: "That code didn't work. Try the newest code from your app." });
    if (next) q.set("next", next);
    redirect(`/settings/security?${q.toString()}`);
  }
  await db.user.update({ where: { id: session.userId }, data: { totpEnabled: true } });
  await db.session.update({ where: { id: session.id }, data: { totpPassed: true } });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "totp_enabled", module: "auth" });
  redirect(next ?? "/settings?totp=on");
}

/**
 * Two-factor authentication is required for every account (everyone can
 * answer requests), so it can't be turned off. Kept so an old form posting
 * here gets a plain answer.
 */
export async function disableTotpAction() {
  await requireUser();
  redirect("/settings?error=" + encodeURIComponent("Every account keeps two-factor authentication on."));
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
