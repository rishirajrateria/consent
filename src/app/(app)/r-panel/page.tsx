import Link from "next/link";
import { requireRequester } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, ScoreRing, StatusBadge, Alert, ButtonLink } from "@/components/ui";
import { requesterActive } from "@/lib/payments";
import { SuccessNote } from "@/components/error-note";
import { fmtDateTime } from "@/lib/utils";
import type { RequestStatus } from "@prisma/client";
import { Plus, Users, CreditCard, AtSign } from "lucide-react";

export const metadata = { title: "Requester panel" };

// Same statuses as the "Open" tab on /r-panel/requests, so the tile count matches the list it opens.
const OPEN: RequestStatus[] = [
  "SUBMITTED", "PENDING", "IN_NEGOTIATION", "CHANGES_REQUESTED", "DEAL_AGREED",
  "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING", "APPROVED_IN_PRINCIPLE",
];

export default async function RequesterHome({ searchParams }: PageProps<"/r-panel">) {
  const sp = await searchParams;
  const { requester, member } = await requireRequester();
  const active = requesterActive(requester);
  const [pending, waiting, approved, grants, recent] = await Promise.all([
    db.consentRequest.count({ where: { requesterId: requester.id, status: { in: OPEN } } }),
    // Open requests where the next move is the requester's.
    db.consentRequest.count({
      where: {
        requesterId: requester.id,
        OR: [
          { status: { in: ["CHANGES_REQUESTED", "APPROVED_IN_PRINCIPLE", "AGREEMENT_MODE_PENDING"] } },
          { status: "IN_NEGOTIATION", offers: { some: { status: "OPEN", bySide: "consenter" } } },
          {
            status: "LEGAL_AGREEMENT_PENDING",
            agreement: {
              OR: [
                // The owner proposed an agreement: the requester accepts or declines it.
                { status: "PROPOSED", proposedBySide: "consenter" },
                // Either side can pick how to make it, or upload the signed file.
                { status: "DRAFTING" },
                { status: "UPLOAD_PENDING_CONFIRMATION", uploadedFileId: null },
                // The owner uploaded the signed file: the requester checks it.
                { status: "UPLOAD_PENDING_CONFIRMATION", uploadConfirmedBySide: "consenter" },
                { status: "AWAITING_SIGNATURES", signatures: { none: { side: "requester" } } },
                // The owner declined the requester's proposal: the requester decides what's next.
                { status: "DECLINED", proposedBySide: "requester" },
              ],
            },
          },
        ],
      },
    }),
    db.consentRequest.count({ where: { requesterId: requester.id, status: "APPROVED" } }),
    db.grant.count({ where: { request: { requesterId: requester.id }, status: "ACTIVE" } }),
    db.consentRequest.findMany({
      where: { requesterId: requester.id },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { consenter: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Requester panel"
        title={requester.displayName}
        desc={
          <span className="flex items-center gap-2">
            <StatusBadge status={active ? "ACTIVE" : requester.status} />
            <Link href={`/r/${requester.slug}`} className="underline underline-offset-4">Public profile</Link>
          </span>
        }
        action={<ScoreRing score={requester.score} />}
      />
      {sp.welcome && <SuccessNote msg="Welcome aboard! Your account is active — you can now send consent requests." />}

      {!active && (
        <Alert tone="warn">
          {requester.status !== "APPROVED" ? (
            <>Your application isn&apos;t approved yet — check <Link href="/onboarding/requester" className="underline underline-offset-4">status</Link>.</>
          ) : !requester.onboardingFeePaidAt ? (
            member.role === "VIEWER" ? (
              <>Approved! The account owner still needs to pay the onboarding fee to activate it.</>
            ) : (
              <>Approved! Pay the onboarding fee to activate — <Link href="/onboarding/requester" className="underline underline-offset-4">activate now</Link>.</>
            )
          ) : (
            <>Your subscription lapsed — you keep read access, but must <Link href="/r-panel/billing" className="underline underline-offset-4">renew</Link> to send new requests.</>
          )}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Open requests", pending, "/r-panel/requests?tab=Open", waiting > 0 ? `${waiting} waiting on you` : null],
            ["Approved", approved, "/r-panel/requests?tab=Decided", null],
            ["Active grants", grants, "/r-panel/grants", null],
          ] as const
        ).map(([label, value, href, note]) => (
          <Link key={label} href={href as "/r-panel"}>
            <Card className="h-full transition-all hover:shadow-glass-lg">
              <div className="text-2xl font-semibold tabular-nums">{value}</div>
              <div className="mt-0.5 text-xs text-ink-soft">{label}</div>
              {note && <div className="mt-1 text-xs font-medium text-ink">{note}</div>}
            </Card>
          </Link>
        ))}
        <Card className="flex items-center justify-center">
          <ButtonLink href="/r-panel/new" className="w-full justify-center">
            <Plus className="size-4" aria-hidden /> New request
          </ButtonLink>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/r-panel/team" variant="ghost" className="min-h-10">
          <Users className="size-4" aria-hidden /> Team
        </ButtonLink>
        <ButtonLink href="/r-panel/billing" variant="ghost" className="min-h-10">
          <CreditCard className="size-4" aria-hidden /> Billing
        </ButtonLink>
        <ButtonLink href="/r-panel/contact" variant="ghost" className="min-h-10">
          <AtSign className="size-4" aria-hidden /> Contact details
        </ButtonLink>
      </div>

      <Card className="space-y-1 p-0 sm:p-0">
        <div className="px-5 pt-5 text-sm font-semibold">Recent requests</div>
        {recent.length === 0 && <div className="px-5 pb-5 pt-2 text-sm text-ink-faint">Nothing yet — find a consenter in the directory.</div>}
        <div className="divide-y divide-ink/5">
          {recent.map((r) => (
            <Link key={r.id} href={`/r-panel/requests/${r.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">#{r.number} · {r.consenter.displayName}</div>
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
