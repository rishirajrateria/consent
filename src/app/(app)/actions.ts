"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession, requireConsenter, setActiveProfile } from "@/lib/auth";
import { ensureProfileFor } from "@/lib/profiles";

/**
 * The profile a switcher value names: a profile id, "consenter:<id>", or an
 * old "requester:<id>" (mapped to the profile that sending half belongs to).
 */
async function profileIdOf(value: string): Promise<string | null> {
  const [kind, id] = value.includes(":") ? value.split(":") : ["consenter", value];
  if (!id) return null;
  if (kind === "consenter") return id;
  if (kind === "requester") {
    const r = await db.requesterProfile.findUnique({ where: { id }, select: { id: true } });
    return r ? ensureProfileFor(r.id) : null;
  }
  return null;
}

/** Switch to another profile this person belongs to, then open its Home. */
export async function switchProfileAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const profileId = await profileIdOf(String(formData.get("profile") ?? "").trim());
  const member = profileId
    ? await db.consenterMember.findUnique({
        where: { consenterId_userId: { consenterId: profileId, userId: session.userId } },
        select: { consenterId: true },
      })
    : null;
  if (!member) redirect("/dashboard");
  await setActiveProfile({ kind: "consenter", id: member.consenterId });
  redirect("/c-panel");
}

export async function markNotificationsReadAction() {
  const session = await getSession();
  if (!session) redirect("/login");
  await db.notification.updateMany({
    where: { userId: session.userId, readAt: null },
    data: { readAt: new Date() },
  });
  redirect("/notifications");
}

/**
 * Hide Home's "Set different fees for different kinds of consent" nudge for
 * the active profile on this device.
 */
export async function dismissFeeNudgeAction() {
  const { consenter } = await requireConsenter();
  (await cookies()).set(`fee-nudge-${consenter.id}`, "off", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 31536000,
  });
  redirect("/c-panel");
}
