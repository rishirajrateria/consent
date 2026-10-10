import { redirect } from "next/navigation";

/** Sent requests live under Requests → Sent, next to the ones received. */
export default async function SentRequestsRedirect({ searchParams }: PageProps<"/r-panel/requests">) {
  const sp = await searchParams;
  const keep = new URLSearchParams({ tab: "Sent" });
  for (const key of ["error", "discarded"]) {
    const v = sp[key];
    if (typeof v === "string") keep.set(key, v);
  }
  redirect(`/c-panel/requests?${keep}`);
}
