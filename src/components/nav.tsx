"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Home, Inbox, Bell, Menu, Plus, Award, Compass, LayoutGrid, Settings, Shield, Search, UserRound,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  inbox: Inbox,
  bell: Bell,
  menu: Menu,
  plus: Plus,
  award: Award,
  compass: Compass,
  grid: LayoutGrid,
  settings: Settings,
  shield: Shield,
  search: Search,
  user: UserRound,
};

export type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
  prominent?: boolean;
  /** More paths that belong to this item (it is also current on pages under them). */
  match?: string[];
};

// Homes match only themselves, so "Home" isn't marked current on every page under it.
const HOMES = ["/dashboard", "/c-panel", "/admin"];

const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(path + "/");

function isActive(pathname: string, item: NavItem) {
  if (item.match?.some((path) => under(pathname, path))) return true;
  if (HOMES.includes(item.href)) return pathname === item.href;
  return under(pathname, item.href);
}

/** Bottom navigation — fixed, thumb-reachable, mobile only. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="glass-bar fixed inset-x-3 bottom-3 z-50 rounded-2xl px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex items-stretch justify-around">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(pathname, item);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[10px] font-medium transition-colors",
                  active ? "text-ink" : "text-ink-faint hover:text-ink-soft"
                )}
              >
                {item.prominent ? (
                  <span className="glass-ink -mt-6 flex size-12 items-center justify-center rounded-2xl">
                    <Icon className="size-5" strokeWidth={2} aria-hidden />
                  </span>
                ) : (
                  <span className="relative">
                    <Icon className={cn("size-5", active && "stroke-[2.4]")} aria-hidden />
                    {!!item.badge && (
                      <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[9px] font-bold text-white">
                        {item.badge > 9 ? "9+" : item.badge}
                      </span>
                    )}
                  </span>
                )}
                <span>{item.label}</span>
                {active && !item.prominent && (
                  <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-ink" aria-hidden />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Horizontal nav links for the desktop top bar. */
export function TopNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <div className="hidden items-center gap-1 md:flex">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-ink/5 text-ink" : "text-ink-soft hover:bg-ink/5 hover:text-ink"
            )}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
            {!!item.badge && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[9px] font-bold text-white">
                {item.badge > 9 ? "9+" : item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
