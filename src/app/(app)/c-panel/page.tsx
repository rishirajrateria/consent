import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, ScoreRing, StatusBadge, VerifiedBadge, Alert, ButtonLink } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import type { RequestStatus } from "@prisma/client";
import { ArrowRight, Search } from "lucide-react";
import { requestCapacity } from "@/lib/capacity";
import { OpensAgain } from "./settings/request-limits";
import { ASKER_MOVE, actingFor, askerStep, askingSeats, madeBy, seatsQuery, sentInclude } from "./requests/sent-step";
import { SentLink, StepLine } from "./requests/sent-list";

export const metadata = { title: "Consenter panel" };

// Same statuses as the "Needs action" tab on /c-panel/requests, so the tile count matches the list it opens.
const NEEDS_ACTION: RequestStatus[] = ["PENDING", "DEAL_AGREED", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING"];

export default async function ConsenterHome({ searchParams }: PageProps<"/c-panel">) {
  const sp = await searchParams;
  const { consenter, session } = await requireConsenter();
  // Only requests actually sent to this profile, matching /c-panel/requests.
  const sent = { consenterId: consenter.id, submittedAt: { not: null } };
  const [pending, inNegotiation, activeGrants, matrixCount, recent, capacity, madeRecent, yourMove, seats, drafts] = await Promise.all([
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
    // The owner's request limits: are new requests paused right now?
    requestCapacity(consenter.id),
    // Requests this person made from any of their requester profiles, matching the "Sent" tab.
    db.consentRequest.findMany({
      where: { ...madeBy(session.userId), status: { not: "DRAFT" } },
      orderBy: { updatedAt: "desc" },
      take: 3,
      include: sentInclude,
    }),
    // Only profiles where this person can act, matching the count on the "Sent" tab.
    db.consentRequest.count({ where: { ...actingFor(session.userId), ...ASKER_MOVE } }),
    db.requesterMember.findMany(seatsQuery(session.userId)),
    // Unfinished requests, matching the "Drafts" list on the "Sent" tab.
    db.consentRequest.count({ where: { ...actingFor(session.userId), status: "DRAFT" } }),
  ]);
  const { manyProfiles, viewOnly } = askingSeats(seats);

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

      {consenter.status === "APPROVED" && capacity.paused && (
        <Alert tone="warn">
          <div className="space-y-1.5">
            <div className="font-semibold text-ink">New requests are paused</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {capacity.reasons.map((r) => (
                <li key={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</li>
              ))}
            </ul>
            <p>
              They <OpensAgain capacity={capacity} verb="open" />. Until then, nobody can send you a
              new request.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/c-panel/requests" className="font-medium text-ink underline underline-offset-4">
                See the requests waiting
              </Link>
              <Link href="/c-panel/settings#limits" className="underline underline-offset-4">
                Change your request limits
              </Link>
            </div>
          </div>
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-1 p-0 sm:p-0">
          <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
            <h2 className="text-sm font-semibold">Requests you&apos;ve received</h2>
            {recent.length > 0 && (
              <Link href="/c-panel/requests?tab=All" className="text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink">
                See all
              </Link>
            )}
          </div>
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

        <Card className="flex flex-col p-0 sm:p-0">
          <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
            <div>
              <h2 className="text-sm font-semibold">Requests you&apos;ve made</h2>
              {yourMove > 0 && <div className="text-xs font-medium text-ink">{yourMove} waiting on you</div>}
            </div>
            {madeRecent.length > 0 && (
              <Link href="/c-panel/requests?tab=Sent" className="text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink">
                See all
              </Link>
            )}
          </div>
          {madeRecent.length === 0 && drafts === 0 && (
            <div className="px-5 pt-2 text-sm text-ink-faint">
              You haven&apos;t asked anyone yet. Search for someone by name, then ask for their permission.
            </div>
          )}
          {madeRecent.length === 0 && drafts > 0 && (
            <div className="px-5 pt-2 text-sm text-ink-faint">Nothing sent yet. Finish your draft and send it.</div>
          )}
          <div className="mt-1 divide-y divide-ink/5">
            {madeRecent.map((r) => (
              <SentLink
                key={r.id}
                request={r}
                label={`Open request #${r.number} to ${r.consenter.displayName}`}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink/[0.03]"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="truncate text-sm font-medium">
                    #{r.number} · {r.consenter.displayName}
                  </div>
                  <StepLine step={askerStep(r)} canAct={!viewOnly.has(r.requesterId)} />
                  {manyProfiles && <div className="text-xs text-ink-faint">as {r.requester.displayName}</div>}
                </div>
                <StatusBadge status={r.status} />
              </SentLink>
            ))}
          </div>
          {drafts > 0 && (
            <div className="px-5 pt-3 text-sm">
              <Link href="/c-panel/requests?tab=Sent#drafts-title" className="font-medium underline underline-offset-4">
                {drafts === 1 ? "1 unfinished request" : `${drafts} unfinished requests`}
              </Link>
              <span className="text-ink-faint"> · nobody sees these until you send them</span>
            </div>
          )}
          <div className="mt-auto px-5 pb-5 pt-3">
            <ButtonLink href="/find" className="w-full sm:w-auto">
              <Search className="size-4" aria-hidden /> Find someone to ask
            </ButtonLink>
          </div>
        </Card>
      </div>
    </div>
  );
}
