import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { fmtDate, titleCase, cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import type { VerificationStatus } from "@prisma/client";

export const metadata = { title: "Consenter verification" };

const TABS: [string, VerificationStatus[] | null][] = [
  ["Queue", ["SUBMITTED", "UNDER_REVIEW", "MORE_INFO_NEEDED"]],
  ["Verified", ["APPROVED"]],
  ["Rejected", ["REJECTED"]],
  ["All", null],
];

export default async function ConsenterQueue({ searchParams }: PageProps<"/admin/consenters">) {
  await requireAdmin("consenters", "view");
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "Queue";
  const statuses = TABS.find(([t]) => t === tab)?.[1] ?? TABS[0][1];

  const rows = await db.consenterProfile.findMany({
    where: statuses ? { status: { in: statuses } } : {},
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { members: { include: { user: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin · Queue" title="Consenter verification" />
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
        <EmptyState title="Queue is clear" />
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
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
                    {titleCase(c.entityType)} · {c.country} · applied {fmtDate(c.createdAt)} · owner{" "}
                    {c.members.find((m) => m.role === "OWNER")?.user.email}
                  </div>
                </div>
                <StatusBadge status={c.status} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
