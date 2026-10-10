import Link from "next/link";
import { cookies } from "next/headers";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { requestWindows } from "@/lib/request-window";
import { membershipOk } from "@/lib/membership";
import { profileScore } from "@/lib/profiles-pure";
import { PageHeader, Card, ScoreRing, StatusBadge, VerifiedBadge, Alert, ButtonLink } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { fmtMoney } from "@/lib/utils";
import { ArrowRight, Search, Users } from "lucide-react";
import { requestCapacity } from "@/lib/capacity";
import { OpensAgain } from "./settings/request-limits";
import { OWNER_PCT } from "./requests/fee-split";
import { ASKER_MOVE, actingFor, askerStep, askingSeats, madeBy, seatsQuery, sentInclude } from "./requests/sent-step";
import { SentLink, StepLine } from "./requests/sent-list";
import { openTeamInvites } from "../dashboard/invites";
import { dismissFeeNudgeAction } from "../actions";
import { SubmitButton } from "@/components/form";
import { idCheckNote } from "../profile/id-check";

export const metadata = { title: "Home" };

/** Sum amounts per currency, e.g. "₹800.00" or "₹800.00 + $20.00"; `empty` when there are none. */
function total(rows: { amount: { toString(): string }; currency: string }[], empty: string) {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + Number(r.amount.toString()));
  return by.size === 0 ? empty : [...by.entries()].map(([cur, amt]) => fmtMoney(amt, cur)).join(" + ");
}

/**
 * Home for every profile: requests that need this profile's answer first,
 * then the requests this person sent, then a few numbers.
 */
export default async function Home({ searchParams }: PageProps<"/c-panel">) {
  const sp = await searchParams;
  const { consenter, member, session } = await requireConsenter();
  // Only requests actually sent to this profile, matching Requests → Received.
  const received = { consenterId: consenter.id, submittedAt: { not: null } };
  const [asker, settings, memberships] = await Promise.all([
    db.requesterProfile.findUnique({
      where: { consenterId: consenter.id },
      select: { id: true, score: true, membershipEndsAt: true },
    }),
    getSettings(),
    db.consenterMember.findMany({ where: { userId: session.userId }, select: { consenterId: true } }),
  ]);
  const [
    needsCount, needs, madeRecent, yourMove, seats, drafts, gave, hold, earnings, matrixCount, tierCount, capacity, invites,
  ] = await Promise.all([
    // Same filter as Requests → Received → "Needs you".
    db.consentRequest.count({ where: { ...received, status: "PENDING" } }),
    db.consentRequest.findMany({
      where: { ...received, status: "PENDING" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, number: true, submittedAt: true, createdAt: true, requester: { select: { displayName: true } } },
    }),
    // Requests this person sent from any of their profiles, matching Requests → Sent.
    db.consentRequest.findMany({
      where: { ...madeBy(session.userId), status: { not: "DRAFT" } },
      orderBy: { updatedAt: "desc" },
      take: 3,
      include: sentInclude,
    }),
    // Only profiles where this person can act, matching the count on Requests → Sent.
    db.consentRequest.count({ where: { ...actingFor(session.userId), ...ASKER_MOVE } }),
    db.requesterMember.findMany(seatsQuery(session.userId)),
    // Unfinished requests, matching the drafts list on Requests → Sent.
    db.consentRequest.count({ where: { ...actingFor(session.userId), status: "DRAFT" } }),
    // Certificates this profile gave that are still active.
    db.consentRequest.count({ where: { ...received, status: "APPROVED", grant: { is: { status: "ACTIVE" } } } }),
    // Certificates this profile holds for requests it sent.
    asker ? db.grant.count({ where: { status: "ACTIVE", request: { requesterId: asker.id } } }) : 0,
    db.earningEntry.findMany({
      where: { consenterId: consenter.id, status: { in: ["HELD", "PENDING"] } },
      select: { amount: true, currency: true, status: true },
    }),
    db.consentMatrixEntry.count({ where: { consenterId: consenter.id } }),
    db.consentPriceTier.count({ where: { consenterId: consenter.id } }),
    // The profile's request limits: are new requests paused right now?
    requestCapacity(consenter.id),
    // Team invitations to this person's email, for profiles they haven't joined yet.
    openTeamInvites(session.user, memberships.map((m) => m.consenterId)),
  ]);
  // The same rolling window the Requests list and the request itself show.
  const [windows, cookieStore] = await Promise.all([requestWindows(needs, settings.slaDays), cookies()]);
  const feeNudgeDismissed = cookieStore.get(`fee-nudge-${consenter.id}`)?.value === "off";
  const { manyProfiles, viewOnly } = askingSeats(seats);
  const verifiedNow = consenter.status === "APPROVED";
  const canEdit = member.role === "OWNER" || member.canEditRules;
  const membershipEnded =
    verifiedNow && member.role !== "VIEWER" && !membershipOk({ membershipEndsAt: asker?.membershipEndsAt ?? null }, settings.membershipFeeOn);
  const zero = fmtMoney(0, consenter.consentPriceCurrency);
  const isOwner = member.role === "OWNER";
  const idCheck = idCheckNote(consenter.status, consenter.displayName, isOwner);

  const stats: { label: string; value: string; href: string }[] = [
    { label: "Active certificates you gave", value: String(gave), href: "/c-panel/requests?tab=Finished" },
    { label: "Active certificates you hold", value: String(hold), href: "/r-panel/grants" },
    {
      // Each entry's amount is already this profile's share.
      label: `Held · your ${OWNER_PCT} if you say yes`,
      value: total(earnings.filter((e) => e.status === "HELD"), zero),
      href: "/c-panel/earnings",
    },
    {
      label: "Yours · paid out on Fridays",
      value: total(earnings.filter((e) => e.status === "PENDING"), zero),
      href: "/c-panel/earnings",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Home"
        title={consenter.displayName}
        desc={
          <span className="flex flex-wrap items-center gap-2">
            {verifiedNow ? <VerifiedBadge /> : <StatusBadge status={consenter.status} />}
            {verifiedNow && (
              <Link href={`/c/${consenter.slug}`} className="underline underline-offset-4">
                View your public profile
              </Link>
            )}
          </span>
        }
        action={<ScoreRing score={profileScore(consenter.score, asker?.score)} />}
      />

      {sp.denied && (
        <Alert tone="warn">You don&apos;t have permission for that. Ask the profile owner if you need it.</Alert>
      )}

      {!verifiedNow && (
        <Alert tone="warn">
          {idCheck.text}
          {idCheck.link && (
            <>
              {" "}
              <Link href={`/onboarding?profile=${consenter.id}`} className="font-medium text-ink underline underline-offset-4">
                {idCheck.link}
              </Link>
            </>
          )}
        </Alert>
      )}

      {membershipEnded && (
        <Alert tone="warn">
          {asker?.membershipEndsAt ? "Your membership has ended. Renew it to send requests." : "Sending requests needs a membership."}{" "}
          People can still ask you.{" "}
          <Link href="/r-panel/billing" className="font-medium text-ink underline underline-offset-4">
            {asker?.membershipEndsAt ? "Renew membership" : "Get a membership"}
          </Link>
        </Alert>
      )}

      {verifiedNow && capacity.paused && (
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

      {invites.map((inv) => (
        <Card key={inv.token} strong className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Users className="mt-0.5 size-5 shrink-0 text-ink" strokeWidth={1.5} aria-hidden />
            <div className="min-w-0">
              <h2 className="font-semibold">You&apos;ve been invited to join {inv.profileName}</h2>
              <p className="text-sm text-ink-soft">Open the invitation to see your role and accept it.</p>
            </div>
          </div>
          <ButtonLink href={`/invite/${inv.token}`}>
            Open invitation <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </Card>
      ))}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-1 p-0 sm:p-0">
          <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
            <div>
              <h2 className="text-sm font-semibold">Needs your answer</h2>
              {needsCount > 0 && (
                <div className="text-xs font-medium text-ink">
                  {needsCount === 1 ? "1 request" : `${needsCount} requests`}
                </div>
              )}
            </div>
            {needsCount > 0 && (
              <Link href="/c-panel/requests" className="text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink">
                See all
              </Link>
            )}
          </div>
          {needs.length === 0 && (
            <div className="px-5 pb-5 pt-2 text-sm text-ink-faint">
              Nothing needs your answer.{" "}
              <Link href="/c-panel/requests?tab=All" className="underline underline-offset-4">
                See every request you received
              </Link>
            </div>
          )}
          <div className="divide-y divide-ink/5">
            {needs.map((r) => (
              <Link
                key={r.id}
                href={`/c-panel/requests/${r.id}`}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    #{r.number} · {r.requester.displayName}
                  </div>
                  {windows.get(r.id) && (
                    <div className="text-xs text-ink-faint">
                      Answer by <LocalTime iso={windows.get(r.id)!.expiresAt.toISOString()} />
                    </div>
                  )}
                </div>
                <ArrowRight className="size-4 text-ink-faint" aria-hidden />
              </Link>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col p-0 sm:p-0">
          <div className="flex items-baseline justify-between gap-3 px-5 pt-5">
            <div>
              <h2 className="text-sm font-semibold">Your requests</h2>
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
                direct={r.requesterId === asker?.id}
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="h-full transition-all hover:shadow-glass-lg">
              <div className="text-xl font-semibold tabular-nums sm:text-2xl">{s.value}</div>
              <div className="mt-0.5 text-xs text-ink-soft">{s.label}</div>
            </Card>
          </Link>
        ))}
      </div>

      {canEdit && matrixCount === 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium">Set your terms</div>
            <div className="text-sm text-ink-soft">
              Decide per platform, format and use what&apos;s allowed at once, what needs your answer,
              and what&apos;s never allowed. It also lifts your Consent Score.
            </div>
          </div>
          <ButtonLink href="/c-panel/matrix">
            Set your terms <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </Card>
      )}

      {verifiedNow && canEdit && tierCount === 0 && !feeNudgeDismissed && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">Set different fees for different kinds of consent</div>
            <div className="text-sm text-ink-soft">
              Charge one fee for news, another for ads, or make some uses free.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form action={dismissFeeNudgeAction}>
              <SubmitButton variant="ghost">Not now</SubmitButton>
            </form>
            <ButtonLink href="/c-panel/settings#fees-by-use">
              Set fees <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </div>
        </Card>
      )}
    </div>
  );
}
