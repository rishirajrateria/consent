import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { fmtDate, titleCase, cn } from "@/lib/utils";
import { parseChannels } from "@/lib/channels";
import { AlertTriangle } from "lucide-react";
import type { VerificationStatus } from "@prisma/client";
import { requireIdCheck } from "./perm";

export const metadata = { title: "Profiles" };

const TABS: [string, VerificationStatus[] | null][] = [
  ["Queue", ["SUBMITTED", "UNDER_REVIEW", "MORE_INFO_NEEDED"]],
  ["Verified", ["APPROVED"]],
  ["Rejected", ["REJECTED"]],
  ["All", null],
];

/**
 * The one ID-check queue. Every account is the same, so every profile (a
 * person, or a brand or show's team profile) is checked here once; approving
 * it lets it both send and receive.
 */
export default async function ProfileQueue({ searchParams }: PageProps<"/admin/consenters">) {
  await requireIdCheck("view");
  const sp = await searchParams;
  // "Approved" was the old sending-side tab name.
  const asked = typeof sp.tab === "string" ? (sp.tab === "Approved" ? "Verified" : sp.tab) : "Queue";
  const tab = TABS.some(([t]) => t === asked) ? asked : "Queue";
  const statuses = TABS.find(([t]) => t === tab)?.[1] ?? null;

  const rows = await db.consenterProfile.findMany({
    where: statuses ? { status: { in: statuses } } : {},
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      members: { include: { user: true } },
      asker: { select: { type: true, channels: true, _count: { select: { requests: true } } } },
      _count: { select: { requests: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Admin · ID checks"
        title="Profiles"
        desc="One ID check for every account. Approving a profile lets it send and receive requests."
      />
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map(([t]) => (
          <Link
            key={t}
            href={`/admin/consenters?tab=${t}`}
            className={cn(
              "rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap",
              t === tab ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5"
            )}
          >
            {t}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={tab === "Queue" ? "Queue is clear" : "Nothing here"} />
      ) : (
        <div className="space-y-2">
          {rows.map((c) => {
            const channels = parseChannels(c.asker?.channels ?? []).length;
            const requests = c._count.requests + (c.asker?._count.requests ?? 0);
            return (
              <Link key={c.id} href={`/admin/consenters/${c.id}`} className="block">
                <Card className="flex flex-wrap items-center gap-3 py-4 transition-all hover:shadow-glass-lg">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      {c.displayName}
                      {c.duplicateFlag && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-ink/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          <AlertTriangle className="size-3" aria-hidden /> Possible duplicate
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-faint">
                      {titleCase(c.entityType)}
                      {c.asker ? ` · ${titleCase(c.asker.type)}` : ""} · {c.country} · applied {fmtDate(c.createdAt)} · owner{" "}
                      {c.members.find((m) => m.role === "OWNER")?.user.email ?? "—"}
                      {` · ${channels} channel${channels === 1 ? "" : "s"} · ${requests} request${requests === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <StatusBadge status={c.status} />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
