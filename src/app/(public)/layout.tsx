import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { BottomNav, TopNavLinks } from "@/components/nav";

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

      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-32 pt-6 sm:px-4 md:pb-16">{children}</main>

      <footer className="hidden border-t hairline py-10 md:block">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-sm text-ink-faint">
          <div>consent. — documented, verifiable permission.</div>
          <nav className="flex gap-4" aria-label="Footer">
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/contact" className="hover:text-ink">Contact</Link>
            <Link href="/faq" className="hover:text-ink">FAQ</Link>
          </nav>
        </div>
      </footer>

      <BottomNav items={items} />
    </div>
  );
}
