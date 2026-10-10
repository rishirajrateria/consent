import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, StatusBadge, ButtonLink, ScoreRing } from "@/components/ui";
import { switchProfileAction } from "../actions";
import { ShieldCheck, Inbox, ArrowRight, Sparkles, Users } from "lucide-react";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await requireUser();
  const [consenters, requesters, openInvites] = await Promise.all([
    db.consenterMember.findMany({
      where: { userId: session.userId },
      include: { consenter: true },
    }),
    db.requesterMember.findMany({
      where: { userId: session.userId },
      include: { requester: true },
    }),
    // Team invites sent to this email that are still open, so an invitee who
    // signs up from scratch can still find their way into the team.
    db.teamInvite.findMany({
      where: {
        email: { equals: session.user.email, mode: "insensitive" },
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const joined = new Set([
    ...consenters.map((m) => `consenter:${m.consenterId}`),
    ...requesters.map((m) => `requester:${m.requesterId}`),
  ]);
  // One invite per team, the newest (openInvites is newest first): a team that
  // re-invited the same email to fix the role shows a single card.
  const seen = new Set(joined);
  const latest = openInvites.filter((i) => {
    const key = `${i.profileKind}:${i.profileId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const invites = await invitesWithNames(latest);

  const hasProfiles = consenters.length > 0 || requesters.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Dashboard"
        title={`Hello, ${session.user.name.split(" ")[0]}`}
        desc={
          hasProfiles
            ? "Choose a profile to work in, or add another."
            : "Welcome to Consent. Set up a profile to get started."
        }
      />

      {invites.map((inv) => (
        <Card key={inv.token} strong className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Users className="mt-0.5 size-5 shrink-0 text-ink" strokeWidth={1.5} aria-hidden />
            <div className="min-w-0">
              <h2 className="font-semibold">You&apos;ve been invited to join {inv.profileName}</h2>
              <p className="text-sm text-ink-soft">
                Open the invitation to see your role and accept it.
              </p>
            </div>
          </div>
          <ButtonLink href={`/invite/${inv.token}`}>
            Open invitation <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        </Card>
      ))}

      {!hasProfiles && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="space-y-3">
            <ShieldCheck className="size-6 text-ink" strokeWidth={1.5} aria-hidden />
            <h2 className="text-lg font-semibold">I&apos;m a consenter</h2>
            <p className="text-sm text-ink-soft">
              You set the terms here. Nothing with your name, face or voice on it moves until
              you say yes.
            </p>
            <ButtonLink href="/onboarding/consenter" variant="secondary">
              Set your terms <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </Card>
          <Card className="space-y-3">
            <Inbox className="size-6 text-ink" strokeWidth={1.5} aria-hidden />
            <h2 className="text-lg font-semibold">I&apos;m a requester</h2>
            <p className="text-sm text-ink-soft">
              Ask for exactly what you intend to publish — and leave holding proof anyone
              can verify.
            </p>
            <ButtonLink href="/onboarding/requester" variant="secondary">
              Create with permission <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </Card>
        </div>
      )}

      {hasProfiles && (
        <div className="grid gap-4 sm:grid-cols-2">
          {consenters.map((m) => (
            <Card key={m.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">
                    Consenter profile
                  </div>
                  <h2 className="text-lg font-semibold">{m.consenter.displayName}</h2>
                </div>
                <StatusBadge status={m.consenter.status === "APPROVED" ? "VERIFIED" : m.consenter.status} />
              </div>
              <ScoreRing score={m.consenter.score} size={56} />
              <form action={switchProfileAction}>
                <button
                  name="profile"
                  value={`consenter:${m.consenterId}`}
                  className="glass-ink inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium hover:opacity-85"
                >
                  Open consenter panel <ArrowRight className="size-4" aria-hidden />
                </button>
              </form>
            </Card>
          ))}
          {requesters.map((m) => (
            <Card key={m.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">
                    Requester profile
                  </div>
                  <h2 className="text-lg font-semibold">{m.requester.displayName}</h2>
                </div>
                <StatusBadge status={m.requester.status} />
              </div>
              <ScoreRing score={m.requester.score} size={56} />
              <form action={switchProfileAction}>
                <button
                  name="profile"
                  value={`requester:${m.requesterId}`}
                  className="glass-ink inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium hover:opacity-85"
                >
                  Open requester panel <ArrowRight className="size-4" aria-hidden />
                </button>
              </form>
            </Card>
          ))}
          <Card className="flex flex-col items-start justify-center gap-3 border-dashed">
            <Sparkles className="size-5 text-ink-faint" aria-hidden />
            <p className="text-sm text-ink-soft">
              One account can hold both sides — an owner who also creates with other identities
              can add the second profile any time.
            </p>
            <ButtonLink href="/onboarding" variant="ghost">
              Add another profile <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </Card>
        </div>
      )}
    </div>
  );
}

/** Pairs each open invite with the team's name; invites to a removed team are left out. */
async function invitesWithNames(invites: { token: string; profileKind: string; profileId: string }[]) {
  if (invites.length === 0) return [];
  const ids = (kind: string) => invites.filter((i) => i.profileKind === kind).map((i) => i.profileId);
  const [consenters, requesters] = await Promise.all([
    db.consenterProfile.findMany({ where: { id: { in: ids("consenter") } }, select: { id: true, displayName: true } }),
    db.requesterProfile.findMany({ where: { id: { in: ids("requester") } }, select: { id: true, displayName: true } }),
  ]);
  const names = new Map<string, string>([
    ...consenters.map((c) => [`consenter:${c.id}`, c.displayName] as const),
    ...requesters.map((r) => [`requester:${r.id}`, r.displayName] as const),
  ]);
  return invites.flatMap((i) => {
    const profileName = names.get(`${i.profileKind}:${i.profileId}`);
    return profileName ? [{ token: i.token, profileName }] : [];
  });
}
