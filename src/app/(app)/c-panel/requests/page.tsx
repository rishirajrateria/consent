import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { fmtDateTime, cn } from "@/lib/utils";
import { getSettings } from "@/lib/settings";
import { OPEN_STATUSES, requestWindows } from "@/lib/request-window";
import type { Prisma } from "@prisma/client";
import { Inbox, Timer } from "lucide-react";

export const metadata = { title: "Incoming requests" };

// Each tab adds its own filter on top of "sent to this profile". Drafts the
// requester never sent (no submittedAt) are never shown to the owner.
const TABS: [string, Prisma.ConsentRequestWhereInput][] = [
  ["Needs action", { status: { in: ["PENDING", "DEAL_AGREED", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING"] } }],
  ["Negotiation", { status: "IN_NEGOTIATION" }],
  ["Waiting on them", { status: { in: ["CHANGES_REQUESTED", "APPROVED_IN_PRINCIPLE"] } }],
  ["Grants", { status: "APPROVED", grant: { is: { status: "ACTIVE" } } }],
  ["Decided", { status: { in: ["APPROVED", "DENIED"] } }],
  ["All", { status: { not: "DRAFT" } }],
];

export default async function ConsenterRequests({ searchParams }: PageProps<"/c-panel/requests">) {
  const sp = await searchParams;
  const { consenter } = await requireConsenter();
  const wanted = typeof sp.tab === "string" ? sp.tab.trim().toLowerCase() : "";
  const [tab, tabWhere] = TABS.find(([t]) => t.toLowerCase() === wanted) ?? TABS[0];
  const [rows, settings] = await Promise.all([
    db.consentRequest.findMany({
      where: {
        consenterId: consenter.id,
        submittedAt: { not: null },
        ...tabWhere,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { requester: true },
    }),
    getSettings(),
  ]);
  // Each open request expires a set number of days after its last action from either side.
  const windows = await requestWindows(
    rows.filter((r) => OPEN_STATUSES.includes(r.status)),
    settings.slaDays,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Incoming requests"
        desc={`Each open request expires ${settings.slaDays} days after its last action from either side. If it expires waiting for your answer, your Consent Score drops.`}
      />
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map(([t]) => (
          <Link
            key={t}
            href={`/c-panel/requests?tab=${encodeURIComponent(t)}`}
            aria-current={t === tab ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium", t === tab ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5")}
          >
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
                {windows.has(r.id) && (
                  <span className="flex items-center gap-1 text-xs text-ink-soft">
                    <Timer className="size-3.5 shrink-0" aria-hidden />
                    <span>
                      Expires <LocalTime iso={windows.get(r.id)!.expiresAt.toISOString()} />
                    </span>
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
