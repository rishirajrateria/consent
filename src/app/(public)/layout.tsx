import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { BottomNav, TopNavLinks } from "@/components/nav";
import { CookieNotice } from "@/components/cookie-notice";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const items = [
    { href: "/home", label: "Home", icon: "home" as const },
    { href: "/directory", label: "Directory", icon: "compass" as const },
    { href: "/verify", label: "Verify", icon: "shield" as const },
    session
      ? { href: "/dashboard", label: "App", icon: "grid" as const }
      : { href: "/login", label: "Sign in", icon: "menu" as const },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
        <div className="glass-bar mx-auto flex max-w-6xl items-center gap-4 rounded-2xl px-4 py-2.5">
          <Link href="/home" className="text-lg font-semibold tracking-tight">
            consent<span className="text-ink-faint">.</span>
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Site">
            {[
              ["/how-it-works", "How it works"],
              ["/pricing", "Pricing"],
              ["/directory", "Directory"],
              ["/verify", "Verify a certificate"],
              ["/faq", "FAQ"],
            ].map(([href, label]) => (
              <Link key={href} href={href as "/home"} className="rounded-xl px-3 py-2 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink">
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex-1 md:hidden" />
          {session ? (
            <TopNavLinks items={[{ href: "/dashboard", label: "Open app", icon: "grid" }]} />
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-medium text-ink-soft hover:bg-ink/5">
                Sign in
              </Link>
              <Link href="/signup" className="glass-ink rounded-xl px-4 py-2 text-sm font-medium hover:opacity-85">
                Get started
              </Link>
            </div>
          )}
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-3 pb-6 pt-6 sm:px-4 md:pb-16">{children}</main>

      {/* Shown on phones too (the site nav is desktop-only), clear of the bottom nav. */}
      <footer className="border-t hairline pb-28 pt-10 md:py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-sm text-ink-faint">
          <div>consent. — nothing about you moves without you.</div>
          <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Footer">
            {[
              ["/how-it-works", "How it works"],
              ["/pricing", "Pricing"],
              ["/terms", "Terms"],
              ["/privacy", "Privacy"],
              ["/contact", "Contact"],
              ["/faq", "FAQ"],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="inline-flex min-h-10 items-center hover:text-ink">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>

      <CookieNotice />
      <BottomNav items={items} />
    </div>
  );
}
