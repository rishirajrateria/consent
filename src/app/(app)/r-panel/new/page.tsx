import { redirect } from "next/navigation";
import { db } from "@/lib/db";

/**
 * Asking starts on Find now. Old links keep their search (?q=), and a link
 * that named a profile (?consenter=<slug>) searches for it by name.
 */
export default async function OldNewRequest({ searchParams }: PageProps<"/r-panel/new">) {
  const sp = await searchParams;
  let q = typeof sp.q === "string" ? sp.q.trim() : "";
  const slug = typeof sp.consenter === "string" ? sp.consenter.trim() : "";
  if (!q && slug) {
    const profile = await db.consenterProfile.findUnique({ where: { slug }, select: { displayName: true } });
    q = profile?.displayName ?? slug.replace(/-/g, " ");
  }
  redirect(q ? `/find?${new URLSearchParams({ q })}` : "/find");
}
