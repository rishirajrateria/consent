"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession, setActiveProfile } from "@/lib/auth";

export async function switchProfileAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const value = String(formData.get("profile") ?? "");
  if (value === "none") {
    await setActiveProfile(null);
    redirect("/dashboard");
  }
  const [kind, id] = value.split(":");
  if (kind === "consenter") {
    const m = await db.consenterMember.findUnique({
      where: { consenterId_userId: { consenterId: id, userId: session.userId } },
    });
    if (m) {
      await setActiveProfile({ kind: "consenter", id });
      redirect("/c-panel");
    }
  }
  if (kind === "requester") {
    const m = await db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: id, userId: session.userId } },
    });
    if (m) {
      await setActiveProfile({ kind: "requester", id });
      redirect("/r-panel");
    }
  }
  redirect("/dashboard");
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
