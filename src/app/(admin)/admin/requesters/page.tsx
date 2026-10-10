import { redirect } from "next/navigation";

/**
 * Old sending-side queue. Every account is the same now, with one ID check
 * at /admin/consenters ("Profiles"), so this goes there (same tab).
 */
export default async function OldRequesterQueue({ searchParams }: PageProps<"/admin/requesters">) {
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? (sp.tab === "Approved" ? "Verified" : sp.tab) : null;
  redirect(tab ? `/admin/consenters?tab=${encodeURIComponent(tab)}` : "/admin/consenters");
}
