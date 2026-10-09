import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { fmtDateTime, cn } from "@/lib/utils";
import type { RequestStatus } from "@prisma/client";
import { Inbox, Timer } from "lucide-react";

export const metadata = { title: "Incoming requests" };

const TABS: [string, RequestStatus[] | null][] = [
  ["Needs action", ["PENDING", "DEAL_AGREED", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING"]],
  ["Negotiation", ["IN_NEGOTIATION"]],
  ["Waiting on them", ["CHANGES_REQUESTED", "APPROVED_IN_PRINCIPLE"]],
  ["Decided", ["APPROVED", "DENIED"]],
  ["All", null],
];

export default async function ConsenterRequests({ searchParams }: PageProps<"/c-panel/requests">) {
  const sp = await searchParams;
  const { consenter } = await requireConsenter();
  const tab = typeof sp.tab === "string" ? sp.tab : "Needs action";
  const statuses = TABS.find(([t]) => t === tab)?.[1] ?? TABS[0][1];
  const rows = await db.consentRequest.findMany({
    where: {
      consenterId: consenter.id,
      status: statuses ? { in: statuses } : { not: "DRAFT" },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { requester: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Incoming requests"
        desc="Unanswered requests auto-expire and lower your Consent Score — respond in time."
      />
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map(([t]) => (
          <Link key={t} href={`/c-panel/requests?tab=${t}`} className={cn("whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium", t === tab ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5")}>
            {t}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing here" />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link key={r.id} href={`/c-panel/requests/${r.id}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 py-4 transition-all hover:shadow-glass-lg">
                <div className="flex size-10 items-center justify-center rounded-xl bg-ink/5 font-semibold">
                  {r.requester.displayName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">#{r.number} · {r.requester.displayName}</div>
                  <div className="text-xs text-ink-faint">
                    {r.assetTypeNames.slice(0, 3).join(", ")} · {fmtDateTime(r.updatedAt)}
                  </div>
                </div>
                {r.status === "PENDING" && r.slaExpiresAt && (
                  <span className="flex items-center gap-1 text-xs text-ink-soft">
                    <Timer className="size-3.5" aria-hidden />
                    expires {fmtDateTime(r.slaExpiresAt)}
                  </span>
                )}
                <StatusBadge status={r.status} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
