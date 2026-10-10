import "server-only";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { setActiveProfile } from "@/lib/auth";
import { ensureProfileFor } from "@/lib/profiles";

type Seatable = {
  id: string;
  consenterId: string;
  submittedAt: Date | null;
  status: string;
  requester: { id: string; consenterId: string | null };
};

/** The profile (id) on the asking side of this request this person belongs to, or null. */
async function sendingProfile(userId: string, requester: Seatable["requester"]) {
  if (requester.consenterId) {
    const seat = await db.consenterMember.findUnique({
      where: { consenterId_userId: { consenterId: requester.consenterId, userId } },
      select: { id: true },
    });
    if (seat) return requester.consenterId;
  }
  // An older sending-only seat: pair that profile first, then use it.
  const old = await db.requesterMember.findUnique({
    where: { requesterId_userId: { requesterId: requester.id, userId } },
    select: { id: true },
  });
  if (!old) return null;
  const profileId = requester.consenterId ?? (await ensureProfileFor(requester.id));
  const seat = await db.consenterMember.findUnique({
    where: { consenterId_userId: { consenterId: profileId, userId } },
    select: { id: true },
  });
  return seat ? profileId : null;
}

/** The received view of a request is only there once it was sent. */
async function receivingProfile(userId: string, request: Seatable) {
  if (!request.submittedAt) return null;
  const seat = await db.consenterMember.findUnique({
    where: { consenterId_userId: { consenterId: request.consenterId, userId } },
    select: { id: true },
  });
  return seat ? request.consenterId : null;
}

function sentPath(r: Seatable) {
  return r.status === "DRAFT" ? `/r-panel/requests/${r.id}/edit` : `/r-panel/requests/${r.id}`;
}

/**
 * A request page opened while another profile is active. When this person
 * belongs to the profile the page is for, switch to it and load the page
 * again, so the header and switcher show that profile too. When they only
 * belong to the other side, open that side's page instead. Otherwise it
 * doesn't exist for them.
 */
export async function openAsRightProfile(
  userId: string,
  request: Seatable,
  view: "received" | "sent",
  here: string,
): Promise<never> {
  const [receiving, sending] = await Promise.all([
    receivingProfile(userId, request),
    sendingProfile(userId, request.requester),
  ]);
  const order: ["received" | "sent", string | null][] =
    view === "received"
      ? [["received", receiving], ["sent", sending]]
      : [["sent", sending], ["received", receiving]];
  const [target, profileId] = order.find(([, p]) => p) ?? [null, null];
  if (!target || !profileId) notFound();
  await setActiveProfile({ kind: "consenter", id: profileId });
  redirect(target === view ? here : target === "received" ? `/c-panel/requests/${request.id}` : sentPath(request));
}

/** The page's own path with its query, to load it again after switching. */
export function pathWithQuery(path: string, sp: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
