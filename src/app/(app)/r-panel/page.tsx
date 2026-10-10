import { redirect } from "next/navigation";

/** Every profile has one Home now. Old links (and their notes, like ?welcome) open it. */
export default async function OldSendingHome({ searchParams }: PageProps<"/r-panel">) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") qs.set(k, v);
  const query = qs.toString();
  redirect(query ? `/c-panel?${query}` : "/c-panel");
}
