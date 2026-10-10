"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRequester } from "@/lib/auth";
import { audit } from "@/lib/audit";

const PATH = "/r-panel/contact";

function fail(error: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(error)}`);
}

const text = (formData: FormData, name: string, max: number) =>
  String(formData.get(name) ?? "").trim().slice(0, max) || null;

/**
 * The contact details this requester profile shares with an owner, and which
 * of them. They're shared on a request only when the owner shares theirs.
 * The account owner decides, like the team and billing.
 */
export async function saveRequesterContactAction(formData: FormData) {
  const { session, member, requester } = await requireRequester();
  if (member.role !== "OWNER") fail("Only the account owner can change the contact details");

  const contactEmail = text(formData, "contactEmail", 200);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) fail("Enter a valid email address");

  await db.requesterProfile.update({
    where: { id: requester.id },
    data: {
      contactEmail,
      contactPhone: text(formData, "contactPhone", 40),
      contactAddress: text(formData, "contactAddress", 500),
      managerContact: text(formData, "managerContact", 200),
      shareEmail: formData.get("shareEmail") === "on",
      sharePhone: formData.get("sharePhone") === "on",
      shareAddress: formData.get("shareAddress") === "on",
      shareManager: formData.get("shareManager") === "on",
    },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "requester_contact_updated",
    module: "requesters",
    targetId: requester.id,
  });
  redirect(`${PATH}?saved=1`);
}
