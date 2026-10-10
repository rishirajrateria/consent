"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

/**
 * Which side of a request the current user is on: the profile it was sent to
 * ("consenter") or the profile that sent it ("requester"), with their seat.
 */
export async function resolveSide(requestId: string) {
  const session = await requireUser();
  const request = await db.consentRequest.findUnique({
    where: { id: requestId },
    include: { consenter: true, requester: true },
  });
  if (!request) redirect("/dashboard");
  const [cm, rm] = await Promise.all([
    db.consenterMember.findUnique({
      where: { consenterId_userId: { consenterId: request.consenterId, userId: session.userId } },
    }),
    db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: request.requesterId, userId: session.userId } },
    }),
  ]);
  const side: "consenter" | "requester" | null = cm ? "consenter" : rm ? "requester" : null;
  if (!side) redirect("/dashboard");
  return { session, request, side, consenterMember: cm, requesterMember: rm };
}

/** View-only seats are read-only on either side: pass the seat for the side resolveSide found. */
export async function assertCanAct(seat: { role: string } | null, path: string) {
  if (seat?.role === "VIEWER") redirect(`${path}?error=${encodeURIComponent("You have view-only access.")}`);
}
