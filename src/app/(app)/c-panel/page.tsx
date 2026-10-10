import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, ScoreRing, StatusBadge, VerifiedBadge, Alert, ButtonLink } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import type { RequestStatus } from "@prisma/client";
import { ArrowRight } from "lucide-react";

export const metadata = { title: "Consenter panel" };

// Same statuses as the "Needs action" tab on /c-panel/requests, so the tile count matches the list it opens.
const NEEDS_ACTION: RequestStatus[] = ["PENDING", "DEAL_AGREED", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING"];

export default async function ConsenterHome({ searchParams }: PageProps<"/c-panel">) {
  const sp = await searchParams;
  const { consenter } = await requireConsenter();
  // Only requests actually sent to this profile, matching /c-panel/requests.
  const sent = { consenterId: consenter.id, submittedAt: { not: null } };
  const [pending, inNegotiation, activeGrants, matrixCount, recent] = await Promise.all([
    db.consentRequest.count({ where: { ...sent, status: { in: NEEDS_ACTION } } }),
    db.consentRequest.count({ where: { ...sent, status: "IN_NEGOTIATION" } }),
    // Same filter as the "Grants" tab on /c-panel/requests.
    db.consentRequest.count({ where: { ...sent, status: "APPROVED", grant: { is: { status: "ACTIVE" } } } }),
    db.consentMatrixEntry.count({ where: { consenterId: consenter.id } }),
    db.consentRequest.findMany({
      where: { ...sent, status: { notIn: ["DRAFT"] } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { requester: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Consenter panel"
        title={consenter.displayName}
        desc={
          <span className="flex items-center gap-2">
            {consenter.status === "APPROVED" ? <VerifiedBadge /> : <StatusBadge status={consenter.status} />}
            <Link href={`/c/${consenter.slug}`} className="underline underline-offset-4">
              View public profile
            </Link>
          </span>
        }
        action={<ScoreRing score={consenter.score} />}
      />

      {sp.denied && (
        <Alert tone="warn">You don&apos;t have permission for that. Ask the profile owner if you need it.</Alert>
      )}

      {consenter.status !== "APPROVED" && (
        <Alert tone="warn">
          Your profile isn&apos;t verified yet, so it&apos;s not searchable and can&apos;t receive
          requests. Track progress on the{" "}
          <Link href="/onboarding/consenter" className="underline underline-offset-4">onboarding page</Link>.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Needs action", pending, "/c-panel/requests"],
          ["In negotiation", inNegotiation, "/c-panel/requests?tab=Negotiation"],
          ["Active grants", activeGrants, "/c-panel/requests?tab=Grants"],
          ["Matrix cells set", matrixCount, "/c-panel/matrix"],
        ].map(([label, value, href]) => (
          <Link key={String(label)} href={href as "/c-panel"}>
            <Card className="transition-all hover:shadow-glass-lg">
              <div className="text-2xl font-semibold tabular-nums">{String(value)}</div>
              <div className="mt-0.5 text-xs text-ink-soft">{label}</div>
            </Card>
          </Link>
        ))}
      </div>

      {matrixCount === 0 && consenter.status === "APPROVED" && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium">Set up your consent matrix</div>
            <div className="text-sm text-ink-soft">
              Decide per platform, format and asset type what&apos;s allowed automatically, what needs
              your approval, and what&apos;s never allowed. It also improves your Consent Score.
            </div>
          </div>
          <ButtonLink href="/c-panel/matrix">
            Open matrix <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </Card>
      )}

      <Card className="space-y-1 p-0 sm:p-0">
        <div className="px-5 pt-5 text-sm font-semibold">Recent activity</div>
        {recent.length === 0 && <div className="px-5 pb-5 pt-2 text-sm text-ink-faint">No requests yet.</div>}
        <div className="divide-y divide-ink/5">
          {recent.map((r) => (
            <Link key={r.id} href={`/c-panel/requests/${r.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  #{r.number} · {r.requester.displayName}
                </div>
                <div className="text-xs text-ink-faint">{fmtDateTime(r.updatedAt)}</div>
              </div>
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
