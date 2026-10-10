import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { Siren } from "lucide-react";

export const metadata = { title: "Takedowns" };

export default async function AdminTakedowns() {
  await requireAdmin("takedowns", "view");
  const takedowns = await db.takedownRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { grant: { include: { request: { include: { consenter: true, requester: true } } } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="Takedown requests" desc="Overview only. The two profiles drive the flow; ignored takedowns are recorded by the background jobs." />
      {takedowns.length === 0 ? (
        <EmptyState icon={Siren} title="No takedown requests" />
      ) : (
        <div className="space-y-2">
          {takedowns.map((t) => (
            <Card key={t.id} className="space-y-1 py-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Siren className="size-4" aria-hidden />
                <span className="font-medium">
                  {t.grant.request.consenter.displayName} asked {t.grant.request.requester.displayName} to take it down
                </span>
                <span className="text-xs text-ink-faint">grant {t.grant.publicId} · {fmtDateTime(t.createdAt)} · respond by {fmtDateTime(t.respondBy)}</span>
                <StatusBadge status={t.status} className="ml-auto" />
              </div>
              <p className="text-xs text-ink-soft">{t.reason} · {t.liveLinks.join(" · ")}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
