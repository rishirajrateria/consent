import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { fmtDate, titleCase, cn } from "@/lib/utils";
import type { VerificationStatus } from "@prisma/client";

export const metadata = { title: "Requester applications" };

const TABS: [string, VerificationStatus[] | null][] = [
  ["Queue", ["SUBMITTED", "UNDER_REVIEW", "MORE_INFO_NEEDED"]],
  ["Approved", ["APPROVED"]],
  ["Rejected", ["REJECTED"]],
  ["All", null],
];

export default async function RequesterQueue({ searchParams }: PageProps<"/admin/requesters">) {
  await requireAdmin("requesters", "view");
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "Queue";
  const statuses = TABS.find(([t]) => t === tab)?.[1] ?? TABS[0][1];

  const rows = await db.requesterProfile.findMany({
    where: statuses ? { status: { in: statuses } } : {},
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { members: { include: { user: true } }, _count: { select: { requests: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin · Queue" title="Requester applications" />
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map(([t]) => (
          <Link
            key={t}
            href={`/admin/requesters?tab=${t}`}
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
        <EmptyState title="Queue is clear" />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link key={r.id} href={`/admin/requesters/${r.id}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 py-4 transition-all hover:shadow-glass-lg">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.displayName}</div>
                  <div className="text-xs text-ink-faint">
                    {titleCase(r.type)} · {r.country} · applied {fmtDate(r.createdAt)} · owner{" "}
                    {r.members.find((m) => m.role === "OWNER")?.user.email}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
