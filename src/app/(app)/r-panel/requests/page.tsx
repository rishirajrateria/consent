import Link from "next/link";
import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, ButtonLink } from "@/components/ui";
import { fmtDateTime, cn } from "@/lib/utils";
import type { RequestStatus } from "@prisma/client";
import { Inbox, Plus } from "lucide-react";

export const metadata = { title: "My requests" };

const TABS: [string, RequestStatus[] | null][] = [
  ["Open", ["SUBMITTED", "PENDING", "IN_NEGOTIATION", "CHANGES_REQUESTED", "DEAL_AGREED", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING", "APPROVED_IN_PRINCIPLE"]],
  ["Drafts", ["DRAFT"]],
  ["Decided", ["APPROVED", "DENIED"]],
  ["Closed", ["CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"]],
  ["All", null],
];

export default async function RequesterRequests({ searchParams }: PageProps<"/r-panel/requests">) {
  const sp = await searchParams;
  const { requester } = await requireRequester();
  const tab = typeof sp.tab === "string" ? sp.tab : "Open";
  const statuses = TABS.find(([t]) => t === tab)?.[1] ?? TABS[0][1];
  const rows = await db.consentRequest.findMany({
    where: { requesterId: requester.id, ...(statuses ? { status: { in: statuses } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { consenter: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={requester.displayName}
        title="Consent requests"
        action={<ButtonLink href="/r-panel/new" size="sm"><Plus className="size-4" aria-hidden /> New</ButtonLink>}
      />
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map(([t]) => (
          <Link key={t} href={`/r-panel/requests?tab=${t}`} className={cn("whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium", t === tab ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5")}>
            {t}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing here" desc="Start a new request from the directory." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link key={r.id} href={r.status === "DRAFT" ? `/r-panel/requests/${r.id}/edit` : `/r-panel/requests/${r.id}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 py-4 transition-all hover:shadow-glass-lg">
                <div className="flex size-10 items-center justify-center rounded-xl bg-ink/5 font-semibold">
                  {r.consenter.displayName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">#{r.number} · {r.consenter.displayName}</div>
                  <div className="text-xs text-ink-faint">{r.assetTypeNames.slice(0, 3).join(", ")} · updated {fmtDateTime(r.updatedAt)}</div>
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
