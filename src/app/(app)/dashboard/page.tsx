import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, StatusBadge, ButtonLink, ScoreRing } from "@/components/ui";
import { switchProfileAction } from "../actions";
import { ShieldCheck, Inbox, ArrowRight, Sparkles } from "lucide-react";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await requireUser();
  const [consenters, requesters] = await Promise.all([
    db.consenterMember.findMany({
      where: { userId: session.userId },
      include: { consenter: true },
    }),
    db.requesterMember.findMany({
      where: { userId: session.userId },
      include: { requester: true },
    }),
  ]);

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

      {!hasProfiles && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="space-y-3">
            <ShieldCheck className="size-6 text-ink" strokeWidth={1.5} aria-hidden />
            <h2 className="text-lg font-semibold">I&apos;m a consenter</h2>
            <p className="text-sm text-ink-soft">
              You&apos;re a public figure, show, brand or rights holder. Control exactly how your
              name, image, voice and content may be used — platform by platform.
            </p>
            <ButtonLink href="/onboarding/consenter" variant="secondary">
              Protect my likeness <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          </Card>
          <Card className="space-y-3">
            <Inbox className="size-6 text-ink" strokeWidth={1.5} aria-hidden />
            <h2 className="text-lg font-semibold">I&apos;m a requester</h2>
            <p className="text-sm text-ink-soft">
              You&apos;re a creator, news channel, podcast or media house. Get documented,
              verifiable permission before you publish.
            </p>
            <ButtonLink href="/onboarding/requester" variant="secondary">
              Request consent <ArrowRight className="size-4" aria-hidden />
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
              One account can hold both sides — an influencer who also creates content can add the
              other profile any time.
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
