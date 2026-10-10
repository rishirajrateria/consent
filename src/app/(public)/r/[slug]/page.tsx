import { notFound, permanentRedirect } from "next/navigation";
import { db } from "@/lib/db";
import { ensureProfileFor } from "@/lib/profiles";

/**
 * Old public link of a profile's sending half. Every profile has one public
 * page now, /c/<slug>, so this moves there for good (308). An old
 * sending-only profile gets its pair first (same name, same verification).
 */
export default async function OldProfileLink({ params }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const r = await db.requesterProfile.findUnique({ where: { slug }, select: { id: true, status: true } });
  if (!r) {
    // A /r/ link typed with a profile's own slug.
    const c = await db.consenterProfile.findUnique({ where: { slug }, select: { slug: true, status: true } });
    if (c?.status === "APPROVED") permanentRedirect(`/c/${c.slug}`);
    notFound();
  }
  if (r.status !== "APPROVED") notFound();
  const profileId = await ensureProfileFor(r.id);
  const c = await db.consenterProfile.findUnique({ where: { id: profileId }, select: { slug: true } });
  if (!c) notFound();
  permanentRedirect(`/c/${c.slug}`);
}
