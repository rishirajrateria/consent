import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser, parseProfileContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { BottomNav, TopNavLinks, type NavItem } from "@/components/nav";
import { switchProfileAction } from "./actions";
import { logoutAction } from "../(auth)/actions";
import { ChevronDown, Repeat, ShieldCheck, LogOut, UserCircle, Inbox } from "lucide-react";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireUser();
  const ctx = parseProfileContext(session.activeProfile);

  const [consenterMemberships, requesterMemberships, unread] = await Promise.all([
    db.consenterMember.findMany({
      where: { userId: session.userId },
      include: { consenter: { select: { id: true, displayName: true, status: true } } },
    }),
    db.requesterMember.findMany({
      where: { userId: session.userId },
      include: { requester: { select: { id: true, displayName: true, status: true } } },
    }),
    db.notification.count({ where: { userId: session.userId, readAt: null } }),
  ]);

  const isAdmin = !!session.user.adminRole;

  let items: NavItem[] = [];
  if (ctx?.kind === "consenter") {
    items = [
      { href: "/c-panel", label: "Home", icon: "home" },
      { href: "/c-panel/requests", label: "Requests", icon: "inbox" },
      { href: "/c-panel/matrix", label: "Matrix", icon: "grid" },
      { href: "/c-panel/settings", label: "Settings", icon: "settings" },
      { href: "/notifications", label: "Alerts", icon: "bell", badge: unread },
    ];
  } else if (ctx?.kind === "requester") {
    items = [
      { href: "/r-panel", label: "Home", icon: "home" },
      { href: "/r-panel/requests", label: "Requests", icon: "inbox" },
      { href: "/r-panel/new", label: "New", icon: "plus", prominent: true },
      { href: "/r-panel/grants", label: "Grants", icon: "award" },
      { href: "/notifications", label: "Alerts", icon: "bell", badge: unread },
    ];
  } else {
    items = [
      { href: "/dashboard", label: "Home", icon: "home" },
      { href: "/directory", label: "Directory", icon: "compass" },
      { href: "/notifications", label: "Alerts", icon: "bell", badge: unread },
      { href: "/settings", label: "Account", icon: "settings" },
    ];
  }

  const activeName =
    ctx?.kind === "consenter"
      ? consenterMemberships.find((m) => m.consenterId === ctx.id)?.consenter.displayName
      : ctx?.kind === "requester"
        ? requesterMemberships.find((m) => m.requesterId === ctx.id)?.requester.displayName
        : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
        <div className="glass-bar mx-auto flex max-w-6xl items-center gap-3 rounded-2xl px-4 py-2.5">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            consent<span className="text-ink-faint">.</span>
          </Link>
          <nav aria-label="Sections" className="min-w-0 flex-1">
            <TopNavLinks items={items} />
          </nav>

          {/* Profile switcher */}
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-ink/10 bg-white/60 px-3 py-1.5 text-sm font-medium hover:border-ink/25 [&::-webkit-details-marker]:hidden">
              <span className="max-w-28 truncate sm:max-w-40">
                {activeName ?? session.user.name.split(" ")[0]}
              </span>
              {ctx && (
                <span className="hidden rounded-full bg-ink/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-soft sm:inline">
                  {ctx.kind}
                </span>
              )}
              <ChevronDown className="size-3.5 text-ink-faint transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="glass-strong absolute right-0 top-full z-50 mt-2 w-64 p-2">
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">
                Switch profile
              </div>
              <form action={switchProfileAction} className="space-y-0.5">
                <button
                  name="profile"
                  value="none"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink/5"
                >
                  <UserCircle className="size-4 text-ink-faint" aria-hidden />
                  Personal — {session.user.name}
                </button>
                {consenterMemberships.map((m) => (
                  <button
                    key={m.id}
                    name="profile"
                    value={`consenter:${m.consenterId}`}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink/5"
                  >
                    <ShieldCheck className="size-4 text-ink-faint" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{m.consenter.displayName}</span>
                    <span className="text-[9px] font-semibold uppercase text-ink-faint">consenter</span>
                  </button>
                ))}
                {requesterMemberships.map((m) => (
                  <button
                    key={m.id}
                    name="profile"
                    value={`requester:${m.requesterId}`}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink/5"
                  >
                    <Inbox className="size-4 text-ink-faint" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{m.requester.displayName}</span>
                    <span className="text-[9px] font-semibold uppercase text-ink-faint">requester</span>
                  </button>
                ))}
              </form>
              <div className="my-1.5 border-t hairline" />
              <Link href="/onboarding" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-soft hover:bg-ink/5">
                <Repeat className="size-4" aria-hidden /> Add a profile
              </Link>
              {isAdmin && (
                <Link href="/admin" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-soft hover:bg-ink/5">
                  <ShieldCheck className="size-4" aria-hidden /> Admin panel
                </Link>
              )}
              <Link href="/settings" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-soft hover:bg-ink/5">
                <UserCircle className="size-4" aria-hidden /> Account settings
              </Link>
              <form action={logoutAction}>
                <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-ink-soft hover:bg-ink/5">
                  <LogOut className="size-4" aria-hidden /> Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-32 pt-6 sm:px-4 md:pb-12">
        {children}
      </main>

      <BottomNav items={items} />
    </div>
  );
}
