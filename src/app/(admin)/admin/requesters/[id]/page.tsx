import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ensureProfileFor } from "@/lib/profiles";
import { requireIdCheck } from "../../consenters/perm";

/**
 * Old sending-side review page. A sending half belongs to a profile, which
 * is checked once at /admin/consenters/<profile id>; this goes there. An old
 * sending-only profile gets its pair first.
 */
export default async function OldRequesterCheck({ params }: PageProps<"/admin/requesters/[id]">) {
  await requireIdCheck("view");
  const { id } = await params;
  const r = await db.requesterProfile.findUnique({ where: { id }, select: { id: true, consenterId: true } });
  if (!r) notFound();
  const profileId = r.consenterId ?? (await ensureProfileFor(r.id));
  redirect(`/admin/consenters/${profileId}`);
}
