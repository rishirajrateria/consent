import Link from "next/link";
import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, ButtonLink } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { Award, Search } from "lucide-react";

export const metadata = { title: "Certificates you hold" };

export default async function CertificatesYouHold() {
  const { requester } = await requireRequester();
  const grants = await db.grant.findMany({
    where: { request: { requesterId: requester.id } },
    orderBy: { issuedAt: "desc" },
    include: { request: { include: { consenter: { select: { displayName: true } } } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={requester.displayName}
        title="Certificates you hold"
        desc="Consent you were given. Each certificate keeps its verification link for good."
      />
      {grants.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No certificates yet"
          desc="When someone says yes to your request, its certificate shows up here."
          action={
            <ButtonLink href="/find">
              <Search className="size-4" aria-hidden /> Find someone to ask
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-2">
          {grants.map((g) => (
            <Link key={g.id} href={`/r-panel/requests/${g.requestId}`} className="block">
              <Card className="flex flex-wrap items-center gap-3 py-4 transition-all hover:shadow-glass-lg">
                <Award className="size-6 shrink-0" strokeWidth={1.5} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{g.request.consenter.displayName} · {g.certificateId}</div>
                  <div className="text-xs text-ink-faint">
                    Issued {fmtDate(g.issuedAt)}
                    {g.validUntil ? ` · until ${fmtDate(g.validUntil)}` : g.validityKind === "PERPETUAL" ? " · perpetual" : " · single publication"}
                  </div>
                </div>
                <StatusBadge status={g.status} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
