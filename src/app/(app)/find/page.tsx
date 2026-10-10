import Link from "next/link";
import { requireUser, parseProfileContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchConsenters } from "@/lib/search";
import { PageHeader, Card, Input, Button, ButtonLink, VerifiedBadge, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { InvitePanel } from "@/components/invite-panel";
import { titleCase } from "@/lib/utils";
import { PausedSentence } from "../r-panel/paused-sentence";
import { askFromFindAction, renewFromFindAction } from "./actions";
import { askingState, type AskingState } from "./asking";
import { resultDetails } from "./details";
import { Search, UserRound } from "lucide-react";

export const metadata = { title: "Find someone to ask" };

/**
 * Search people to ask, from either workspace. Opening this page never
 * switches the active profile; only asking does (the draft opens in the
 * requester workspace).
 */
export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const session = await requireUser();
  const ctx = parseProfileContext(session.activeProfile);
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const [results, requesterMemberships, ownProfiles] = await Promise.all([
    searchConsenters(q),
    db.requesterMember.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "asc" },
      select: {
        requesterId: true,
        role: true,
        requester: {
          select: { displayName: true, status: true, onboardingFeePaidAt: true, subscriptionEndsAt: true },
        },
      },
    }),
    db.consenterMember.findMany({ where: { userId: session.userId }, select: { consenterId: true } }),
  ]);
  const asking = askingState(requesterMemberships, ctx?.kind === "requester" ? ctx.id : null);
  const own = new Set(ownProfiles.map((m) => m.consenterId));
  const { fees, paused } = await resultDetails(results);
  const here = q ? `/find?q=${encodeURIComponent(q)}` : "/find";

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Find"
        title="Find someone to ask"
        desc="Search verified people, shows and brands. Then ask them for permission."
      />
      <ErrorNote error={sp.error} />
      {typeof sp.invited === "string" && (
        <SuccessNote
          msg={`Invite recorded for ${sp.invited}.${Number(sp.demand) > 1 ? ` ${sp.demand} people are now waiting for them.` : ""} We'll tell you when they join and when they're verified.`}
        />
      )}

      <form method="GET" role="search" className="flex max-w-xl gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, alias or handle"
            className="pl-10"
            aria-label="Search people"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {asking.kind === "ready" && (
        <p className="text-sm text-ink-soft">
          You ask as <strong className="text-ink">{asking.name}</strong>.
        </p>
      )}

      {results.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={q ? `No verified profiles match “${q}”` : "No verified profiles yet"}
          desc="Try another name, alias or handle. Or invite them below."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((c) => {
            const fee = fees.get(c.id);
            const capacity = paused.get(c.id);
            return (
              <Card key={c.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-ink/5 text-lg font-semibold" aria-hidden>
                    {c.displayName.charAt(0)}
                  </div>
                  <VerifiedBadge />
                </div>
                <div>
                  <Link href={`/c/${c.slug}`} className="font-semibold hover:underline hover:underline-offset-4">
                    {c.displayName}
                  </Link>
                  <div className="text-xs text-ink-faint">
                    {titleCase(c.entityType)}
                    {c.category ? ` · ${c.category}` : ""} · score {c.score}
                  </div>
                  <div className="mt-1 text-xs text-ink-soft">
                    {fee?.price ? (
                      <>
                        Consent request fee <strong className="text-ink">{fee.price}</strong>
                      </>
                    ) : (
                      "No consent request fee"
                    )}
                    {fee?.note}
                  </div>
                </div>
                {capacity && (
                  <p className="glass-subtle px-3 py-2 text-xs text-ink-soft">
                    <PausedSentence name={c.displayName} capacity={capacity} />
                  </p>
                )}
                <div className="mt-auto">
                  {own.has(c.id) ? (
                    <p className="text-xs text-ink-faint">This is your profile.</p>
                  ) : (
                    <AskAction asking={asking} slug={c.slug} q={q} paused={!!capacity} />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <InvitePanel query={q} returnTo={here} hasResults={results.length > 0} />
    </div>
  );
}

/** The one next step on a result card, by where the person's asking profile stands. */
function AskAction({ asking, slug, q, paused }: { asking: AskingState; slug: string; q: string; paused: boolean }) {
  switch (asking.kind) {
    case "ready":
      // While paused, a draft can still be written now and sent once they open again.
      return (
        <form action={askFromFindAction}>
          <input type="hidden" name="consenter" value={slug} />
          <input type="hidden" name="requester" value={asking.requesterId} />
          {/* Kept so a failed ask comes back to the same search. */}
          <input type="hidden" name="q" value={q} />
          <SubmitButton variant="secondary" size="sm">
            {paused ? "Start a draft" : "Ask for permission"}
          </SubmitButton>
        </form>
      );
    case "unfinished":
      return (
        <ButtonLink href="/onboarding/requester" variant="secondary" size="sm">
          Finish setting up your asking profile
        </ButtonLink>
      );
    case "lapsed":
      return (
        // Billing shows the active asking profile, so this opens it on the one that lapsed.
        <form action={renewFromFindAction} className="space-y-2">
          <p className="text-xs text-ink-soft">Your yearly plan has ended. Renew it to ask.</p>
          <input type="hidden" name="requester" value={asking.requesterId} />
          <input type="hidden" name="q" value={q} />
          <SubmitButton variant="secondary" size="sm">
            Renew your plan
          </SubmitButton>
        </form>
      );
    case "viewOnly":
      return (
        <p className="text-xs text-ink-soft">
          You have view-only access to {asking.name}. Ask the account owner to send requests.
        </p>
      );
    case "none":
      return (
        <div className="space-y-2">
          <p className="text-xs text-ink-soft">To ask someone, set up your asking profile first. It&apos;s a quick ID check.</p>
          <ButtonLink href="/onboarding/requester" variant="secondary" size="sm">
            Set up your asking profile
          </ButtonLink>
        </div>
      );
  }
}
