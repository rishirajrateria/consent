import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { ADMIN_MODULES } from "../modules";

export const metadata = { title: "All modules" };

/** The phone's "More" tab: every admin module plus the way back to the app. */
export default async function AdminMore() {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="All modules" />
      <nav className="glass space-y-5 p-4" aria-label="All admin modules">
        <Link
          href="/dashboard"
          className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-ink hover:bg-ink/5"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to app
        </Link>
        {ADMIN_MODULES.map((g) => (
          <div key={g.group}>
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">{g.group}</div>
            <ul className="divide-y divide-ink/5">
              {g.links.map(([href, label]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-sm text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
                  >
                    {label}
                    <ChevronRight className="size-4 text-ink-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
