import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { BottomNav, TopNavLinks, type NavItem } from "@/components/nav";
import { logoutAction } from "@/app/(auth)/actions";
import { ArrowLeft } from "lucide-react";
import { ADMIN_MODULES } from "./modules";

export const metadata = { title: { default: "Admin", template: "%s · Consent Admin" } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();

  const mobileItems: NavItem[] = [
    { href: "/admin", label: "Admin", icon: "shield" },
    { href: "/admin/consenters", label: "Profiles", icon: "grid" },
    { href: "/admin/requests", label: "Requests", icon: "inbox" },
    { href: "/admin/reports", label: "Reports", icon: "bell" },
    // Every other module, plus the way back to the app, lives behind "More" on phones.
    { href: "/admin/more", label: "More", icon: "menu" },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
        <div className="glass-bar mx-auto flex max-w-7xl items-center gap-3 rounded-2xl px-4 py-2.5">
          <Link href="/admin" className="text-lg font-semibold tracking-tight">
            consent<span className="text-ink-faint">.</span>{" "}
            <span className="rounded-md bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              admin
            </span>
          </Link>
          <div className="flex-1" />
          <TopNavLinks items={[{ href: "/dashboard", label: "Back to app", icon: "home" }]} />
          <span className="hidden text-sm text-ink-soft sm:block">
            {session.user.name} · {session.user.adminRole?.name}
          </span>
          <form action={logoutAction}>
            <button className="rounded-xl px-3 py-1.5 text-sm text-ink-soft hover:bg-ink/5">Sign out</button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-3 pb-32 pt-6 sm:px-4 md:pb-12">
        <aside className="hidden w-60 shrink-0 md:block">
          <nav className="glass sticky top-24 space-y-4 p-4" aria-label="Admin modules">
            <Link href="/dashboard" className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink">
              <ArrowLeft className="size-3" aria-hidden /> Back to app
            </Link>
            {ADMIN_MODULES.map((g) => (
              <div key={g.group}>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">
                  {g.group}
                </div>
                <ul className="space-y-0.5">
                  {g.links.map(([href, label]) => (
                    <li key={href}>
                      <Link
                        href={href}
                        className="block rounded-lg px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <BottomNav items={mobileItems} />
    </div>
  );
}
