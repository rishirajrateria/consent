import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { profilesOf } from "@/lib/profiles";
import { BottomNav, TopNavLinks, type NavItem } from "@/components/nav";
import { switchProfileAction } from "./actions";
import { logoutAction } from "../(auth)/actions";
import { ASKER_MOVE, actingFor } from "./c-panel/requests/sent-step";
import { activeSeat } from "./dashboard/active";
import { Check, ChevronDown, Plus, ShieldCheck, LogOut, UserCircle } from "lucide-react";

// Pages that live under Profile in the nav (the hub links to each of them).
const PROFILE_PAGES = [
  "/profile",
  "/c-panel/settings",
  "/c-panel/matrix",
  "/c-panel/rules",
  "/c-panel/lists",
  "/c-panel/earnings",
  "/c-panel/team",
  "/c-panel/tipoffs",
  "/r-panel/grants",
  "/r-panel/billing",
  "/r-panel/team",
  "/settings",
];

/**
 * One app shell for every profile: every profile can receive and send, so
 * everyone gets the same nav. The profile menu lists profiles only when the
 * person belongs to more than one.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireUser();
  const profiles = await profilesOf(session.userId);
  // The same profile requireConsenter/requireRequester resolve.
  const active = activeSeat(profiles, session.activeProfile);

  const [unread, needsAnswer, yourMove] = await Promise.all([
    db.notification.count({ where: { userId: session.userId, readAt: null } }),
    // Same counts as Requests: received requests waiting for this profile's
    // answer, and sent requests waiting on this person.
    active
      ? db.consentRequest.count({
          where: { consenterId: active.consenterId, submittedAt: { not: null }, status: "PENDING" },
        })
      : 0,
    active ? db.consentRequest.count({ where: { ...actingFor(session.userId), ...ASKER_MOVE } }) : 0,
  ]);

  const isAdmin = !!session.user.adminRole;

  const items: NavItem[] = active
    ? [
        { href: "/c-panel", label: "Home", icon: "home" },
        { href: "/find", label: "Find", icon: "search" },
        {
          href: "/c-panel/requests",
          label: "Requests",
          icon: "inbox",
          badge: needsAnswer + yourMove,
          match: ["/r-panel/requests"],
        },
        { href: "/notifications", label: "Alerts", icon: "bell", badge: unread },
        { href: "/profile", label: "Profile", icon: "user", match: PROFILE_PAGES },
      ]
    : [
        { href: "/dashboard", label: "Home", icon: "home", match: ["/onboarding"] },
        { href: "/notifications", label: "Alerts", icon: "bell", badge: unread },
        { href: "/settings", label: "Account", icon: "settings" },
      ];

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
        <div className="glass-bar mx-auto flex max-w-6xl items-center gap-3 rounded-2xl px-4 py-2.5">
          <Link href={active ? "/c-panel" : "/dashboard"} className="text-lg font-semibold tracking-tight">
            consent<span className="text-ink-faint">.</span>
          </Link>
          <nav aria-label="Sections" className="min-w-0 flex-1">
            <TopNavLinks items={items} />
          </nav>

          {/* Profile menu. The list of profiles shows only when there is more than one. */}
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-ink/10 bg-white/60 px-3 py-1.5 text-sm font-medium hover:border-ink/25 [&::-webkit-details-marker]:hidden">
              <span className="max-w-28 truncate sm:max-w-40">
                {active?.consenter.displayName ?? session.user.name.split(" ")[0]}
              </span>
              <ChevronDown className="size-3.5 text-ink-faint transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="glass-strong absolute right-0 top-full z-50 mt-2 w-64 p-2">
              {profiles.length > 1 && (
                <>
                  <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">
                    Switch profile
                  </div>
                  <form action={switchProfileAction} className="space-y-0.5">
                    {profiles.map((m) => {
                      const current = m.consenterId === active?.consenterId;
                      return (
                        <button
                          key={m.id}
                          name="profile"
                          value={m.consenterId}
                          aria-current={current ? "true" : undefined}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink/5"
                        >
                          <span className="min-w-0 flex-1 truncate">{m.consenter.displayName}</span>
                          {current && <Check className="size-4 text-ink" aria-hidden />}
                        </button>
                      );
                    })}
                  </form>
                  <Link href="/onboarding?new=1" className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-soft hover:bg-ink/5">
                    <Plus className="size-4" aria-hidden /> Add a brand or show profile
                  </Link>
                  <div className="my-1.5 border-t hairline" />
                </>
              )}
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

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-3 pb-32 pt-6 sm:px-4 md:pb-12">
        {children}
      </main>

      <BottomNav items={items} />
    </div>
  );
}
